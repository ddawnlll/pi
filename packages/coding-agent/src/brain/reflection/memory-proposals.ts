/**
 * Memory Proposal Generator — P17.E
 *
 * Creates memory update proposals from reflection results.
 * - Failures become failure_memory type
 * - Successes become execution_memory type
 * - Architecture changes become architecture_memory type
 * - Each proposal includes source references to reflection evidence
 * - Proposals start as candidate lifecycle
 * - Confidence based on evidence strength and retry count
 */

import type { MemoryRecord, MemorySourceRef } from "../../brain/memory/types.js";
import type { Proposal } from "../../brain/proposals/types.js";
import type { ReflectionReport, SourceRef, WorkspaceOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of source references required for a valid memory proposal. */
const MIN_SOURCE_REFS = 1;

/** Base confidence when no retries occurred. */
const BASE_CONFIDENCE = 0.5;

/** Confidence bonus per successful outcome with no retries. */
const SUCCESS_CONFIDENCE_BOOST = 0.3;

/** Confidence penalty per retry. */
const RETRY_PENALTY = 0.1;

/** Minimum confidence floor. */
const MIN_CONFIDENCE = 0.1;

/** Maximum confidence ceiling. */
const MAX_CONFIDENCE = 0.95;

// ---------------------------------------------------------------------------
// Output Types
// ---------------------------------------------------------------------------

/**
 * Output of a memory proposal generation.
 *
 * Contains a partial MemoryRecord that can be persisted into the memory store,
 * along with the evidence sources that back it and a confidence score.
 */
export interface MemoryProposalOutput {
	/** Partial memory record (type, title, content, provenance, etc.) */
	memory: Partial<MemoryRecord>;
	/** Source references from the reflection evidence */
	evidence: SourceRef[];
	/** Computed confidence score (0-1) */
	confidence: number;
}

// ---------------------------------------------------------------------------
// Memory Proposal Generator
// ---------------------------------------------------------------------------

export class MemoryProposalGenerator {
	// -----------------------------------------------------------------------
	// Main entry point
	// -----------------------------------------------------------------------

	/**
	 * Generate memory proposals from a full reflection report.
	 *
	 * Produces proposals for failures, successes, and architecture changes
	 * detected in the report. Each proposal carries source references and
	 * a confidence score.
	 *
	 * @param report - The completed reflection report
	 * @returns Array of memory proposal outputs
	 */
	fromReflection(report: ReflectionReport): MemoryProposalOutput[] {
		const proposals: MemoryProposalOutput[] = [];
		const evidence = report.sources ?? [];

		// Generate failure memory proposals
		if (report.whatFailed.length > 0) {
			const failureEvidence = this.filterSourcesByIdPrefix(evidence, "workspace-");
			const retryCount = report.retryCount;
			const confidence = this.computeConfidence(failureEvidence.length, retryCount, report.whatFailed.length);

			const memory: Partial<MemoryRecord> = {
				type: "failure_memory",
				title: `Failure pattern: ${report.whatFailed.length} workspace(s) failed`,
				content: this.buildReflectionFailureContent(report),
				summary: `${report.whatFailed.length} workspace(s) failed during execution`,
				lifecycle: "candidate",
				confidence,
				provenance: {
					sourceRefs: this.toMemorySourceRefs(failureEvidence),
					validatedBy: "system",
				},
				tags: ["reflection", "failure", "auto-generated"],
				category: "failure",
				metadata: {
					generatedBy: "MemoryProposalGenerator",
					sourceCount: failureEvidence.length,
					totalFailures: report.whatFailed.length,
					totalRetries: retryCount,
				},
			};

			proposals.push({ memory, evidence: failureEvidence, confidence });
		}

		// Generate execution memory proposals
		if (report.whatWorked.length > 0) {
			const successEvidence = this.filterSourcesByIdPrefix(evidence, "workspace-");
			const confidence = this.computeConfidence(successEvidence.length, report.retryCount, report.whatWorked.length);

			const memory: Partial<MemoryRecord> = {
				type: "execution_memory",
				title: `Execution results: ${report.whatWorked.length} workspace(s) completed successfully`,
				content: this.buildReflectionSuccessContent(report),
				summary: `${report.whatWorked.length} workspace(s) completed successfully in this reflection cycle`,
				lifecycle: "candidate",
				confidence: Math.min(confidence + SUCCESS_CONFIDENCE_BOOST, MAX_CONFIDENCE),
				provenance: {
					sourceRefs: this.toMemorySourceRefs(successEvidence),
					validatedBy: "system",
				},
				tags: ["reflection", "success", "auto-generated"],
				category: "success",
				metadata: {
					generatedBy: "MemoryProposalGenerator",
					sourceCount: successEvidence.length,
					totalSuccesses: report.whatWorked.length,
					totalRetries: report.retryCount,
				},
			};

			proposals.push({ memory, evidence: successEvidence, confidence });
		}

		// Generate architecture memory proposals
		if (report.whatRan.length > 0) {
			const archEvidence = this.filterSourcesByIdPrefix(evidence, "workspace-");
			const confidence = this.computeConfidence(archEvidence.length, report.retryCount, report.whatRan.length);

			const memory: Partial<MemoryRecord> = {
				type: "architecture_memory",
				title: `Workspace topology: ${report.whatRan.length} workspace(s) executed`,
				content: this.buildReflectionArchitectureContent(report),
				summary: `Execution topology with ${report.whatRan.length} workspace(s) across the plan`,
				lifecycle: "candidate",
				confidence,
				provenance: {
					sourceRefs: this.toMemorySourceRefs(archEvidence),
					validatedBy: "system",
				},
				tags: ["reflection", "architecture", "auto-generated"],
				category: "architecture",
				metadata: {
					generatedBy: "MemoryProposalGenerator",
					sourceCount: archEvidence.length,
					totalWorkspaces: report.whatRan.length,
					totalRetries: report.retryCount,
				},
			};

			proposals.push({ memory, evidence: archEvidence, confidence });
		}

		return proposals;
	}

	// -----------------------------------------------------------------------
	// Specific generators
	// -----------------------------------------------------------------------

	/**
	 * Generate failure memory proposals from failed workspace outcomes.
	 *
	 * @param failed - List of workspace IDs or descriptions that failed
	 * @param outcomes - Workspace outcomes from the execution
	 * @returns Array of failure memory proposals
	 */
	fromFailures(failed: string[], outcomes: WorkspaceOutcome[]): MemoryProposalOutput[] {
		if (failed.length === 0) return [];

		const output: MemoryProposalOutput[] = [];
		const grouped = this.groupFailurePatterns(failed, outcomes);

		for (const [pattern, entries] of grouped) {
			const evidence = this.mapFailuresToSources(entries, outcomes);
			const retryCount = this.computeTotalRetriesForEntries(entries, outcomes);
			const confidence = this.computeConfidence(evidence.length, retryCount, entries.length);

			const memory: Partial<MemoryRecord> = {
				type: "failure_memory",
				title: `Failure pattern: ${pattern}`,
				content: this.buildFailureContent(pattern, entries, outcomes),
				summary: this.buildFailureSummary(pattern, entries),
				lifecycle: "candidate",
				confidence,
				provenance: {
					sourceRefs: this.toMemorySourceRefs(evidence),
					validatedBy: "system",
				},
				tags: ["reflection", "failure", "auto-generated"],
				category: "failure",
				metadata: {
					generatedBy: "MemoryProposalGenerator",
					sourceCount: evidence.length,
					totalFailures: entries.length,
					totalRetries: retryCount,
				},
			};

			output.push({ memory, evidence, confidence });
		}

		// If no patterns grouped, create individual proposals
		if (output.length === 0) {
			for (const entry of failed) {
				const evidence = this.mapFailuresToSources([entry], outcomes);
				const retryCount = this.computeTotalRetriesForEntries([entry], outcomes);
				const confidence = this.computeConfidence(evidence.length, retryCount, 1);

				const memory: Partial<MemoryRecord> = {
					type: "failure_memory",
					title: `Failure: ${this.describeEntry(entry)}`,
					content: this.buildIndividualFailureContent(entry, outcomes),
					summary: this.describeEntry(entry),
					lifecycle: "candidate",
					confidence,
					provenance: {
						sourceRefs: this.toMemorySourceRefs(evidence),
						validatedBy: "system",
					},
					tags: ["reflection", "failure", "auto-generated"],
					category: "failure",
					metadata: {
						generatedBy: "MemoryProposalGenerator",
						sourceCount: evidence.length,
						totalRetries: retryCount,
					},
				};

				output.push({ memory, evidence, confidence });
			}
		}

		return output;
	}

	/**
	 * Generate execution memory proposals from successful workspace outcomes.
	 *
	 * @param worked - List of workspace IDs or descriptions that succeeded
	 * @param outcomes - Workspace outcomes from the execution
	 * @returns Array of execution memory proposals
	 */
	fromSuccesses(worked: string[], outcomes: WorkspaceOutcome[]): MemoryProposalOutput[] {
		if (worked.length === 0) return [];

		const output: MemoryProposalOutput[] = [];
		const evidence = this.mapOutcomesToSourcesFromList(worked, outcomes);
		const retryCount = this.computeTotalRetriesFromList(worked, outcomes);
		const confidence = this.computeConfidence(evidence.length, retryCount, worked.length);

		const content = this.buildSuccessContent(worked, outcomes);

		const memory: Partial<MemoryRecord> = {
			type: "execution_memory",
			title: `Execution results: ${worked.length} workspace(s) completed successfully`,
			content,
			summary: `${worked.length} workspace(s) completed successfully in this reflection cycle`,
			lifecycle: "candidate",
			confidence: Math.min(confidence + SUCCESS_CONFIDENCE_BOOST, MAX_CONFIDENCE),
			provenance: {
				sourceRefs: this.toMemorySourceRefs(evidence),
				validatedBy: "system",
			},
			tags: ["reflection", "success", "auto-generated"],
			category: "success",
			metadata: {
				generatedBy: "MemoryProposalGenerator",
				sourceCount: evidence.length,
				totalSuccesses: worked.length,
				totalRetries: retryCount,
			},
		};

		output.push({ memory, evidence, confidence });

		return output;
	}

	/**
	 * Generate architecture memory proposals from what ran.
	 *
	 * @param whatRan - List of workspace IDs or descriptions that ran
	 * @param outcomes - Workspace outcomes from the execution
	 * @returns Array of architecture memory proposals
	 */
	fromArchitecture(whatRan: string[], outcomes: WorkspaceOutcome[]): MemoryProposalOutput[] {
		if (whatRan.length === 0) return [];

		const output: MemoryProposalOutput[] = [];
		const evidence = this.mapOutcomesToSourcesFromList(whatRan, outcomes);
		const retryCount = this.computeTotalRetriesFromList(whatRan, outcomes);
		const confidence = this.computeConfidence(evidence.length, retryCount, whatRan.length);

		const content = this.buildArchitectureContent(whatRan, outcomes);

		const memory: Partial<MemoryRecord> = {
			type: "architecture_memory",
			title: `Workspace topology: ${whatRan.length} workspace(s) executed`,
			content,
			summary: `Execution topology with ${whatRan.length} workspace(s) across the plan`,
			lifecycle: "candidate",
			confidence,
			provenance: {
				sourceRefs: this.toMemorySourceRefs(evidence),
				validatedBy: "system",
			},
			tags: ["reflection", "architecture", "auto-generated"],
			category: "architecture",
			metadata: {
				generatedBy: "MemoryProposalGenerator",
				sourceCount: evidence.length,
				totalWorkspaces: whatRan.length,
				totalRetries: retryCount,
			},
		};

		output.push({ memory, evidence, confidence });

		return output;
	}

	// -----------------------------------------------------------------------
	// Confidence calculation
	// -----------------------------------------------------------------------

	/**
	 * Compute a confidence score based on evidence strength and retry count.
	 *
	 * @param sourceCount - Number of evidence sources
	 * @param retryCount - Total number of retries across affected workspaces
	 * @param outcomeCount - Number of outcomes in this group
	 * @returns Confidence score between 0 and 1
	 */
	computeConfidence(sourceCount: number, retryCount: number, outcomeCount: number): number {
		// Base confidence from minimum evidence requirement
		let confidence = BASE_CONFIDENCE;

		// Boost from multiple sources (diminishing returns)
		if (sourceCount >= MIN_SOURCE_REFS) {
			confidence += Math.min((sourceCount - MIN_SOURCE_REFS) * 0.1, 0.3);
		}

		// Boost from multiple outcomes corroborating the pattern
		if (outcomeCount > 1) {
			confidence += Math.min((outcomeCount - 1) * 0.05, 0.15);
		}

		// Penalty for retries (reduces confidence in reliability)
		if (retryCount > 0) {
			confidence -= retryCount * RETRY_PENALTY;
		}

		return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, confidence));
	}

	// -----------------------------------------------------------------------
	// Source mapping
	// -----------------------------------------------------------------------

	/**
	 * Filter source references by ID prefix.
	 * Used to find relevant evidence sources for a category.
	 *
	 * @param sources - All sources from the report
	 * @param prefix - The prefix to filter by (e.g. "workspace-")
	 * @returns Filtered source references
	 */
	private filterSourcesByIdPrefix(sources: SourceRef[], prefix: string): SourceRef[] {
		return sources.filter((s) => s.id.startsWith(prefix));
	}

	/**
	 * Map failed entries to source references from workspace outcomes.
	 *
	 * @param entries - Failed workspace descriptions or IDs
	 * @param outcomes - All workspace outcomes
	 * @returns Array of source references for the failures
	 */
	mapFailuresToSources(entries: string[], outcomes: WorkspaceOutcome[]): SourceRef[] {
		const sources: SourceRef[] = [];

		for (const entry of entries) {
			// Try to match the entry to a workspace outcome by ID
			const matchingOutcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));

			if (matchingOutcome) {
				sources.push({
					type: "workspace",
					id: `workspace-${matchingOutcome.workspaceId}`,
					description: matchingOutcome.summary ?? `Workspace outcome for ${matchingOutcome.workspaceId}`,
				});
			} else {
				sources.push({
					type: "workspace",
					id: `failure-${entry.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
					description: entry,
				});
			}
		}

		return sources;
	}

	/**
	 * Map workspace IDs to source references from workspace outcomes.
	 *
	 * @param workspaceIds - List of workspace IDs or descriptions
	 * @param outcomes - All workspace outcomes
	 * @returns Array of source references
	 */
	private mapOutcomesToSourcesFromList(workspaceIds: string[], outcomes: WorkspaceOutcome[]): SourceRef[] {
		const sources: SourceRef[] = [];

		for (const id of workspaceIds) {
			const matchingOutcome = outcomes.find((o) => o.workspaceId === id || o.summary?.includes(id));

			if (matchingOutcome) {
				sources.push({
					type: "workspace",
					id: `workspace-${matchingOutcome.workspaceId}`,
					description: matchingOutcome.summary ?? `Workspace outcome for ${matchingOutcome.workspaceId}`,
				});
			} else {
				sources.push({
					type: "workspace",
					id: `workspace-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
					description: id,
				});
			}
		}

		return sources;
	}

	// -----------------------------------------------------------------------
	// Formatting
	// -----------------------------------------------------------------------

	/**
	 * Format a memory proposal output as a partial Proposal record.
	 *
	 * This allows memory proposals to be surfaced through the proposal
	 * inbox and approval workflow if desired.
	 *
	 * @param output - The memory proposal output
	 * @returns A partial Proposal record
	 */
	formatAsProposal(output: MemoryProposalOutput): Partial<Proposal> {
		return {
			type: "memory_proposal",
			title: output.memory.title ?? "Untitled Memory Proposal",
			description: output.memory.content ?? "",
			evidence: {
				memoryIds: [],
				observationIds: [],
				sourceRefs: this.toMemorySourceRefs(output.evidence),
				confidence: output.confidence,
				evidenceSummary: this.buildEvidenceSummary(output.evidence),
			},
			risk: {
				level: "low",
				factors: [],
				mitigation: [],
				affectedSystems: [],
				impactDescription: `Memory proposal for type: ${output.memory.type ?? "unknown"}`,
			},
			status: "draft",
			submittedBy: "pi",
			tags: ["memory-proposal", "auto-generated", "reflection"],
			metadata: {
				memoryType: output.memory.type,
				confidence: output.confidence,
				evidenceCount: output.evidence.length,
			},
		};
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Convert reflection SourceRefs to MemorySourceRefs for persistence.
	 */
	private toMemorySourceRefs(sources: SourceRef[]): MemorySourceRef[] {
		return sources.map((s) => ({
			type: "reflection",
			path: `reflection:${s.id}`,
			id: s.id,
			timestamp: new Date().toISOString(),
		}));
	}

	/**
	 * Build an evidence summary from source references.
	 */
	private buildEvidenceSummary(sources: SourceRef[]): string {
		if (sources.length === 0) return "No evidence available";
		if (sources.length === 1) return `Based on ${sources[0].description}`;
		return `Based on ${sources.length} evidence sources: ${sources.map((s) => s.description).join(", ")}`;
	}

	/**
	 * Group failed entries into patterns based on error types and outcomes.
	 */
	private groupFailurePatterns(failed: string[], outcomes: WorkspaceOutcome[]): Map<string, string[]> {
		const grouped = new Map<string, string[]>();

		for (const entry of failed) {
			const outcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));

			if (outcome?.errorTypes && outcome.errorTypes.length > 0) {
				// Group by the first error type as the pattern
				const pattern = outcome.errorTypes[0];
				if (!grouped.has(pattern)) {
					grouped.set(pattern, []);
				}
				grouped.get(pattern)!.push(entry);
			} else {
				// No error types — group as generic
				const pattern = "generic-failure";
				if (!grouped.has(pattern)) {
					grouped.set(pattern, []);
				}
				grouped.get(pattern)!.push(entry);
			}
		}

		return grouped;
	}

	/**
	 * Compute total retries for specific entries across all outcomes.
	 */
	private computeTotalRetriesForEntries(entries: string[], outcomes: WorkspaceOutcome[]): number {
		let total = 0;
		for (const entry of entries) {
			const outcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));
			total += outcome?.retryCount ?? 0;
		}
		return total;
	}

	/**
	 * Compute total retries from a list of workspace IDs.
	 */
	private computeTotalRetriesFromList(workspaceIds: string[], outcomes: WorkspaceOutcome[]): number {
		let total = 0;
		for (const id of workspaceIds) {
			const outcome = outcomes.find((o) => o.workspaceId === id);
			total += outcome?.retryCount ?? 0;
		}
		return total;
	}

	/**
	 * Extract a brief description from a workspace entry.
	 */
	private describeEntry(entry: string): string {
		// If it looks like a workspace ID, return it as-is
		if (entry.length <= 20) return entry;
		// Otherwise truncate
		return entry.length > 80 ? `${entry.slice(0, 80)}...` : entry;
	}

	/**
	 * Build content for a failure memory proposal.
	 */
	private buildFailureContent(pattern: string, entries: string[], outcomes: WorkspaceOutcome[]): string {
		const lines: string[] = [
			`Failure Pattern: ${pattern}`,
			"",
			`${entries.length} workspace(s) exhibited this failure pattern.`,
			"",
			"Affected Workspaces:",
		];

		for (const entry of entries) {
			const outcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));
			lines.push(`- ${entry}${outcome ? ` (retries: ${outcome.retryCount})` : ""}`);
		}

		lines.push("", "Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build a summary for a failure memory proposal.
	 */
	private buildFailureSummary(pattern: string, entries: string[]): string {
		return `${entries.length} workspace(s) failed with pattern: ${pattern}`;
	}

	/**
	 * Build content for an individual failure memory proposal.
	 */
	private buildIndividualFailureContent(entry: string, outcomes: WorkspaceOutcome[]): string {
		const outcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));

		const lines: string[] = [`Failure: ${entry}`, ""];

		if (outcome) {
			lines.push(`Status: ${outcome.status}`);
			lines.push(`Retries: ${outcome.retryCount}`);
			if (outcome.errorTypes && outcome.errorTypes.length > 0) {
				lines.push(`Error Types: ${outcome.errorTypes.join(", ")}`);
			}
			if (outcome.summary) {
				lines.push(`Summary: ${outcome.summary}`);
			}
		}

		lines.push("", "Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build content for a success execution memory proposal.
	 */
	private buildSuccessContent(worked: string[], outcomes: WorkspaceOutcome[]): string {
		const lines: string[] = [`${worked.length} workspace(s) completed successfully.`, "", "Successful Workspaces:"];

		for (const entry of worked) {
			const outcome = outcomes.find((o) => o.workspaceId === entry || o.summary?.includes(entry));
			lines.push(`- ${entry}${outcome ? ` (duration: ${outcome.duration}ms, retries: ${outcome.retryCount})` : ""}`);
		}

		lines.push("", "Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build content for an architecture memory proposal.
	 */
	private buildArchitectureContent(whatRan: string[], outcomes: WorkspaceOutcome[]): string {
		const lines: string[] = [`Execution topology with ${whatRan.length} workspace(s).`, "", "Workspaces:"];

		for (const id of whatRan) {
			const outcome = outcomes.find((o) => o.workspaceId === id);
			lines.push(`- ${id}: ${outcome?.status ?? "unknown"}${outcome ? ` (${outcome.duration}ms)` : ""}`);
		}

		lines.push("", "Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build failure content from a reflection report (no WorkspaceOutcome data).
	 */
	private buildReflectionFailureContent(report: ReflectionReport): string {
		const lines: string[] = [`${report.whatFailed.length} workspace(s) failed.`, "", "Failed Workspaces:"];

		for (const entry of report.whatFailed) {
			lines.push(`- ${entry}`);
		}

		lines.push("");
		lines.push(`Success rate: ${(report.successRate * 100).toFixed(1)}%`);
		lines.push(`Total retries across plan: ${report.retryCount}`);
		lines.push("");
		lines.push("Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build success content from a reflection report (no WorkspaceOutcome data).
	 */
	private buildReflectionSuccessContent(report: ReflectionReport): string {
		const lines: string[] = [
			`${report.whatWorked.length} workspace(s) completed successfully.`,
			"",
			"Successful Workspaces:",
		];

		for (const entry of report.whatWorked) {
			lines.push(`- ${entry}`);
		}

		lines.push("");
		lines.push(`Success rate: ${(report.successRate * 100).toFixed(1)}%`);
		lines.push(`Total validation failures: ${report.validationFailures}`);
		lines.push("");
		lines.push("Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}

	/**
	 * Build architecture content from a reflection report (no WorkspaceOutcome data).
	 */
	private buildReflectionArchitectureContent(report: ReflectionReport): string {
		const lines: string[] = [`Execution topology with ${report.whatRan.length} workspace(s).`, "", "Workspaces:"];

		for (const id of report.whatRan) {
			lines.push(`- ${id}`);
		}

		lines.push("");
		lines.push(`Total workspaces: ${report.workspaceCount}`);
		lines.push(`Duration: ${report.totalDuration}ms`);
		lines.push("");
		lines.push("Generated by MemoryProposalGenerator from reflection analysis.");

		return lines.join("\n");
	}
}
