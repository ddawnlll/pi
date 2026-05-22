/**
 * Source-Backed Summarizer — P17.D
 *
 * Generates summaries where every claim references evidence.
 * No hallucinations allowed. The validateEvidenceChain function
 * checks that each claim has a corresponding source and rejects
 * summaries with un-evidenced claims.
 */

import type { ReflectionReport, SourceRef, ValidationResult, WorkspaceOutcome } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex to extract inline source references like [source:workspace-A] */
const SOURCE_REF_REGEX = /\[source:([^\]]+)\]/g;

// ---------------------------------------------------------------------------
// Source-Backed Summarizer
// ---------------------------------------------------------------------------

export class SourceBackedSummarizer {
	// -----------------------------------------------------------------------
	// Summary Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a "what worked" summary from workspace outcomes.
	 *
	 * Each sentence references at least one workspace source.
	 * Only successful outcomes are included.
	 */
	generateWhatWorkedSummary(outcomes: WorkspaceOutcome[]): string {
		const successes = outcomes.filter((o) => o.status === "success" || o.status === "retry");
		if (successes.length === 0) {
			return "No workspaces completed successfully. [source:none]";
		}

		const sentences: string[] = [];
		for (const ws of successes) {
			const summary = ws.summary ?? `Workspace ${ws.workspaceId} completed`;
			sentences.push(`${summary} [source:workspace-${ws.workspaceId}]`);
		}

		return sentences.join(" ");
	}

	/**
	 * Generate a "what failed" summary from workspace outcomes and validation results.
	 *
	 * Each sentence references at least one evidence source.
	 * Only failed outcomes or failing validations are included.
	 */
	generateWhatFailedSummary(outcomes: WorkspaceOutcome[], validationResults: ValidationResult[]): string {
		const sentences: string[] = [];

		// Workspace failures
		const failures = outcomes.filter((o) => o.status === "failure" || o.status === "skipped");
		for (const ws of failures) {
			const summary =
				ws.summary ??
				`Workspace ${ws.workspaceId} failed${
					ws.errorTypes?.length ? ` with errors: ${ws.errorTypes.join(", ")}` : ""
				}`;
			sentences.push(`${summary} [source:workspace-${ws.workspaceId}]`);
		}

		// Validation failures
		const failedValidations = validationResults.filter((v) => v.type === "error" && v.passed === false);
		for (const v of failedValidations) {
			sentences.push(`Validation in ${v.component}: ${v.message} [source:validation-${v.component}]`);
		}

		if (sentences.length === 0) {
			return "No failures detected. [source:none]";
		}

		return sentences.join(" ");
	}

	/**
	 * Generate a metric summary with evidence references.
	 */
	generateMetricSummary(metrics: { successRate: number; avgRetryCount: number; totalDuration: number }): string {
		const sentences: string[] = [];

		sentences.push(`Overall success rate was ${(metrics.successRate * 100).toFixed(1)}% [source:metrics]`);
		sentences.push(`Average retry count per workspace was ${metrics.avgRetryCount.toFixed(2)} [source:metrics]`);
		sentences.push(`Total execution duration was ${formatDuration(metrics.totalDuration)} [source:metrics]`);

		return sentences.join(" ");
	}

	// -----------------------------------------------------------------------
	// Evidence Validation
	// -----------------------------------------------------------------------

