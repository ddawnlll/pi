/**
 * Emit Plan Lock
 *
 * Creates a deterministic PlanLock from a CompiledPlan using SHA-256 hashes.
 * Same input always produces the same plan lock hash.
 */

import { type BinaryLike, createHash } from "node:crypto";
import type { LockIntegrityHashes, PlanLock, WorkspaceLock } from "../../planlock-types.js";
import type { CompiledPlan } from "./compiled-plan-types.js";

// =============================================================================
// Main entry
// =============================================================================

/**
 * Emit a deterministic PlanLock from a CompiledPlan.
 */
export function emitPlanLock(plan: CompiledPlan): PlanLock {
	// Use a fixed timestamp for deterministic output.
	// The canonicalJsonHash covers the content; timestamp is metadata only.
	const now = "2026-06-09T00:00:00.000Z";

	// Compute integrity hashes
	const canonicalJson = JSON.stringify(plan, sortedReplacer, 2);
	const canonicalJsonHash = sha256(canonicalJson);

	const workspaceGraphStr = JSON.stringify(plan.workspaceGraph, sortedReplacer, 2);
	const workspaceGraphHash = sha256(workspaceGraphStr);

	const allAllowedFiles = plan.workspaces.flatMap((w) => [...w.canEdit, ...w.canRead]).sort();
	const allowedFilesHash = sha256(JSON.stringify([...new Set(allAllowedFiles)]));

	const validationPolicies = plan.tasks.flatMap((t) => [
		...(t.validation?.preCheck ?? []),
		...(t.validation?.postCheck ?? []),
	]);
	const validationPolicyHash = sha256(JSON.stringify([...new Set(validationPolicies)].sort()));

	const acceptanceCriteria = plan.tasks.flatMap((t) => t.acceptanceCriteria);
	const acceptanceCriteriaHash = sha256(JSON.stringify([...new Set(acceptanceCriteria)].sort()));

	const instructionHash = sha256(JSON.stringify(plan.tasks.map((t) => ({ id: t.id, title: t.title }))));

	const reportContractHash = sha256("none");

	const p45BridgeHash = sha256("empty");

	const commandPolicyStr = JSON.stringify(plan.commandPolicy, sortedReplacer, 2);
	const commandPolicyHash = sha256(commandPolicyStr);

	const integrity: LockIntegrityHashes = {
		canonicalJsonHash,
		workspaceGraphHash,
		allowedFilesHash,
		validationPolicyHash,
		acceptanceCriteriaHash,
		instructionHash,
		reportContractHash,
		p45BridgeHash,
		commandPolicyHash,
	};

	// Workspace locks
	const workspaces: Record<string, WorkspaceLock> = {};
	for (const ws of plan.workspaces) {
		const wsData = {
			workspaceId: ws.id,
			allowedFiles: [...ws.canEdit, ...ws.canRead],
			forbiddenFiles: plan.filePolicy.protectedPaths,
			dependencies: [],
			acceptanceCriteria: plan.tasks.filter((t) => t.workspaceId === ws.id).flatMap((t) => t.acceptanceCriteria),
			validationRefs: plan.tasks
				.filter((t) => t.workspaceId === ws.id)
				.flatMap((t) => [...(t.validation?.preCheck ?? []), ...(t.validation?.postCheck ?? [])]),
			finalValidationRefs: plan.completion.requiresFinalVerdict
				? plan.tasks
						.filter((t) => t.workspaceId === ws.id)
						.flatMap((t) => [...(t.validation?.preCheck ?? []), ...(t.validation?.postCheck ?? [])])
				: [],
		};

		const workspaceLockHash = sha256(JSON.stringify(wsData, sortedReplacer, 2));

		workspaces[ws.id] = {
			workspaceId: ws.id,
			workspaceLockHash,
			allowedFiles: wsData.allowedFiles,
			forbiddenFiles: wsData.forbiddenFiles,
			dependencies: wsData.dependencies,
			acceptanceCriteria: wsData.acceptanceCriteria,
			validationRefs: wsData.validationRefs,
			finalValidationRefs: wsData.finalValidationRefs,
		};
	}

	// Build plan lock object (without planLockHash first, then compute it)
	const preHash: Omit<PlanLock, "planLockHash"> = {
		accpVersion: "1.2",
		planLockVersion: "5.0.0-alpha2",
		source: {
			planSpecTaskId: plan.phaseId,
			specPath: "plan-compiler://canonical",
			lockedAt: now,
			lockedBy: "plan-compiler",
		},
		contract: {
			workspaceCount: plan.workspaces.length,
			mode: plan.execution.mode,
			maxParallelWorkspaces: plan.execution.maxParallelWorkspaces,
			worktreeRequired: plan.execution.worktreeIsolation,
			validationLockRequired: plan.execution.validationLock,
		},
		integrity,
		normalized: {
			workspaceIds: plan.workspaces.map((w) => w.id),
			workspaces,
			commandPolicyFrozen: true,
			schemaFrozen: true,
		},
	};

	const planLockHash = sha256(JSON.stringify(preHash, sortedReplacer, 2));

	return {
		...preHash,
		planLockHash,
	};
}

// =============================================================================
// Helpers
// =============================================================================

function sha256(data: BinaryLike): string {
	return createHash("sha256").update(data).digest("hex");
}

/**
 * JSON replacer that sorts object keys for deterministic serialization.
 */
function sortedReplacer(_key: string, value: unknown): unknown {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const sorted: Record<string, unknown> = {};
		const keys = Object.keys(value as Record<string, unknown>).sort();
		for (const k of keys) {
			sorted[k] = (value as Record<string, unknown>)[k];
		}
		return sorted;
	}
	return value;
}
