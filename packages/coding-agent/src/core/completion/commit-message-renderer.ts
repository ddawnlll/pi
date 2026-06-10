/**
 * P44.5.06 — Commit Message Renderer
 *
 * Produces structured commit messages from runtime facts.
 * Two modes:
 * 1. LLM-authored: prose generated from runtime fact packet
 * 2. Deterministic fallback: structured message from runtime facts only
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// Runtime Fact Packet
// ---------------------------------------------------------------------------

/**
 * Verified runtime facts that form the ONLY source of truth for commit messages.
 * The composer must never invent facts outside this packet.
 */
export interface RuntimeFactPacket {
	/** Plan identifier */
	planId: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Wave identifier (optional) */
	waveId?: string;
	/** List of files changed (from git diff, NOT from agent claims) */
	filesChanged: string[];
	/** Number of files added */
	filesAdded: number;
	/** Number of files modified */
	filesModified: number;
	/** Number of files deleted */
	filesDeleted: number;
	/** Validation command results */
	validationResults: Array<{
		command: string;
		passed: boolean;
		outputExcerpt?: string;
	}>;
	/** Whether all validation passed */
	allValidationPassed: boolean;
	/** Exit code of the primary validation command */
	primaryExitCode?: number;
	/** Comma-separated scope from file paths (derived, not LLM) */
	derivedScope?: string;
	/** Commit hash (empty if not yet committed) */
	commitHash?: string;
}

// ---------------------------------------------------------------------------
// Commit Message Parts
// ---------------------------------------------------------------------------

/**
 * Parts of a commit message that can be assembled.
 */
export interface CommitMessageParts {
	/** Commit type (feat, fix, refactor, docs, test, chore) */
	type: string;
	/** Scope (package or area) */
	scope: string;
	/** Short description (first line) */
	description: string;
	/** Body paragraphs */
	body: string[];
	/** Trailers as key-value pairs */
	trailers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Fallback Types
// ---------------------------------------------------------------------------

/**
 * Structure for the deterministic fallback commit message.
 */
export interface FallbackCommitMessage {
	/** First line: type(scope): description */
	firstLine: string;
	/** Body paragraphs */
	body: string[];
	/** Trailers as key-value pairs */
	trailers: Record<string, string>;
	/** Formatted full message */
	fullMessage: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default commit type when derivation fails.
 */
export const DEFAULT_COMMIT_TYPE = "chore";

/**
 * Default scope when derivation fails.
 */
export const DEFAULT_COMMIT_SCOPE = "p44.5";

// ---------------------------------------------------------------------------
// Commit Message Renderer
// ---------------------------------------------------------------------------

/**
 * Derive a commit type from runtime facts.
 */
export function deriveCommitType(facts: RuntimeFactPacket): string {
	if (facts.allValidationPassed && facts.filesChanged.length > 0) {
		return "feat";
	}
	if (!facts.allValidationPassed) {
		return "fix";
	}
	return DEFAULT_COMMIT_TYPE;
}

/**
 * Derive a scope from file paths in the runtime fact packet.
 */
export function deriveScope(facts: RuntimeFactPacket): string {
	if (facts.derivedScope) return facts.derivedScope;

	// Try to extract scope from file paths
	const scopes = new Set<string>();
	for (const file of facts.filesChanged) {
		const parts = file.split("/");
		if (parts.length >= 2 && parts[0] === "packages") {
			scopes.add(parts[1]);
		}
	}

	if (scopes.size === 1) return [...scopes][0];
	if (scopes.size > 1) {
		// Use the most common scope or combine
		return [...scopes].slice(0, 3).join(",");
	}

	// Try top-level directory
	const dirs = new Set<string>();
	for (const file of facts.filesChanged) {
		const parts = file.split("/");
		if (parts.length >= 1 && parts[0]) {
			dirs.add(parts[0]);
		}
	}
	if (dirs.size === 1) return [...dirs][0];

	return DEFAULT_COMMIT_SCOPE;
}

/**
 * Generate a short description for the commit from runtime facts.
 */
export function generateShortDescription(facts: RuntimeFactPacket): string {
	const scope = deriveScope(facts);
	const type = deriveCommitType(facts);

	if (facts.filesChanged.length === 0) {
		return `${type}(${scope}): no changes`;
	}

	const fileSummary =
		facts.filesChanged.length <= 3 ? facts.filesChanged.join(", ") : `${facts.filesChanged.length} files`;

	return `${type}(${scope}): ${fileSummary}`;
}

/**
 * Build the deterministic fallback commit message from runtime facts.
 */
export function buildFallbackCommitMessage(
	facts: RuntimeFactPacket,
	trailers: Record<string, string>,
): FallbackCommitMessage {
	const firstLine = generateShortDescription(facts);
	const body: string[] = [];

	body.push(`Workspace: ${facts.workspaceId}`);
	body.push(`Plan: ${facts.planId}`);
	body.push("");

	if (facts.filesChanged.length > 0) {
		body.push("Files:");
		for (const file of facts.filesChanged) {
			body.push(`- ${file}`);
		}
		body.push("");
	}

	body.push(`Outcome: ${facts.allValidationPassed ? "validation passed" : "validation issues"}`);
	if (facts.primaryExitCode !== undefined) {
		body.push(`Exit code: ${facts.primaryExitCode}`);
	}

	if (facts.validationResults.length > 0) {
		body.push("");
		body.push("Validation:");
		for (const vr of facts.validationResults) {
			body.push(`- ${vr.command}: ${vr.passed ? "PASS" : "FAIL"}`);
		}
	}

	// Append trailers
	for (const [key, value] of Object.entries(trailers)) {
		body.push(`${key}: ${value}`);
	}

	return {
		firstLine,
		body,
		trailers,
		fullMessage: [firstLine, "", ...body].join("\n"),
	};
}

/**
 * Format a commit message from parts (for LLM-generated messages).
 */
export function formatCommitMessageFromParts(parts: CommitMessageParts): string {
	const lines: string[] = [`${parts.type}(${parts.scope}): ${parts.description}`, "", ...parts.body, ""];

	for (const [key, value] of Object.entries(parts.trailers)) {
		lines.push(`${key}: ${value}`);
	}

	return lines.join("\n");
}

/**
 * Extract scope from a standard `type(scope): desc` first line.
 */
export function extractScopeFromFirstLine(firstLine: string): string | undefined {
	const match = firstLine.match(/^[a-zA-Z]+\(([^)]+)\)/);
	return match?.[1];
}

/**
 * Extract type from a standard `type(scope): desc` first line.
 */
export function extractTypeFromFirstLine(firstLine: string): string | undefined {
	const match = firstLine.match(/^([a-zA-Z]+)\(/);
	return match?.[1];
}
