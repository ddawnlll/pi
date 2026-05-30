/**
 * Failure Signature Builder — P38.LEAD
 *
 * Extracts stable, deterministic failure signatures from error messages,
 * completion gate block reasons, and other failure evidence.
 *
 * The same failure should produce the same signature, enabling detection
 * of repeated failures across retries.
 */

import type { FailureClass, FailureSignature } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Extract a test file path from an error message containing a path pattern.
 * Matches patterns like "packages/coding-agent/test/execution/foo.test.ts"
 * or "test/execution/foo.test.ts".
 */
const TEST_FILE_PATTERN =
	/(?:packages\/[^/\s]+\/)?(?:test|tests|__tests__|spec)\/[^\s]*\.(?:test|spec)\.[A-Za-z0-9.+-]+/;

/**
 * Extract an FSM transition from an error message.
 * Matches patterns like "PENDING -> SUCCEEDED" or "PENDING->SUCCEEDED".
 */
const FSM_TRANSITION_PATTERN = /([A-Z_]+)\s*->\s*([A-Z_]+)/;

/**
 * Extract a memory limit signal from an error message.
 */
const MEMORY_LIMIT_PATTERN = /memory\s*limit|rss\s*limit|SIGKILL|OOM|heap\s*out/i;

/**
 * Extract a file lock signal from an error message.
 */
const FILE_LOCK_PATTERN = /file\s*lock/i;

/**
 * Extract a queue snapshot signal.
 */
const QUEUE_SNAPSHOT_PATTERN = /queue\s*snapshot/i;

/**
 * Target command not executed pattern.
 */
const TARGET_COMMAND_NOT_EXECUTED_PATTERN = /Target command has not been executed:\s*(.+)/;

/**
 * No tests found pattern.
 */
const NO_TESTS_FOUND_PATTERN = /No test files found/i;

/**
 * Command history empty signal.
 */
const COMMAND_HISTORY_EMPTY_PATTERN = /commandHistory.*empty|no command evidence/i;

// ---------------------------------------------------------------------------
// Signature building
// ---------------------------------------------------------------------------

/**
 * Build a normalized failure signature string from evidence.
 *
 * Signatures follow the format:
 *   <category>:<subtype>:<key>
 *
 * Examples:
 *   completion_gate:target_command_not_executed:packages/coding-agent/test/execution/foo.test.ts
 *   fsm:illegal_transition:PENDING->SUCCEEDED
 *   validation:no_tests_found_exit_zero:packages/coding-agent/test/execution/foo.test.ts
 *   process:memory_limit:heavy
 */
export function buildFailureSignatureString(input: {
	errorMessage: string;
	completionGateBlockReasons?: string[];
	lastCommand?: string | null;
}): string {
	const combined = combineEvidence(input);

	// 1. CompletionGate target command not executed
	const targetCmdMatch = combined.match(TARGET_COMMAND_NOT_EXECUTED_PATTERN);
	if (targetCmdMatch) {
		const testFile = extractTestFile(targetCmdMatch[1]);
		return `completion_gate:target_command_not_executed:${testFile}`;
	}

	// 2. No tests found exit 0
	if (NO_TESTS_FOUND_PATTERN.test(combined)) {
		const testFile = extractTestFile(combined);
		return `validation:no_tests_found_exit_zero:${testFile}`;
	}

	// 3. FSM illegal transition
	const fsmMatch = combined.match(/Illegal attempt transition:\s*(.+)/i);
	if (fsmMatch) {
		const transition = fsmMatch[1].trim().replace(/\s*->\s*/, "->");
		return `fsm:illegal_transition:${transition}`;
	}

	// 4. Attempt transition match (more general)
	if (FSM_TRANSITION_PATTERN.test(combined) && /illegal|invalid|rejected/.test(combined)) {
		const fm = combined.match(FSM_TRANSITION_PATTERN);
		const transition = `${fm![1]}->${fm![2]}`;
		return `fsm:illegal_transition:${transition}`;
	}

	// 5. Memory/process kills
	if (MEMORY_LIMIT_PATTERN.test(combined)) {
		const cmd = input.lastCommand ? simplifyCommand(input.lastCommand) : "unknown";
		return `process:memory_limit:${cmd}`;
	}

	// 6. File lock stuck
	if (FILE_LOCK_PATTERN.test(combined)) {
		return `file_lock:stuck:generic`;
	}

	// 7. Queue snapshot
	if (QUEUE_SNAPSHOT_PATTERN.test(combined)) {
		return `recovery:queue_snapshot_missing:generic`;
	}

	// 8. Command history missing
	if (COMMAND_HISTORY_EMPTY_PATTERN.test(combined)) {
		return `completion_gate:command_history_missing:generic`;
	}

	// 9. Generic completion gate blocked
	if (combined.includes("Completion gate blocked") || combined.includes("completion_gate_blocked")) {
		const testFile = extractTestFile(combined);
		return `completion_gate:blocked:${testFile}`;
	}

	// 10. Stale attempt
	if (/stale/i.test(combined) && /attempt.*complet/i.test(combined)) {
		return `fsm:stale_attempt_completion:generic`;
	}

	// 11. Validation failed
	if (/validation.*fail|test.*fail/i.test(combined)) {
		const testFile = extractTestFile(combined);
		return `validation:failed:${testFile}`;
	}

	// 12. Unknown — hash the combined message for stability
	const hash = simpleHash(combined);
	return `unknown:${hash}`;
}

