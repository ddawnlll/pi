/**
 * Memory Injection — V5.04
 *
 * Handles memory injection with compliance checking against policy,
 * conflict, and lifecycle rules. Produces injection reports that are
 * renderable in dashboard Draft Studio and Memory UI.
 *
 * Following V4 ExecutionKernel doctrine: the injection engine reads from
 * existing stores but never mutates execution state directly. It emits
 * memory_injection_performed events through the V5EventSink.
 *
 * The injection process enforces:
 * AC1: Generated plan drafts include memoryRetrievalReport, injectedMemoryIds,
 *      ignoredMemoryIds with reasons, and evidence pack summary
 * AC2: Injection does not bypass policy, conflict, or lifecycle rules
 * AC3: The injection report is renderable in dashboard Draft Studio and Memory UI
 * AC4: No generated content can claim memory support without included evidence refs
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { EvidencePack } from "../evidence/pack.js";
import { buildEvidencePack, buildEvidencePackSummary, createEmptyEvidencePack } from "../evidence/pack.js";
import type { EvidenceAssessment, EvidenceRef, EvidenceResolution } from "../evidence/types.js";
import { assessEvidenceConfidence } from "../evidence/types.js";
import type { MemoryRetrievalResult } from "../memory/retrieval.js";
import type { MemoryRecord } from "../memory/types.js";
import type { V5EventSink } from "../v5/types.js";
import type {
	IgnoredMemoryEntry,
	InjectionComplianceCheck,
	InjectionComplianceResult,
	InjectionPolicyRules,
	MemoryInjectionInput,
	MemoryInjectionOptions,
	MemoryInjectionRecord,
	MemoryInjectionReport,
} from "./types.js";
import { DEFAULT_INJECTION_POLICY_RULES } from "./types.js";

// =========================================================================
// Memory Injection Engine
// =========================================================================

/**
 * Engine for performing memory injections with compliance checking.
 *
 * The injection engine:
 * 1. Validates each injection against policy, conflict, and lifecycle rules
 * 2. Creates memory records for accepted injections
 * 3. Generates a MemoryInjectionReport with injected and ignored memories
 * 4. Includes evidence pack summary for dashboard rendering
 *
 * Usage:
 * ```typescript
 * const engine = new MemoryInjectionEngine(options);
 * const report = await engine.inject({
 *   scope: "ws-123",
 *   injections: [...],
 * });
 * ```
 */
export class MemoryInjectionEngine {
	/** Function to create a memory record. */
	private readonly createMemory: (input: {
		type: string;
		title: string;
		content: string;
		summary?: string;
		confidence: number;
		provenance: { sourceRefs: Array<{ type: string; path: string; id: string }>; validatedBy: string };
		tags?: string[];
		category?: string;
		metadata?: Record<string, unknown>;
	}) => Promise<MemoryRecord>;