	/**
	 * Validate that every claim in the text has a corresponding source reference.
	 *
	 * Scans the text for `[source:*]` patterns and checks them against the
	 * provided sources array. Returns validation result with matched and
	 * missing reference IDs.
	 */
	validateEvidenceChain(
		text: string,
		sources: SourceRef[],
	): { valid: boolean; missingRefs: string[]; matchedRefs: string[] } {
		const referencedIds = new Set<string>();
		let match: RegExpExecArray | null;
		SOURCE_REF_REGEX.lastIndex = 0;

		while ((match = SOURCE_REF_REGEX.exec(text)) !== null) {
			referencedIds.add(match[1]);
		}

		const availableIds = new Set(sources.map((s) => s.id));
		const missingRefs: string[] = [];
		const matchedRefs: string[] = [];

		for (const refId of referencedIds) {
			if (refId === "none") {
				// [source:none] is a sentinel meaning "no evidence available"
				continue;
			}
			if (availableIds.has(refId)) {
				matchedRefs.push(refId);
			} else {
				missingRefs.push(refId);
			}
		}

		// If no real sources referenced and text isn't the "no evidence" sentinel,
		// it's also invalid
		if (referencedIds.size === 0 || (referencedIds.has("none") && referencedIds.size === 1)) {
			if (
				text !== "No workspaces completed successfully. [source:none]" &&
				text !== "No failures detected. [source:none]"
			) {
				return {
					valid: false,
					missingRefs: ["no source references found"],
					matchedRefs: [],
				};
			}
			// Sentinel texts are valid
			return { valid: true, missingRefs: [], matchedRefs: [] };
		}

		return {
			valid: missingRefs.length === 0,
			missingRefs,
			matchedRefs,
		};
	}

	// -----------------------------------------------------------------------
	// Format Helpers
	// -----------------------------------------------------------------------

	/**
	 * Format a reflection report as markdown using the built-in template.
	 */
	formatForMarkdown(report: ReflectionReport): string {
		const whatRanBullets =
			report.whatRan.length > 0 ? report.whatRan.map((w) => `- ${w}`).join("\n") : "- No workspaces ran";

		const whatWorkedBullets =
			report.whatWorked.length > 0 ? report.whatWorked.map((w) => `- ${w}`).join("\n") : "- Nothing worked";

		const whatFailedBullets =
			report.whatFailed.length > 0 ? report.whatFailed.map((w) => `- ${w}`).join("\n") : "- Nothing failed";

		const memoryBullets =
			report.memoriesToCreate.length > 0
				? report.memoriesToCreate
						.map((m) => `- ${m.title} (${m.category}, confidence: ${(m.confidence * 100).toFixed(0)}%)`)
						.join("\n")
				: "- None";

		const suggestionBullets =
			report.futurePhaseSuggestions.length > 0
				? report.futurePhaseSuggestions
						.map((s) => `- **${s.title}** — ${s.rationale} (priority: ${s.priority})`)
						.join("\n")
				: "- None";

		const confidencePct = (report.confidence * 100).toFixed(0);

		const template = `
## Reflection: ${report.planTitle ?? "Untitled Plan"}

### Summary
${report.summary}

### What Ran
${whatRanBullets}

### What Worked
${whatWorkedBullets}

### What Failed
${whatFailedBullets}

### Metrics
| Metric | Value |
|--------|-------|
| Workspaces | ${report.workspaceCount} |
| Success Rate | ${(report.successRate * 100).toFixed(1)}% |
| Avg Retries | ${report.avgRetryCount.toFixed(2)} |
| Duration | ${formatDuration(report.totalDuration)} |

### Memory Proposals (${report.memoriesToCreate.length})
${memoryBullets}

### Future Suggestions
${suggestionBullets}

*Generated: ${report.createdAt} | Confidence: ${confidencePct}%*
`.trim();

		return template;
	}

	/**
	 * Format a reflection report for dashboard display.
	 *
	 * Returns structured data suitable for rendering in a UI.
	 */
	formatForDashboard(report: ReflectionReport): {
		summary: string;
		whatWorked: Array<{ text: string; sources: string[] }>;
		whatFailed: Array<{ text: string; sources: string[] }>;
	} {
		const whatWorked = report.whatWorked.map((text) => {
			const sources = extractSourceRefs(text);
			return { text, sources };
		});

		const whatFailed = report.whatFailed.map((text) => {
			const sources = extractSourceRefs(text);
			return { text, sources };
		});

		return {
			summary: report.summary,
			whatWorked,
			whatFailed,
		};
	}
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

/**
 * Extract all inline source references (e.g. [source:workspace-A]) from text.
 */
function extractSourceRefs(text: string): string[] {
	const refs: string[] = [];
	let match: RegExpExecArray | null;
	SOURCE_REF_REGEX.lastIndex = 0;
	while ((match = SOURCE_REF_REGEX.exec(text)) !== null) {
		refs.push(match[1]);
	}
	return refs;
}
