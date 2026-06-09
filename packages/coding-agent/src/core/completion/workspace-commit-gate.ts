/**
 * P44.08 — WorkspaceCommitGate (Completion Subsystem)
 *
 * Re-exports the core WorkspaceCommitGate and its types for the completion
 * subsystem. Provides completion-specific type aliases and integration
 * helpers for commit gate validation during workspace completion evaluation.
 *
 * The WorkspaceCommitGate enforces that workers can only stage and commit
 * files belonging to their workspace-owned write-set. It blocks dangerous
 * git commands like `git add .`, `git add -A`, and `git commit -a`.
 *
 * See `packages/coding-agent/src/core/workspace-commit-gate.ts` for the
 * full implementation.
 *
 * Related:
 * - WorkspaceWriteSet (P44.08) for write set tracking
 * - CompletionGate (P44.03) for gate evaluation
 */

export type {
	WorkspaceCommitGateConfig,
	WorkspaceCommitGateResult,
} from "../../core/workspace-commit-gate.js";
export { WorkspaceCommitGate } from "../../core/workspace-commit-gate.js";

// ---------------------------------------------------------------------------
// Completion-Specific Types
// ---------------------------------------------------------------------------

/**
 * Result of a commit gate check within the completion evaluation context.
 * Extends the base WorkspaceCommitGateResult with completion-specific fields.
 */
export interface CompletionCommitGateResult {
	/** Whether the commit gate check passed */
	passed: boolean;
	/** Human-readable block reasons (empty if passed) */
	blockReasons: string[];
	/** Raw commit gate result from the underlying gate */
	rawResult?: import("../../core/workspace-commit-gate.js").WorkspaceCommitGateResult;
}

/**
 * Create a CompletionCommitGateResult from a WorkspaceCommitGateResult.
 *
 * @param result - The raw WorkspaceCommitGate result
 * @returns CompletionCommitGateResult with formatted block reasons
 */
export function toCompletionCommitGateResult(
	result: import("../../core/workspace-commit-gate.js").WorkspaceCommitGateResult,
): CompletionCommitGateResult {
	if (result.allowed) {
		return {
			passed: true,
			blockReasons: [],
			rawResult: result,
		};
	}

	const reasons: string[] = [];

	if (result.reason) {
		reasons.push(result.reason);
	}

	if (result.unexpectedStagedFiles.length > 0) {
		reasons.push(`Unexpected staged files: ${result.unexpectedStagedFiles.join(", ")}`);
	}

	if (result.blockedCommands && result.blockedCommands.length > 0) {
		reasons.push(`Blocked commands: ${result.blockedCommands.join(", ")}`);
	}

	return {
		passed: false,
		blockReasons: reasons.length > 0 ? reasons : ["WorkspaceCommitGate check failed"],
		rawResult: result,
	};
}
