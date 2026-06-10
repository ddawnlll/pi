/**
 * P44.5.06 — Commit Message Composer
 *
 * Produces commit messages from runtime facts with LLM support and
 * deterministic fallback. Implements the circuit breaker:
 * - Timeout: 8s
 * - Max repair attempts: 1
 * - Fallback: deterministic runtime fact commit message
 * - Never blocks completion unless runtime fact packet is missing
 *
 * Contract Schema: 4.1.1
 */

import { buildFallbackCommitMessage, type RuntimeFactPacket } from "./commit-message-renderer.js";
import { validateCommitMessage } from "./commit-message-validator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum time (ms) to wait for LLM commit message generation.
 */
export const COMPOSER_TIMEOUT_MS = 8_000;

/**
 * Maximum repair attempts for invalid LLM output.
 */
export const MAX_REPAIR_ATTEMPTS = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of the commit message composition.
 */
export interface CommitMessageComposerResult {
	/** The final commit message */
	message: string;
	/** Whether the LLM composer was used (vs fallback) */
	usedLlm: boolean;
	/** Whether fallback was used */
	usedFallback: boolean;
	/** Validation result (if applicable) */
	validation?: {
		valid: boolean;
		reasons: string[];
	};
	/** Error if composition failed entirely */
	error?: string;
}

/**
 * LLM-based commit message generator function.
 * Injected to allow testing without real LLM.
 */
export type LlmCommitMessageGenerator = (facts: RuntimeFactPacket) => Promise<string | null>;

// ---------------------------------------------------------------------------
// Default Required Trailers
// ---------------------------------------------------------------------------

/**
 * Required trailers that must be in every commit message.
 */
export const REQUIRED_COMMIT_TRAILERS = [
	"Pi-Plan",
	"Pi-Workspace",
	"Pi-Agent",
	"Pi-Completion-Gate",
	"Pi-Commit-Durability",
	"Pi-Validation",
	"Pi-Generated-By",
] as const;

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * Compose a commit message from runtime facts.
 *
 * First tries the LLM composer (if provided), with timeout and repair.
 * Falls back to deterministic message if LLM is unavailable, times out,
 * or produces invalid output.
 *
 * @param facts - Runtime fact packet (authoritative)
 * @param trailers - Commit trailers to append
 * @param llmGenerator - Optional LLM commit message generator
 * @returns Composed commit message result
 */
export async function composeCommitMessage(
	facts: RuntimeFactPacket,
	trailers: Record<string, string>,
	llmGenerator?: LlmCommitMessageGenerator,
): Promise<CommitMessageComposerResult> {
	// Validate runtime fact packet
	if (!facts || !facts.planId || !facts.workspaceId) {
		return {
			message: "Runtime fact packet is missing or invalid — cannot compose commit message",
			usedLlm: false,
			usedFallback: false,
			error: "Runtime fact packet missing",
		};
	}

	// Try LLM composer if available
	if (llmGenerator) {
		const llmResult = await tryLlmWithCircuitBreaker(facts, llmGenerator, trailers);
		if (llmResult && !llmResult.usedFallback) {
			return llmResult;
		}
		if (llmResult?.usedFallback) {
			// LLM produced invalid output — fallback
			return llmResult;
		}
	}

	// Use deterministic fallback
	const fallback = buildFallbackCommitMessage(facts, trailers);
	return {
		message: fallback.fullMessage,
		usedLlm: false,
		usedFallback: true,
	};
}

/**
 * Try the LLM composer with circuit breaker.
 * Timeout after COMPOSER_TIMEOUT_MS, retry once, then fallback.
 */
async function tryLlmWithCircuitBreaker(
	facts: RuntimeFactPacket,
	llmGenerator: LlmCommitMessageGenerator,
	trailers: Record<string, string>,
): Promise<CommitMessageComposerResult | null> {
	let lastError: string | undefined;

	for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
		try {
			const llmMessage = await withTimeout(llmGenerator(facts), COMPOSER_TIMEOUT_MS);

			if (llmMessage === null) {
				lastError = "LLM returned null";
				continue;
			}

			// Append trailers to LLM message
			const fullMessage = appendTrailers(llmMessage, trailers);

			// Validate
			const validation = validateCommitMessage(fullMessage, facts, [...REQUIRED_COMMIT_TRAILERS]);

			if (validation.valid) {
				return {
					message: fullMessage,
					usedLlm: true,
					usedFallback: false,
					validation: {
						valid: true,
						reasons: [],
					},
				};
			}

			lastError = `LLM output invalid: ${validation.reasons.join("; ")}`;

			// One repair attempt: give LLM another chance
			if (attempt < MAX_REPAIR_ATTEMPTS) {
				continue;
			}

			// After max attempts, use fallback
			const fallback = buildFallbackCommitMessage(facts, trailers);
			return {
				message: fallback.fullMessage,
				usedLlm: true,
				usedFallback: true,
				validation: {
					valid: false,
					reasons: validation.reasons,
				},
			};
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
			// Timeout: try once more, then fallback
			if (attempt < MAX_REPAIR_ATTEMPTS) {
				continue;
			}

			// After max attempts, use fallback
			const fallback = buildFallbackCommitMessage(facts, trailers);
			return {
				message: fallback.fullMessage,
				usedLlm: true,
				usedFallback: true,
				error: lastError,
			};
		}
	}

	// Final fallback
	const fallback = buildFallbackCommitMessage(facts, trailers);
	return {
		message: fallback.fullMessage,
		usedLlm: false,
		usedFallback: true,
		error: lastError,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a promise with a timeout.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)),
	]);
}

/**
 * Append trailers to an LLM-generated commit message.
 */
function appendTrailers(message: string, trailers: Record<string, string>): string {
	const lines = message.split("\n");
	const trailingNewline = message.endsWith("\n") ? "\n" : "";

	// Find existing trailers in the message
	const existingTrailersEnd = findTrailerSectionEnd(lines);

	// Remove any existing trailer lines
	const bodyLines = existingTrailersEnd > 0 ? lines.slice(0, existingTrailersEnd) : lines;

	const result = [...bodyLines];
	if (result[result.length - 1] !== "") {
		result.push("");
	}

	for (const [key, value] of Object.entries(trailers)) {
		result.push(`${key}: ${value}`);
	}

	return result.join("\n") + trailingNewline;
}

/**
 * Find where the trailer section ends in a message.
 */
function findTrailerSectionEnd(lines: string[]): number {
	let lastTrailerLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(": ") && lines[i].length < 80) {
			lastTrailerLine = i;
		}
	}
	return lastTrailerLine > 0 ? lastTrailerLine + 1 : lines.length;
}