/**
 * Extract a test file path from a string.
 */
function extractTestFile(text: string): string {
	const match = text.match(TEST_FILE_PATTERN);
	if (match) {
		// Normalize: ensure it starts with a known pattern
		const path = match[0].replace(/^\.\//, "");
		return path;
	}
	return "generic";
}

/**
 * Simplify a command for signature use.
 * Converts "npm test -- packages/foo/test/bar.test.ts" to "npm_test:packages/foo/test/bar.test.ts"
 */
function simplifyCommand(command: string): string {
	// Extract the main command type
	const parts = command.split(/\s+/);
	const cmdType = parts[0]?.replace(/[^a-zA-Z0-9]/g, "_") || "unknown";

	// Extract test file if present
	const testFile = extractTestFile(command);
	if (testFile !== "generic") {
		return `${cmdType}:${testFile}`;
	}

	return `${cmdType}:generic`;
}

/**
 * Combine error message and gate block reasons into one string for pattern matching.
 */
function combineEvidence(input: { errorMessage: string; completionGateBlockReasons?: string[] }): string {
	const parts = [input.errorMessage];
	if (input.completionGateBlockReasons && input.completionGateBlockReasons.length > 0) {
		parts.push(input.completionGateBlockReasons.join("; "));
	}
	return parts.join(" | ");
}

/**
 * Simple non-cryptographic hash for signature building.
 */
function simpleHash(text: string): string {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = ((hash << 5) - hash + char) | 0;
	}
	return Math.abs(hash).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Full FailureSignature creation
// ---------------------------------------------------------------------------

/**
 * Create a full FailureSignature object from an observed event or error context.
 */
export function createFailureSignature(
	params: {
		workspaceId: string;
		planExecId: string;
		errorMessage: string;
		attemptNo: number;
		completionGateBlockReasons?: string[];
		lastCommand?: string | null;
		lastCommandExitCode?: number | null;
		failureClass?: FailureClass;
		existingSignature?: FailureSignature;
	} & { now: number },
): FailureSignature {
	const signatureString = buildFailureSignatureString({
		errorMessage: params.errorMessage,
		completionGateBlockReasons: params.completionGateBlockReasons,
		lastCommand: params.lastCommand,
	});

	const existing = params.existingSignature;

	return {
		workspaceId: params.workspaceId,
		planExecId: params.planExecId,
		signature: signatureString,
		failureClass: params.failureClass ?? "unknown",
		errorMessage: params.errorMessage,
		lastCommand: params.lastCommand ?? null,
		lastCommandExitCode: params.lastCommandExitCode ?? null,
		completionGateBlockReasons: params.completionGateBlockReasons ?? [],
		attemptNo: params.attemptNo,
		firstObservedAt: existing?.firstObservedAt ?? params.now,
		lastObservedAt: params.now,
		occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
	};
}

/**
 * Check if two failure signatures are equivalent (same underlying failure).
 */
export function isSameFailure(a: FailureSignature, b: FailureSignature): boolean {
	return a.signature === b.signature && a.workspaceId === b.workspaceId;
}

/**
 * Format a FailureSignature for display.
 */
export function formatFailureSignature(sig: FailureSignature): string {
	return `${sig.signature} (×${sig.occurrenceCount}, attempt ${sig.attemptNo})`;
}
