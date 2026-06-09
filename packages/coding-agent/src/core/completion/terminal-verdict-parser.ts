/**
 * P44.04 — Terminal Verdict Parser
 *
 * Parses terminal verdicts from agent execution outputs.
 * Extracts structured verdict results from the last assistant message
 * by searching for VERDICT: COMPLETE / BLOCKED / FAILED patterns.
 *
 * The parser handles:
 * - Explicit verdict markers in assistant output
 * - Implicit completion indicators when no explicit marker is present
 * - Empty or aborted responses
 * - Provider-empty responses (transient failures)
 *
 * Consumed by:
 * - TerminalVerdictReconciler (P44.04) for attempt finalization
 * - WorkspaceAgentExecutor for inline verdict extraction
 *
 * Contract Schema: 4.1.4
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed terminal verdict from agent output.
 */
export type TerminalVerdict = "COMPLETE" | "BLOCKED" | "FAILED";

/**
 * Confidence level for the parsed verdict.
 */
export type VerdictConfidence = "high" | "medium" | "low";

/**
 * Result of parsing an agent message for a terminal verdict.
 */
export interface TerminalVerdictParseResult {
	/** The parsed verdict */
	verdict: TerminalVerdict;
	/** Confidence in the parsed result */
	confidence: VerdictConfidence;
	/** Human-readable reasoning for this verdict */
	reasoning: string;
	/** The source text that was parsed (truncated for large outputs) */
	sourceSnippet: string;
}

/**
 * Options for parsing terminal verdicts.
 */
export interface TerminalVerdictParserOptions {
	/**
	 * Maximum length of source snippet to include in parse result.
	 * Default: 500 chars.
	 */
	maxSnippetLength?: number;

	/**
	 * If true, treat messages containing "complete" or "done" (case-insensitive)
	 * as implicit COMPLETE when no explicit marker is found.
	 * Default: true.
	 */
	enableImplicitCompletion?: boolean;

	/**
	 * Default verdict when no pattern is found and implicit completion is disabled.
	 * Default: "FAILED".
	 */
	defaultVerdict?: TerminalVerdict;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** VERDICT pattern markers */
const VERDICT_PATTERNS: Record<TerminalVerdict, RegExp> = {
	COMPLETE: /VERDICT\s*:\s*COMPLETE/i,
	BLOCKED: /VERDICT\s*:\s*BLOCKED/i,
	FAILED: /VERDICT\s*:\s*FAILED/i,
};

/** Implicit completion indicators */
const IMPLICIT_COMPLETE_PATTERNS = [
	/\btask\s+complete\b/i,
	/\ball\s+(acceptance\s+)?criteria\s+met\b/i,
	/\bimplementation\s+complete\b/i,
	/\bworkspace\s+complete\b/i,
	/\bfinished\s+successfully\b/i,
];

// ---------------------------------------------------------------------------
// Default Options
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: TerminalVerdictParserOptions = {
	maxSnippetLength: 500,
	enableImplicitCompletion: true,
	defaultVerdict: "FAILED",
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a terminal verdict from agent assistant message content.
 *
 * Priority order:
 * 1. Explicit "VERDICT: COMPLETE|BLOCKED|FAILED" marker
 * 2. Implicit completion indicators (if enabled)
 * 3. Default verdict
 *
 * @param content - The text content of the last assistant message
 * @param options - Parser options (optional)
 * @returns Parsed terminal verdict result
 */
export function parseTerminalVerdict(
	content: string,
	options?: TerminalVerdictParserOptions,
): TerminalVerdictParseResult {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const sourceSnippet =
		content.length > opts.maxSnippetLength!
			? `${content.slice(0, opts.maxSnippetLength!)}... [truncated ${content.length - opts.maxSnippetLength!} chars]`
			: content;

	if (!content || content.trim().length === 0) {
		return {
			verdict: "FAILED",
			confidence: "medium",
			reasoning: "Empty assistant message content — no output produced",
			sourceSnippet,
		};
	}

	// 1. Check explicit verdict markers in order
	for (const verdict of ["COMPLETE", "BLOCKED", "FAILED"] as TerminalVerdict[]) {
		if (VERDICT_PATTERNS[verdict].test(content)) {
			// Try to extract reasoning after the verdict
			const match = content.match(VERDICT_PATTERNS[verdict]);
			const afterVerdict = match ? content.slice(match.index! + match[0].length).trim() : "";
			let reasoning = `Explicit verdict marker found: ${verdict}`;
			if (afterVerdict) {
				// Get the first line or sentence after the verdict
				const firstLine = afterVerdict.split("\n")[0].trim();
				if (firstLine && firstLine.length > 0) {
					reasoning += ` — ${firstLine.slice(0, 200)}`;
				}
			}

			return {
				verdict,
				confidence: "high",
				reasoning,
				sourceSnippet,
			};
		}
	}

	// 2. Check implicit completion indicators
	if (opts.enableImplicitCompletion) {
		for (const pattern of IMPLICIT_COMPLETE_PATTERNS) {
			if (pattern.test(content)) {
				return {
					verdict: "COMPLETE",
					confidence: "medium",
					reasoning: "Implicit completion detected — content contains completion indicators",
					sourceSnippet,
				};
			}
		}
	}

	// 3. Fall back to default verdict
	return {
		verdict: opts.defaultVerdict!,
		confidence: "low",
		reasoning: `No verdict marker found in assistant output — using default: ${opts.defaultVerdict}`,
		sourceSnippet,
	};
}

/**
 * Check if a provider returned an empty assistant response (no text, no tools, no thinking).
 * This is used to detect transient provider failures where the stream completed
 * but produced no useful output.
 *
 * @param content - The message content text
 * @param hasToolCalls - Whether the message has tool calls
 * @param hasThinking - Whether the message has thinking blocks
 * @returns True if the response is considered provider-empty
 */
export function isEmptyProviderResponse(content: string, hasToolCalls: boolean, hasThinking: boolean): boolean {
	const trimmed = content.trim();
	return trimmed.length === 0 && !hasToolCalls && !hasThinking;
}

/**
 * Determine the fallback verdict when provider returns an empty response.
 *
 * @returns The appropriate failure verdict
 */
export function getEmptyResponseVerdict(): TerminalVerdict {
	return "FAILED";
}
