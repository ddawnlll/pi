/**
 * P44.5.06 — Commit Message Validator
 *
 * Validates commit messages produced by the LLM composer.
 * Rejects messages that:
 * - Reference files not in the runtime fact packet
 * - Claim tests passing when results show failure
 * - Mention scope or packages not in the runtime fact packet
 * - Are missing body for commits that touch more than 5 files
 * - Are missing required git identity trailers
 *
 * Contract Schema: 4.1.1
 */

import type { RuntimeFactPacket } from "./commit-message-renderer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of validating a commit message.
 */
export interface CommitMessageValidationResult {
	/** Whether the message is valid */
	valid: boolean;
	/** Reasons for invalidation */
	reasons: string[];
	/** Whether to use the deterministic fallback instead */
	useFallback: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Maximum body length for a single line in the commit message.
 */
export const MAX_LINE_LENGTH = 72;

/**
 * Minimum number of files changed before body is required.
 */
export const BODY_REQUIRED_FILE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an LLM-generated commit message against runtime facts.
 *
 * @param message - The commit message to validate
 * @param facts - Runtime fact packet (authoritative source of truth)
 * @param requiredTrailers - List of trailer keys that must be present
 * @returns Validation result
 */
export function validateCommitMessage(
	message: string,
	facts: RuntimeFactPacket,
	requiredTrailers: string[],
): CommitMessageValidationResult {
	const reasons: string[] = [];

	// Check for empty message
	if (!message || message.trim().length === 0) {
		return {
			valid: false,
			reasons: ["Commit message is empty"],
			useFallback: true,
		};
	}

	const lines = message.split("\n");
	const firstLine = lines[0]?.trim() ?? "";

	// Check first line format: type(scope): description
	if (!/^[a-zA-Z]+\([^)]+\): .+/.test(firstLine)) {
		reasons.push("First line does not match format: type(scope): description");
	}

	// Check for invented files
	const filePattern = /\b([a-zA-Z0-9_\-./]+\.(ts|js|tsx|jsx|json|md|yaml|yml|css|html))\b/g;
	const mentionedFiles = [...message.matchAll(filePattern)].map((m) => m[1]);
	const verifiedFiles = new Set(facts.filesChanged);

	for (const mentioned of mentionedFiles) {
		if (!verifiedFiles.has(mentioned)) {
			reasons.push(`Message references file not in verified facts: ${mentioned}`);
		}
	}

	// Check for invented test claims
	const testPassPattern = /\btests?\s+(are\s+)?(pass|succeed|green|passing)\b/i;
	const testFailPattern = /\btests?\s+(are\s+)?(fail|broken|red)\b/i;

	if (facts.allValidationPassed && testFailPattern.test(message)) {
		reasons.push("Message claims tests fail but all validation passed");
	}

	if (!facts.allValidationPassed && testPassPattern.test(message)) {
		reasons.push("Message claims tests pass but validation has failures");
	}

	// Check body requirement for large commits
	if (facts.filesChanged.length >= BODY_REQUIRED_FILE_THRESHOLD) {
		const bodyLines = lines.slice(2).filter((l) => l.trim().length > 0 && !l.includes(": "));
		if (bodyLines.length < 1) {
			reasons.push(`Body is required for commits with ${BODY_REQUIRED_FILE_THRESHOLD}+ files`);
		}
	}

	// Check line length
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].length > MAX_LINE_LENGTH && !lines[i].includes(": ")) {
			reasons.push(`Line ${i + 1} exceeds ${MAX_LINE_LENGTH} characters`);
		}
	}

	// Check required trailers are present
	const messageTrailers = extractTrailers(message);
	for (const trailer of requiredTrailers) {
		if (!messageTrailers[trailer]) {
			reasons.push(`Required trailer missing: ${trailer}`);
		}
	}

	// Check for invalid scope references
	const messageScope = extractScopeFromMessage(message);
	if (messageScope) {
		// Extract all possible scope candidates from file paths (package names, directories)
		const knownScopes = [
			...new Set(
				facts.filesChanged.map((f) => {
					const parts = f.split("/");
					// For packages/xyz/src/..., the scope is the package name
					if (parts[0] === "packages" && parts[1]) return parts[1];
					// For top-level dirs, use the first segment
					if (parts[0]) return parts[0];
					return "";
				}),
			),
		];
		if (knownScopes.length > 0 && !knownScopes.some((s) => messageScope.includes(s))) {
			reasons.push(`Scope "${messageScope}" not found in any changed file paths`);
		}
	}

	const useFallback = reasons.length > 0;

	return {
		valid: reasons.length === 0,
		reasons,
		useFallback,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract trailers from a commit message (lines with "key: value" pattern).
 */
export function extractTrailers(message: string): Record<string, string> {
	const trailers: Record<string, string> = {};
	const lines = message.split("\n");

	for (const line of lines) {
		const colonIdx = line.indexOf(": ");
		if (colonIdx > 0) {
			const key = line.slice(0, colonIdx).trim();
			const value = line.slice(colonIdx + 2).trim();
			if (key.length > 0 && value.length > 0) {
				trailers[key] = value;
			}
		}
	}

	return trailers;
}

/**
 * Extract the scope from a commit message's first line.
 */
export function extractScopeFromMessage(message: string): string | undefined {
	const firstLine = message.split("\n")[0]?.trim();
	const match = firstLine?.match(/^[a-zA-Z]+\(([^)]+)\)/);
	return match?.[1];
}