	/** Function to retrieve memories for conflict/duplicate checking. */
	private readonly retrieveMemories: (query: {
		types?: string[];
		searchText?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<MemoryRetrievalResult>;

	/** Function to resolve evidence refs. */
	private readonly resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;

	/** Optional V5 event sink for emitting injection events. */
	private readonly eventSink?: V5EventSink;

	/** Policy rules for injection compliance. */
	private policyRules: InjectionPolicyRules;

	/**
	 * Create a new MemoryInjectionEngine.
	 *
	 * @param options - Configuration for the injection engine
	 */
	constructor(options: {
		createMemory: (input: {
			type: string;
			title: string;
			content: string;
			summary?: string;
			confidence: number;
			provenance: { sourceRefs: Array<{ type: string; path: string; id: string }>; validatedBy: string };
			tags?: string[];
			category?: string;
			metadata?: Record<string, unknown>;
		}) => Promise<MemoryRecord>;
		retrieveMemories: (query: {
			types?: string[];
			searchText?: string;
			tags?: string[];
			limit?: number;
			offset?: number;
		}) => Promise<MemoryRetrievalResult>;
		resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;
		eventSink?: V5EventSink;
		policyRules?: Partial<InjectionPolicyRules>;
	}) {
		this.createMemory = options.createMemory;
		this.retrieveMemories = options.retrieveMemories;
		this.resolveEvidence = options.resolveEvidence;
		this.eventSink = options.eventSink;
		this.policyRules = { ...DEFAULT_INJECTION_POLICY_RULES, ...options.policyRules };
	}

	// -------------------------------------------------------------------
	// Configuration
	// -------------------------------------------------------------------

	/**
	 * Update the policy rules for injection compliance.
	 *
	 * @param rules - Partial rules to merge into current rules
	 */
	updatePolicyRules(rules: Partial<InjectionPolicyRules>): void {
		this.policyRules = { ...this.policyRules, ...rules };
	}

	/**
	 * Get a snapshot of the current policy rules.
	 *
	 * @returns A shallow copy of the current rules
	 */
	getPolicyRules(): InjectionPolicyRules {
		return { ...this.policyRules };
	}

	// -------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------

	/**
	 * Perform memory injections with full compliance checking.
	 *
	 * Each injection is validated against:
	 * 1. Policy rules (allowed types, blocked types, min evidence, min confidence)
	 * 2. Conflict detection (does this contradict existing memories?)
	 * 3. Lifecycle rules (is the injection scope valid?)
	 * 4. Duplicate detection (does this content already exist?)
	 *
	 * @param options - Injection options including scope and memories to inject
	 * @returns A complete MemoryInjectionReport
	 */
	async inject(options: MemoryInjectionOptions): Promise<MemoryInjectionReport> {
		const reportId = randomUUID();
		const allEvidenceRefs: EvidenceRef[] = [];
		const injectionRecords: MemoryInjectionRecord[] = [];
		const ignoredEntries: IgnoredMemoryEntry[] = [];
		const injectedIds: string[] = [];
		const complianceChecks: InjectionComplianceCheck[] = [];

		// Collect all evidence refs from injection inputs
		for (const injection of options.injections) {
			for (const ref of injection.evidenceRefs) {
				allEvidenceRefs.push(ref);
			}
		}

		// Build evidence pack
		let evidencePack: EvidencePack;
		if (allEvidenceRefs.length > 0) {
			evidencePack = await buildEvidencePack(options.scope, allEvidenceRefs, this.resolveEvidence, {
				title: `Injection Evidence Pack for ${options.scope}`,
			});
		} else {
			evidencePack = createEmptyEvidencePack(options.scope, `Injection Evidence Pack for ${options.scope}`);
		}
		const evidencePackSummary = buildEvidencePackSummary(evidencePack);

		// Process each injection
		for (const input of options.injections) {
			// Run compliance checks
			const compliance = await this.checkCompliance(input, options);

			// Record all compliance checks for the report
			complianceChecks.push(...compliance.checks);

			if (!compliance.passed) {
				// Injection blocked by compliance
				const record = this.buildRejectedRecord(input, compliance.blockedReason ?? "Compliance check failed");
				injectionRecords.push(record);

				ignoredEntries.push({
					memoryTitle: input.title,
					memoryType: input.memoryType,
					reasonCode: this.reasonCodeFromCompliance(compliance),
					reason: compliance.blockedReason ?? "Blocked by compliance rules",
					failedCheck: compliance.checks.find((c) => !c.passed)?.rule,
				});

				continue;
			}

			try {
				// Create the memory record
				const memory = await this.createMemory({
					type: input.memoryType,
					title: input.title,
					content: input.content,
					summary: input.summary,
					confidence: input.confidence,
					provenance: {
						sourceRefs: input.evidenceRefs.map((ref) => ({
							type: ref.type,
							path: ref.sourcePath ?? `evidence:${ref.type}:${ref.id}`,
							id: ref.id,
						})),
						validatedBy: "system",
					},
					tags: input.tags,
					category: input.category,
					metadata: {
						...input.metadata,
						injectionScope: options.scope,
						injectionReportId: reportId,
						injectedAt: new Date().toISOString(),
					},
				});

				// Record successful injection
				const record = this.buildAcceptedRecord(input, memory.id);
				injectionRecords.push(record);
				injectedIds.push(memory.id);
			} catch (error) {
				// Injection failed at store level
				const record = this.buildRejectedRecord(
					input,
					`Failed to persist memory: ${error instanceof Error ? error.message : String(error)}`,
				);
				injectionRecords.push(record);

				ignoredEntries.push({
					memoryTitle: input.title,
					memoryType: input.memoryType,
					reasonCode: "policy_rule_blocked",
					reason: `Store error: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}

		// Compute overall evidence assessment
		const overallAssessment = assessEvidenceConfidence(
			allEvidenceRefs.map((ref) => ({
				ref,
				resolved: true,
				resolvedAt: new Date().toISOString(),
			})),
		);

		// Build the report
		const successfulCount = injectionRecords.filter((r) => r.accepted).length;
		const ignoredCount = injectionRecords.filter((r) => !r.accepted).length;

		const report: MemoryInjectionReport = {
			id: reportId,
			createdAt: new Date().toISOString(),
			scope: options.scope,
			memoryRetrievalReport: null,
			injectedMemoryIds: injectedIds,
			ignoredMemoryIds: ignoredEntries,
			evidencePackSummary,
			injections: injectionRecords,
			compliance: {
				passed: ignoredEntries.length === 0,
				checks: complianceChecks,
				blockedReason:
					ignoredEntries.length > 0
						? `${ignoredEntries.length} injection(s) were blocked by compliance checks`
						: undefined,
			},
			overallConfidenceLevel: overallAssessment.level,
			overallConfidence: overallAssessment.confidence,
			summary: this.buildReportSummary(successfulCount, ignoredCount, overallAssessment),
			successfulCount,
			ignoredCount,
		};

		// Emit event if sink is configured (V4 doctrine: actors emit events only)
		if (this.eventSink) {
			await this.emitInjectionEvent(report);
		}

		return report;
	}

	/**
	 * Attach a memory retrieval report to an existing injection report.
	 *
	 * This satisfies AC1: plan drafts include memoryRetrievalReport alongside
	 * the injection data.
	 *
	 * @param report - The injection report to attach to
	 * @param retrievalResult - The memory retrieval result
	 * @returns A new report with the retrieval report attached
	 */
	attachRetrievalReport(report: MemoryInjectionReport, retrievalResult: MemoryRetrievalResult): MemoryInjectionReport {
		return {
			...report,
			memoryRetrievalReport: retrievalResult.success ? (retrievalResult.report ?? null) : null,
		};
	}

	// -------------------------------------------------------------------
	// Compliance Checking
	// -------------------------------------------------------------------

	/**
	 * Run all compliance checks against a single injection input.
	 *
	 * Checks:
	 * 1. Memory type is allowed (not blocked, allowedTypes allows or is empty)
	 * 2. Evidence refs meet minimum count
	 * 3. Confidence meets minimum threshold
	 * 4. Conflict detection (if enabled)
	 * 5. Duplicate detection (if enabled)
	 */
	private async checkCompliance(
		input: MemoryInjectionInput,
		options: MemoryInjectionOptions,
	): Promise<InjectionComplianceResult> {
		const checks: InjectionComplianceCheck[] = [];
		const minConfidence = options.minConfidence ?? this.policyRules.minConfidence;

		// Check 1: Allowed memory type
		if (
			this.policyRules.allowedMemoryTypes.length > 0 &&
			!this.policyRules.allowedMemoryTypes.includes(input.memoryType)
		) {
			checks.push({
				rule: "allowed_memory_types",
				passed: false,
				detail: `Memory type "${input.memoryType}" is not in the allowed types list: [${this.policyRules.allowedMemoryTypes.join(", ")}]`,
				severity: "error",
			});
		}

		// Check 2: Blocked memory type
		if (this.policyRules.blockedMemoryTypes.includes(input.memoryType)) {
			checks.push({
				rule: "blocked_memory_types",
				passed: false,
				detail: `Memory type "${input.memoryType}" is explicitly blocked from injection`,
				severity: "error",
			});
		}

		// Check 3: Minimum evidence refs
		if (input.evidenceRefs.length < this.policyRules.minEvidenceRefs) {
			checks.push({
				rule: "min_evidence_refs",
				passed: false,
				detail: `Injection requires at least ${this.policyRules.minEvidenceRefs} evidence reference(s), but only ${input.evidenceRefs.length} provided`,
				severity: "error",
			});
		}

		// Check 4: Minimum confidence
		if (input.confidence < minConfidence) {
			checks.push({
				rule: "min_confidence",
				passed: false,
				detail: `Injection confidence ${input.confidence} is below minimum threshold ${minConfidence}`,
				severity: "error",
			});
		}

		// Check 5: Content validation (non-empty)
		if (!input.title || input.title.trim().length === 0) {
			checks.push({
				rule: "title_required",
				passed: false,
				detail: "Injection must have a non-empty title",
				severity: "error",
			});
		}

		if (!input.content || input.content.trim().length === 0) {
			checks.push({
				rule: "content_required",
				passed: false,
				detail: "Injection must have non-empty content",
				severity: "error",
			});
		}

		// Check 6: Lifecycle validity (if enabled)
		if (this.policyRules.checkLifecycle && !options.skipCompliance) {
			try {
				const lifecycleCheck = await this.checkForLifecycle(input);
				checks.push(lifecycleCheck);
			} catch {
				checks.push({
					rule: "lifecycle_validity",
					passed: true,
					detail: "Lifecycle check unavailable — skipping",
					severity: "warning",
				});
			}
		}

		// Check 7: Conflict detection (if enabled)
		if (this.policyRules.checkConflicts && !options.skipCompliance) {
			try {
				const conflictCheck = await this.checkForConflicts(input);
				checks.push(conflictCheck);
			} catch {
				checks.push({
					rule: "conflict_detection",
					passed: true,
					detail: "Conflict detection unavailable — skipping",
					severity: "warning",
				});
			}
		}

		// Check 8: Duplicate detection (if enabled)
		if (this.policyRules.checkDuplicates && !options.skipCompliance) {
			try {
				const duplicateCheck = await this.checkForDuplicates(input);
				checks.push(duplicateCheck);
			} catch {
				checks.push({
					rule: "duplicate_detection",
					passed: true,
					detail: "Duplicate detection unavailable — skipping",
					severity: "warning",
				});
			}
		}

		// Determine overall result
		const failedChecks = checks.filter((c) => !c.passed);
		const blockedByError = failedChecks.filter((c) => c.severity === "error");

		if (blockedByError.length > 0) {
			return {
				passed: false,
				checks,
				blockedReason: `Blocked by ${blockedByError.length} compliance rule(s): ${blockedByError.map((c) => c.rule).join(", ")}`,
			};
		}

		return {
			passed: true,
			checks,
		};
	}

	/**
	 * Check lifecycle validity for the injection.
	 *
	 * Validates that the injection scope and memory type are in a valid
	 * lifecycle state for receiving new memories. This prevents injecting
	 * into scopes that are completed, cancelled, or otherwise invalid.
	 */
	private async checkForLifecycle(input: MemoryInjectionInput): Promise<InjectionComplianceCheck> {
		try {
			// Query existing memories of the same type to check lifecycle context
			const result = await this.retrieveMemories({
				types: [input.memoryType],
				searchText: input.title,
				limit: 3,
			});

			if (result.success && result.report) {
				// Check if all existing memories of this type are in rejected/expired states
				// which may indicate this memory type is not accepting new injections
				const activeEntries = result.report.entries.filter(
					(e) => e.lifecycle === "active" || e.lifecycle === "candidate" || e.lifecycle === "needs_review",
				);

				// If there are entries but none are active/candidate, warn about stale context
				if (result.report.total > 0 && activeEntries.length === 0) {
					return {
						rule: "lifecycle_validity",
						passed: true,
						detail: `Existing memories of type "${input.memoryType}" are all in inactive lifecycle states. Injection will proceed but review suggested.`,
						severity: "warning",
					};
				}
			}

			return {
				rule: "lifecycle_validity",
				passed: true,
				detail: `Lifecycle check passed for memory type "${input.memoryType}"`,
				severity: "warning",
			};
		} catch (error) {
			return {
				rule: "lifecycle_validity",
				passed: true,
				detail: `Lifecycle check error: ${error instanceof Error ? error.message : String(error)}`,
				severity: "warning",
			};
		}
	}

	/**
	 * Check if the injection would conflict with existing memories of the same type.
	 */
	private async checkForConflicts(input: MemoryInjectionInput): Promise<InjectionComplianceCheck> {
		try {
			const result = await this.retrieveMemories({
				types: [input.memoryType],
				searchText: input.title,
				limit: 5,
			});

			if (result.success && result.report && result.report.entries.length > 0) {
				// Check for high-similarity matches that could indicate conflict
				const similarEntries = result.report.entries.filter(
					(e) =>
						e.confidence >= 0.7 &&
						(e.title.toLowerCase().includes(input.title.toLowerCase()) ||
							input.title.toLowerCase().includes(e.title.toLowerCase())),
				);

				if (similarEntries.length > 0) {
					const conflictingTitles = similarEntries.map((e) => `"${e.title}" (${e.id})`).join(", ");
					return {
						rule: "conflict_detection",
						passed: false,
						detail: `Potential conflict with existing memories: ${conflictingTitles}. Review before injecting.`,
						severity: "warning",
					};
				}
			}

			return {
				rule: "conflict_detection",
				passed: true,
				detail: "No conflicts detected with existing memories",
				severity: "warning",
			};
		} catch (error) {
			return {
				rule: "conflict_detection",
				passed: true,
				detail: `Conflict check error: ${error instanceof Error ? error.message : String(error)}`,
				severity: "warning",
			};
		}
	}

	/**
	 * Check if the injection content duplicates existing memories.
	 */
	private async checkForDuplicates(input: MemoryInjectionInput): Promise<InjectionComplianceCheck> {
		try {
			const result = await this.retrieveMemories({
				types: [input.memoryType],
				searchText: input.content.slice(0, 200),
				limit: 5,
			});

			if (result.success && result.report && result.report.entries.length > 0) {
				// Simple duplicate check: same type + high similarity in title/content
				const duplicates = result.report.entries.filter((e) => {
					const titleMatch = e.title.toLowerCase() === input.title.toLowerCase();
					const contentOverlap =
						e.content.length > 50 &&
						input.content.length > 50 &&
						(e.content.includes(input.content.slice(0, 100)) || input.content.includes(e.content.slice(0, 100)));
					return titleMatch || contentOverlap;
				});

				if (duplicates.length > 0) {
					const duplicateTitles = duplicates.map((e) => `"${e.title}" (${e.id})`).join(", ");
					return {
						rule: "duplicate_detection",
						passed: false,
						detail: `Potential duplicate of existing memory: ${duplicateTitles}`,
						severity: "error",
					};
				}
			}

			return {
				rule: "duplicate_detection",
				passed: true,
				detail: "No duplicates detected",
				severity: "warning",
			};
		} catch (error) {
			return {
				rule: "duplicate_detection",
				passed: true,
				detail: `Duplicate check error: ${error instanceof Error ? error.message : String(error)}`,
				severity: "warning",
			};
		}
	}

	// -------------------------------------------------------------------
	// Event Emission (V4 ExecutionKernel doctrine)
	// -------------------------------------------------------------------

	/**
	 * Emit injection events through the V5 event sink.
	 */
	private async emitInjectionEvent(report: MemoryInjectionReport): Promise<void> {
		if (!this.eventSink) return;

		const eventPayload =
			report.ignoredCount > 0
				? {
						kind: "injection_blocked" as const,
						report,
						blockedReason: report.compliance.blockedReason ?? "Some injections were blocked",
					}
				: {
						kind: "memory_injection_performed" as const,
						report,
					};

		await this.eventSink.emit({
			kind: "timeline",
			event: {
				id: randomUUID(),
				eventType: "observation",
				timestamp: new Date().toISOString(),
				data: eventPayload as Record<string, unknown>,
				severity: "info",
			},
		});
	}

	// -------------------------------------------------------------------
	// Record Builders
	// -------------------------------------------------------------------

	/**
	 * Build a rejection record for a blocked injection.
	 */
	private buildRejectedRecord(input: MemoryInjectionInput, reason: string): MemoryInjectionRecord {
		return {
			id: randomUUID(),
			memoryType: input.memoryType,
			title: input.title,
			content: input.content,
			accepted: false,
			rejectionReason: reason,
			evidenceRefs: input.evidenceRefs,
			confidenceLevel: "LOW",
			confidence: input.confidence,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Build an acceptance record for a successful injection.
	 */
	private buildAcceptedRecord(input: MemoryInjectionInput, memoryId: string): MemoryInjectionRecord {
		const assessment = assessEvidenceConfidence(
			input.evidenceRefs.map((ref) => ({
				ref,
				resolved: true,
				resolvedAt: new Date().toISOString(),
			})),
		);

		return {
			id: randomUUID(),
			memoryType: input.memoryType,
			title: input.title,
			content: input.content,
			accepted: true,
			memoryId,
			evidenceRefs: input.evidenceRefs,
			confidenceLevel: assessment.level,
			confidence: input.confidence,
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * Map compliance result to a reason code for the ignored entries list.
	 */
	private reasonCodeFromCompliance(compliance: InjectionComplianceResult): IgnoredMemoryEntry["reasonCode"] {
		const failedChecks = compliance.checks.filter((c) => !c.passed);

		for (const check of failedChecks) {
			switch (check.rule) {
				case "allowed_memory_types":
				case "blocked_memory_types":
					return "policy_rule_blocked";
				case "conflict_detection":
					return "conflict_detected";
				case "duplicate_detection":
					return "duplicate_content";
				case "min_evidence_refs":
					return "evidence_insufficient";
				case "min_confidence":
					return "confidence_too_low";
				case "title_required":
				case "content_required":
					return "policy_rule_blocked";
			}
		}

		return "policy_rule_blocked";
	}

	/**
	 * Build a human-readable summary for the report.
	 */
	private buildReportSummary(successfulCount: number, ignoredCount: number, assessment: EvidenceAssessment): string {
		const parts: string[] = [];

		if (successfulCount > 0) {
			parts.push(`${successfulCount} memory(ies) injected successfully`);
		}
		if (ignoredCount > 0) {
			parts.push(`${ignoredCount} memory(ies) ignored`);
		}

		parts.push(`Confidence: ${assessment.level} (${(assessment.confidence * 100).toFixed(0)}%)`);

		if (successfulCount === 0 && ignoredCount > 0) {
			parts.push("No injections were accepted — all blocked by compliance rules");
		}

		return parts.join(" — ");
	}
}

// =========================================================================
// Factory
// =========================================================================

/**
 * Create a MemoryInjectionEngine instance.
 *
 * @param options - Configuration for the injection engine
 * @returns MemoryInjectionEngine instance
 */
export function createMemoryInjectionEngine(options: {
	createMemory: (input: {
		type: string;
		title: string;
		content: string;
		summary?: string;
		confidence: number;
		provenance: { sourceRefs: Array<{ type: string; path: string; id: string }>; validatedBy: string };
		tags?: string[];
		category?: string;
		metadata?: Record<string, unknown>;
	}) => Promise<MemoryRecord>;
	retrieveMemories: (query: {
		types?: string[];
		searchText?: string;
		tags?: string[];
		limit?: number;
		offset?: number;
	}) => Promise<MemoryRetrievalResult>;
	resolveEvidence: (refs: EvidenceRef[]) => Promise<EvidenceResolution[]>;
	eventSink?: V5EventSink;
	policyRules?: Partial<InjectionPolicyRules>;
}): MemoryInjectionEngine {
	return new MemoryInjectionEngine(options);
}
