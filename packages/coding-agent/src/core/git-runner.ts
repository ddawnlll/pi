/**
 * Compatibility shim — P40.2
 * @deprecated Import from @earendil-works/pi-execution-service
 */
export type { GitCallContext, GitOperationScope, GitResult, StaleLockInfo } from "@earendil-works/pi-execution-service";
export { createGitRunner, GitRunner } from "@earendil-works/pi-execution-service";

// ---------------------------------------------------------------------------
// Destructive Operation Guard Integration (P44.5.10)
// ---------------------------------------------------------------------------

import {
	DestructiveOperationGuard,
	type DestructiveOperationGuardResult,
} from "./completion/destructive-operation-guard.js";
export { DestructiveOperationGuard };
export type { DestructiveOperationGuardResult };

/**
 * Wrap a destructive git operation with the preservation guard.
 * Captures state before destructive operations and blocks if uncommitted.
 *
 * @param guard - The destructive operation guard instance
 * @param operation - The git operation being attempted (e.g., "git reset --hard")
 * @returns Guard check result
 */
export function guardDestructiveGitOperation(
	guard: DestructiveOperationGuard,
	operation: string,
): DestructiveOperationGuardResult {
	return guard.checkOperation(operation);
}
