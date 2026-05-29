/**
 * Reflection Engine — P17.C
 *
 * Orchestrates the full reflection pipeline after plan execution completes.
 *
 * Consumes execution journal, workspace outcomes, and validation results to:
 * - Analyze what ran, worked, failed, and slowed down
 * - Compute metrics (success rate, retry count, duration, etc.)
 * - Generate source-backed summaries with inline evidence references
 * - Create memory update proposals from findings
 * - Generate future phase suggestions
 * - Produce a complete ReflectionReport with JSON and markdown artifacts
 *
 * Integrates with MorningReportReflectionEngine for overnight report counts.
 */

import { randomUUID } from "node:crypto";
import type { MorningReportReflectionEngine } from "../../brain/overnight/morning-report.js";
import type { ProposalType } from "../../brain/proposals/types.js";
import { FutureSuggestionEngine } from "./future-suggestions.js";
import { MemoryProposalGenerator } from "./memory-proposals.js";
import { SourceBackedSummarizer } from "./summarizer.js";
import type {
	EvidenceClaim,
	ExecutionJournalEntry,
	FuturePhaseSuggestion,
	MemoryProposalSuggestion,
	ProposalSuggestion,
	ReflectionConfig,
	ReflectionInput,
	ReflectionReport,
	SourceRef,
	ValidationResult,
	WorkspaceOutcome,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default reflection config values. */
const DEFAULT_CONFIG: ReflectionConfig = {
	outputBaseDir: ".pi/brain/reflections/",
	minWorkspaceCount: 3,
	enableMemoryGeneration: true,
	enableFutureSuggestions: true,
	maxFutureSuggestions: 3,
	sourceBackedRequired: true,
	enableEvidenceIntegration: false,
	registerClaimsInEvidenceIndex: false,
};

// ---------------------------------------------------------------------------
// Reflection Engine
// ---------------------------------------------------------------------------

export class ReflectionEngine implements MorningReportReflectionEngine {
	private config: ReflectionConfig;
	private summarizer: SourceBackedSummarizer;
	private memoryProposalGen: MemoryProposalGenerator;
	private futureSuggestionEngine: FutureSuggestionEngine;

	/**
	 * In-memory store of generated reflections, keyed by planExecId.
	 * Used by countReflectionsSince() for the MorningReportReflectionEngine
	 * interface. In production this would be backed by a database or filesystem.
	 */
	private reflections: Map<string, ReflectionReport> = new Map();

	constructor(config?: Partial<ReflectionConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.summarizer = new SourceBackedSummarizer();
		this.memoryProposalGen = new MemoryProposalGenerator();
		this.futureSuggestionEngine = new FutureSuggestionEngine({
			maxSuggestions: this.config.maxFutureSuggestions,
		});
	}

	// -----------------------------------------------------------------------
	// MorningReportReflectionEngine implementation
	// -----------------------------------------------------------------------

	/**
	 * Count reflections generated after the given timestamp.
	 * Required by MorningReportReflectionEngine.
	 *
	 * @param timestamp - ISO 8601 timestamp boundary
	 * @returns Count of reflections created after the boundary
	 */
	async countReflectionsSince(timestamp: string): Promise<number> {
		const sinceMs = new Date(timestamp).getTime();
		let count = 0;
		for (const report of this.reflections.values()) {
			if (new Date(report.createdAt).getTime() > sinceMs) {
				count++;
			}
		}
		return count;
	}

	// -----------------------------------------------------------------------
	// Core reflection pipeline
	// -----------------------------------------------------------------------

	/**
	 * Run the full reflection pipeline.
	 *
	 * @param input - Reflection input data (execution journal, outcomes, validation results)
	 * @returns A complete ReflectionReport
	 */
	async reflect(input: ReflectionInput): Promise<ReflectionReport> {
		return this.generateReflection(input);
	}

	/**
	 * Generate a reflection report from execution data.
	 *
	 * This is the main entry point for the reflection pipeline:
	 * 1. Analyze what ran, worked, failed, slowed down
	 * 2. Compute metrics
	 * 3. Generate source-backed summaries
	 * 4. Create memory proposals
	 * 5. Generate future suggestions
	 * 6. Assemble and store the report
	 *
	 * @param input - Reflection input data
	 * @returns A complete ReflectionReport
	 */
	async generateReflection(input: ReflectionInput): Promise<ReflectionReport> {
		// Skip reflection for tiny plans if configured
		if (input.workspaceOutcomes.length < this.config.minWorkspaceCount) {
			throw new Error(
				`Reflection skipped: only ${input.workspaceOutcomes.length} workspace(s) executed, minimum is ${this.config.minWorkspaceCount}. ` +
					"Set minWorkspaceCount lower to force reflection for small plans.",
			);
		}

		// 1. Analyze outcomes
		const whatRan = this.analyzeWhatRan(input.workspaceOutcomes);
		const _whatWorked = this.analyzeWhatWorked(input.workspaceOutcomes, input.executionJournal);
		const _whatFailed = this.analyzeWhatFailed(input.workspaceOutcomes, input.validationResults);
		const whatSlowedDown = this.analyzeWhatSlowedDown(input.workspaceOutcomes, input.executionJournal);

		// 2. Compute metrics
		const metrics = this.computeMetrics(input.workspaceOutcomes);
		const validationFailures = input.validationResults.filter((v) => v.type === "error" && v.passed !== true).length;

		// 3. Collect source references from outcomes
		const sources: SourceRef[] = this.collectSources(input.workspaceOutcomes, input.validationResults);

		// 4. Generate summaries
		const whatWorkedSummary = this.summarizer.generateWhatWorkedSummary(input.workspaceOutcomes);
		const whatFailedSummary = this.summarizer.generateWhatFailedSummary(
			input.workspaceOutcomes,
			input.validationResults,
		);
		const metricSummary = this.summarizer.generateMetricSummary({
			successRate: metrics.successRate,
			avgRetryCount: metrics.avgRetryCount,
			totalDuration: metrics.totalDuration,
		});

		const summary = this.generateSummary(whatWorkedSummary, whatFailedSummary, metricSummary, validationFailures);
		const whatPeopleNeedToKnow = this.generateOneLiner(metrics.successRate, metrics.failureCount, validationFailures);

		// 5. Generate evidence-backed claims (V5.10 AC1/AC2)
		const claims = this.generateClaims(
			whatWorkedSummary,
			whatFailedSummary,
			whatSlowedDown,
			metrics,
			validationFailures,
			sources,
		);

		// 6. Build report (without generated fields)
		const reportBase = {
			id: randomUUID(),
			planExecId: input.planExecId,
			planTitle: input.planTitle,

			summary,
			whatPeopleNeedToKnow,

			whatRan,
			whatWorked: [whatWorkedSummary],
			whatFailed: [whatFailedSummary],
			whatSlowedDown,

			workspaceCount: metrics.workspaceCount,
			successCount: metrics.successCount,
			failureCount: metrics.failureCount,
			retryCount: metrics.retryCount,
			successRate: metrics.successRate,
			avgRetryCount: metrics.avgRetryCount,
			totalDuration: metrics.totalDuration,
			validationFailures,

			claims,

			memoriesToCreate: [] as MemoryProposalSuggestion[],
			proposalsToGenerate: [] as ProposalSuggestion[],
			futurePhaseSuggestions: [] as FuturePhaseSuggestion[],

			policyStops: input.policyStops,
			approvalRequests: input.approvalRequests,
			safetyInterventions: input.policyStops + input.approvalRequests,

			createdAt: new Date().toISOString(),
			confidence: this.computeConfidence(metrics, validationFailures, sources),
			sources,
		};

		// 7. Generate memory proposals (if enabled)
		if (this.config.enableMemoryGeneration) {
			const memoryProposals = this.memoryProposalGen.fromReflection(reportBase);
			reportBase.memoriesToCreate = memoryProposals.map((mp) => ({
				type: mp.memory.type as MemoryProposalSuggestion["type"],
				title: mp.memory.title ?? "Untitled",
				content: mp.memory.content ?? "",
				confidence: mp.confidence,
				sourceRefs: mp.evidence.map((e) => ({
					type: "workspace" as const,
					id: e.id,
					description: `Evidence source reflection:${e.id}`,
				})),
				category: (mp.memory.category as MemoryProposalSuggestion["category"]) ?? "process",
			}));

			// Also generate ProposalSuggestions for the proposals section
			reportBase.proposalsToGenerate = memoryProposals.map((mp) => ({
				type: "memory_proposal" as ProposalType,
				title: mp.memory.title ?? "Untitled Memory Proposal",
				description: mp.memory.content ?? "",
				rationale: mp.memory.summary ?? `Auto-generated ${mp.memory.type ?? "memory"} proposal`,
				priority: this.mapConfidenceToPriority(mp.confidence),
				evidenceIds: mp.evidence.map((e) => e.id),
			}));
		}

		// 8. Generate future suggestions (if enabled)
		if (this.config.enableFutureSuggestions) {
			const futureSugs = this.futureSuggestionEngine.fromReflection(reportBase);
			reportBase.futurePhaseSuggestions = futureSugs;
		}

		// 9. Validate source-backing (if required)
		if (this.config.sourceBackedRequired) {
			const valid = this.validateSources(reportBase);
			if (!valid) {
				throw new Error(
					"Reflection report failed source-backing validation: " +
						"some claims are missing inline evidence references.",
				);
			}
		}

		// 10. Store and return
		this.reflections.set(input.planExecId, reportBase);
		return reportBase;
	}

	// -----------------------------------------------------------------------
	// Analysis methods
	// -----------------------------------------------------------------------

	/**
	 * Analyze what ran from workspace outcomes.
	 * Returns a summary list of workspace IDs that were executed.
	 */
	analyzeWhatRan(outcomes: WorkspaceOutcome[]): string[] {
		// Extract a human-readable list of what workspaces ran
		return outcomes.map((o) => {
			const statusLabel = o.status === "success" ? "" : ` (${o.status})`;
			return `workspace ${o.workspaceId}${statusLabel}`;
		});
	}

	/**
	 * Analyze what worked from workspace outcomes.
	 * Returns descriptions of successful outcomes.
	 */
	analyzeWhatWorked(outcomes: WorkspaceOutcome[], _journal: ExecutionJournalEntry[]): string[] {
		return outcomes
			.filter((o) => o.status === "success" || o.status === "retry")
			.map((o) => {
				return o.summary ?? `workspace ${o.workspaceId} completed successfully [source:workspace-${o.workspaceId}]`;
			});
	}

	/**
	 * Analyze what failed from workspace outcomes and validation results.
	 * Returns descriptions of failures.
	 */
	analyzeWhatFailed(outcomes: WorkspaceOutcome[], validationResults: ValidationResult[]): string[] {
		const failures: string[] = [];

		// Failed or skipped workspaces
		for (const o of outcomes) {
			if (o.status === "failure" || o.status === "skipped") {
				failures.push(
					o.summary ??
						`workspace ${o.workspaceId} failed${
							o.errorTypes?.length ? ` (${o.errorTypes.join(", ")})` : ""
						} [source:workspace-${o.workspaceId}]`,
				);
			}
		}

		// Failed validations
		for (const v of validationResults) {
			if (v.type === "error" && v.passed !== true) {
				failures.push(`validation ${v.component}: ${v.message} [source:validation-${v.component}]`);
			}
		}

		return failures;
	}

	/**
	 * Analyze what slowed down execution.
	 * Identifies bottlenecks from retry counts and duration.
	 */
	analyzeWhatSlowedDown(outcomes: WorkspaceOutcome[], _journal: ExecutionJournalEntry[]): string[] {
		const bottlenecks: string[] = [];

		// Workspaces with high retry counts
		const highRetry = outcomes.filter((o) => o.retryCount > 1);
		for (const o of highRetry) {
			bottlenecks.push(
				`workspace ${o.workspaceId} required ${o.retryCount} retries [source:workspace-${o.workspaceId}]`,
			);
		}

		// Workspaces with long duration (above average by 2x)
		if (outcomes.length > 0) {
			const avgDuration = outcomes.reduce((sum, o) => sum + o.duration, 0) / outcomes.length;
			const slowWorkspaces = outcomes.filter((o) => o.duration > avgDuration * 2);
			for (const o of slowWorkspaces) {
				bottlenecks.push(
					`workspace ${o.workspaceId} took ${o.duration}ms (above avg of ${Math.round(avgDuration)}ms) [source:workspace-${o.workspaceId}]`,
				);
			}
		}

		return bottlenecks;
	}

	// -----------------------------------------------------------------------
	// Metrics computation
	// -----------------------------------------------------------------------

	/**
	 * Compute aggregate metrics from workspace outcomes.
	 */
	computeMetrics(outcomes: WorkspaceOutcome[]): {
		workspaceCount: number;
		successCount: number;
		failureCount: number;
		retryCount: number;
		successRate: number;
		avgRetryCount: number;
		totalDuration: number;
	} {
		const workspaceCount = outcomes.length;
		const successCount = outcomes.filter((o) => o.status === "success" || o.status === "retry").length;
		const failureCount = outcomes.filter((o) => o.status === "failure" || o.status === "skipped").length;
		const retryCount = outcomes.reduce((sum, o) => sum + o.retryCount, 0);
		const successRate = workspaceCount > 0 ? successCount / workspaceCount : 0;
		const avgRetryCount = workspaceCount > 0 ? retryCount / workspaceCount : 0;
		const totalDuration = outcomes.reduce((sum, o) => sum + o.duration, 0);

		return {
			workspaceCount,
			successCount,
			failureCount,
			retryCount,
			successRate,
			avgRetryCount,
			totalDuration,
		};
	}

	// -----------------------------------------------------------------------
	// Summary generation (private)
	// -----------------------------------------------------------------------

	/**
	 * Generate a 2-3 sentence summary from sub-summaries.
	 */
	private generateSummary(
		whatWorked: string,
		whatFailed: string,
		metrics: string,
		validationFailures: number,
	): string {
		const parts: string[] = [];
		parts.push(metrics);
		if (whatWorked && !whatWorked.includes("No workspaces completed successfully")) {
			parts.push(whatWorked);
		}
		if (whatFailed && !whatFailed.includes("No failures detected")) {
			parts.push(whatFailed);
		}
		if (validationFailures > 0) {
			parts.push(`${validationFailures} validation failure(s) were detected [source:metrics]`);
		}
		return parts.join(" ");
	}

	/**
	 * Generate a one-line takeaway describing overall outcome.
	 */
	private generateOneLiner(successRate: number, failureCount: number, validationFailures: number): string {
		if (successRate >= 0.9 && failureCount === 0 && validationFailures === 0) {
			return "All workspaces completed successfully with no issues.";
		}
		if (successRate >= 0.7) {
			return `Most workspaces completed successfully (${(successRate * 100).toFixed(0)}% success rate)${
				failureCount > 0 ? `, ${failureCount} workspace(s) failed` : ""
			}${validationFailures > 0 ? `, ${validationFailures} validation failure(s)` : ""}.`;
		}
		if (successRate >= 0.5) {
			return `Partial success (${(successRate * 100).toFixed(0)}% success rate)${
				failureCount > 0 ? ` with ${failureCount} workspace(s) failed` : ""
			}${validationFailures > 0 ? ` and ${validationFailures} validation failure(s)` : ""}.`;
		}
		return `Most workspaces failed to complete successfully (${(successRate * 100).toFixed(0)}% success rate)${
			validationFailures > 0 ? ` with ${validationFailures} validation failure(s)` : ""
		}.`;
	}

	// -----------------------------------------------------------------------
	// Source management
	// -----------------------------------------------------------------------

	/**
	 * Collect all source references from workspace outcomes and validation results.
	 * Also adds a synthetic "metrics" source for metric-backed claims.
	 */
	private collectSources(outcomes: WorkspaceOutcome[], validationResults: ValidationResult[]): SourceRef[] {
		const sources: SourceRef[] = [];

		for (const o of outcomes) {
			sources.push({
				type: "workspace",
				id: `workspace-${o.workspaceId}`,
				description: o.summary ?? `Outcome for workspace ${o.workspaceId} (${o.status})`,
			});
		}

		for (const v of validationResults) {
			if (v.type === "error") {
				sources.push({
					type: "validation",
					id: `validation-${v.component}`,
					description: v.message,
				});
			}
		}

		// Add a synthetic metrics source for metric-backed claims
		sources.push({
			type: "journal",
			id: "metrics",
			description: "Aggregate execution metrics computed from workspace outcomes",
		});

		return sources;
	}

	/**
	 * Validate that the report's summary and sections reference their sources.
	 */
	private validateSources(report: ReflectionReport): boolean {
		const allTexts = [report.summary, ...report.whatWorked, ...report.whatFailed, ...report.whatSlowedDown];
		const sources = report.sources;

		for (const text of allTexts) {
			const result = this.summarizer.validateEvidenceChain(text, sources);
			if (!result.valid) {
				return false;
			}
		}

		return true;
	}

	// -----------------------------------------------------------------------
	// Confidence computation
	// -----------------------------------------------------------------------

	/**
	 * Compute overall report confidence based on evidence and outcomes.
	 */
	private computeConfidence(
		metrics: { successRate: number; retryCount: number; workspaceCount: number },
		validationFailures: number,
		sources: SourceRef[],
	): number {
		let confidence = 0.5;

		// More sources = more evidence = higher confidence
		if (sources.length > 0) {
			confidence += Math.min(sources.length * 0.05, 0.2);
		}

		// High success rate boosts confidence
		if (metrics.successRate >= 0.9) {
			confidence += 0.15;
		} else if (metrics.successRate >= 0.7) {
			confidence += 0.05;
		} else if (metrics.successRate < 0.3) {
			confidence -= 0.1;
		}

		// Retries reduce confidence (unstable execution)
		if (metrics.retryCount > 0) {
			confidence -= Math.min(metrics.retryCount * 0.02, 0.15);
		}

		// Validation failures reduce confidence
		if (validationFailures > 0) {
			confidence -= Math.min(validationFailures * 0.05, 0.15);
		}

		return Math.max(0.1, Math.min(0.95, confidence));
	}

	// -----------------------------------------------------------------------
	// Evidence-backed claims generation (V5.10 AC1/AC2)
	// -----------------------------------------------------------------------

	/**
	 * Generate evidence-backed claims with confidence from the reflection analysis.
	 *
	 * Each claim is a factual statement backed by one or more source references
	 * and includes a confidence score derived from the evidence quality.
	 *
	 * V5.10 AC1: Post-run reflection can generate memory candidates and future
	 * proposals with source refs.
	 * V5.10 AC2: Reflection claims are evidence-backed and include confidence.
	 *
	 * @param whatWorkedSummary - Summary of what worked
	 * @param whatFailedSummary - Summary of what failed
	 * @param whatSlowedDown - List of bottlenecks
	 * @param metrics - Computed execution metrics
	 * @param validationFailures - Number of validation failures
	 * @param sources - Source references from execution
	 * @returns Array of evidence-backed claims
	 */
	private generateClaims(
		whatWorkedSummary: string,
		whatFailedSummary: string,
		whatSlowedDown: string[],
		metrics: {
			workspaceCount: number;
			successCount: number;
			failureCount: number;
			retryCount: number;
			successRate: number;
			avgRetryCount: number;
			totalDuration: number;
		},
		validationFailures: number,
		sources: SourceRef[],
	): EvidenceClaim[] {
		const claims: EvidenceClaim[] = [];
		const _now = new Date().toISOString();

		// Claim 1: Overall execution outcome (observation)
		{
			const sourceIds = sources.map((s) => s.id);
			const confidence = this.computeConfidence(metrics, validationFailures, sources);
			claims.push({
				id: randomUUID(),
				category: "observation",
				statement: `Execution completed with ${metrics.successCount}/${metrics.workspaceCount} successful workspaces (${(metrics.successRate * 100).toFixed(1)}% success rate), ${metrics.failureCount} failures, ${validationFailures} validation failures.`,
				evidenceIds: sourceIds,
				confidence,
				audited: false,
			});
		}

		// Claim 2: What worked analysis (analysis)
		if (whatWorkedSummary && !whatWorkedSummary.includes("No workspaces completed successfully")) {
			claims.push({
				id: randomUUID(),
				category: "analysis",
				statement: whatWorkedSummary.replace(/\[source:[^\]]+\]/g, "").trim(),
				evidenceIds: sources.filter((s) => s.type === "workspace").map((s) => s.id),
				confidence: Math.min(0.5 + metrics.successRate * 0.4, 0.9),
				audited: false,
			});
		}

		// Claim 3: What failed analysis (analysis)
		if (whatFailedSummary && !whatFailedSummary.includes("No failures detected")) {
			claims.push({
				id: randomUUID(),
				category: "analysis",
				statement: whatFailedSummary.replace(/\[source:[^\]]+\]/g, "").trim(),
				evidenceIds: [...sources.filter((s) => s.type === "workspace" || s.type === "validation").map((s) => s.id)],
				confidence: Math.max(0.3, 0.7 - metrics.failureCount * 0.1),
				audited: false,
			});
		}

		// Claim 4: Retry pattern observation (observation)
		if (metrics.retryCount > 0) {
			claims.push({
				id: randomUUID(),
				category: "observation",
				statement: `${metrics.retryCount} total retries occurred across ${metrics.workspaceCount} workspaces (avg ${metrics.avgRetryCount.toFixed(2)} retries per workspace).`,
				evidenceIds: sources.filter((s) => s.type === "workspace").map((s) => s.id),
				confidence: Math.max(0.3, Math.min(0.8, 1.0 - metrics.avgRetryCount * 0.15)),
				audited: false,
			});
		}

		// Claim 5: Bottleneck analysis (analysis)
		if (whatSlowedDown.length > 0) {
			claims.push({
				id: randomUUID(),
				category: "analysis",
				statement: `${whatSlowedDown.length} bottleneck(s) identified: ${whatSlowedDown
					.join("; ")
					.replace(/\[source:[^\]]+\]/g, "")
					.trim()}`,
				evidenceIds: sources.filter((s) => s.type === "workspace").map((s) => s.id),
				confidence: Math.min(0.5 + whatSlowedDown.length * 0.1, 0.85),
				audited: false,
			});
		}

		// Claim 6: Memory generation recommendation (recommendation)
		if (this.config.enableMemoryGeneration) {
			const memoryTypes: string[] = [];
			if (metrics.failureCount > 0) memoryTypes.push("failure_memory");
			if (metrics.successCount > 0) memoryTypes.push("execution_memory");
			if (metrics.workspaceCount > 0) memoryTypes.push("architecture_memory");

			if (memoryTypes.length > 0) {
				claims.push({
					id: randomUUID(),
					category: "recommendation",
					statement: `Generate memory records for reflection findings: ${memoryTypes.join(", ")}. Source-backed by ${sources.length} evidence references.`,
					evidenceIds: sources.map((s) => s.id),
					confidence: this.computeConfidence(metrics, validationFailures, sources),
					audited: false,
				});
			}
		}

		// Claim 7: Future proposals recommendation (recommendation)
		if (this.config.enableFutureSuggestions && (metrics.failureCount > 0 || whatSlowedDown.length > 0)) {
			claims.push({
				id: randomUUID(),
				category: "recommendation",
				statement:
					metrics.failureCount > 0
						? `Generate ${metrics.failureCount} proposal(s) to address execution failures and bottlenecks.`
						: `Generate proposal(s) to address ${whatSlowedDown.length} identified bottleneck(s).`,
				evidenceIds: [...sources.filter((s) => s.type === "workspace" || s.type === "validation").map((s) => s.id)],
				confidence: 0.6,
				audited: false,
			});
		}

		return claims;
	}

	// -----------------------------------------------------------------------
	// Priority mapping
	// -----------------------------------------------------------------------

	/**
	 * Map a confidence score to a priority level for proposal generation.
	 */
	private mapConfidenceToPriority(confidence: number): "critical" | "high" | "normal" | "low" {
		if (confidence >= 0.8) return "critical";
		if (confidence >= 0.6) return "high";
		if (confidence >= 0.3) return "normal";
		return "low";
	}

	// -----------------------------------------------------------------------
	// Artifact writing
	// -----------------------------------------------------------------------

	/**
	 * Format the report as markdown for file storage.
	 */
	writeMarkdown(report: ReflectionReport): string {
		return this.summarizer.formatForMarkdown(report);
	}

	/**
	 * Format the report as JSON for file storage.
	 */
	writeJson(report: ReflectionReport): string {
		return JSON.stringify(report, null, 2);
	}

	// -----------------------------------------------------------------------
	// Artifact paths
	// -----------------------------------------------------------------------

	/**
	 * Get the directory path for a plan execution's reflection artifacts.
	 */
	private reflectionDir(planExecId: string): string {
		return `${this.config.outputBaseDir}${planExecId}/`;
	}

	/**
	 * Get the markdown file path for a reflection report.
	 */
	reflectionMdPath(planExecId: string): string {
		return `${this.reflectionDir(planExecId)}reflection.md`;
	}

	/**
	 * Get the JSON file path for a reflection report.
	 */
	reflectionJsonPath(planExecId: string): string {
		return `${this.reflectionDir(planExecId)}reflection.json`;
	}

	/**
	 * Get the JSON file path for memory proposals.
	 */
	memoryProposalsPath(planExecId: string): string {
		return `${this.reflectionDir(planExecId)}memory-proposals.json`;
	}

	/**
	 * Get the JSON file path for future suggestions.
	 */
	futureSuggestionsPath(planExecId: string): string {
		return `${this.reflectionDir(planExecId)}future-suggestions.json`;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the engine configuration.
	 */
	setConfig(config: Partial<ReflectionConfig>): void {
		this.config = { ...this.config, ...config };
		this.futureSuggestionEngine.setConfig({
			maxSuggestions: this.config.maxFutureSuggestions,
		});
	}

	/**
	 * Get a copy of the current configuration.
	 */
	getConfig(): ReflectionConfig {
		return { ...this.config };
	}

	/**
	 * Get a stored reflection report by plan execution ID.
	 * Returns undefined if not found.
	 */
	getReflection(planExecId: string): ReflectionReport | undefined {
		return this.reflections.get(planExecId);
	}

	/**
	 * List all stored reflection reports.
	 */
	listReflections(): ReflectionReport[] {
		return Array.from(this.reflections.values());
	}
}
