/**
 * V5 Runtime Enablement — PlanLock Admission
 *
 * Takes a validated PlanSpec v5 object and produces a PlanLock/admission object.
 * This is the minimal admission path for planspec_locked execution.
 *
 * Contract:
 * - PlanSpec JSON -> schema validation (already done by parser)
 * - PlanSpec JSON -> semantic validation (already done by parser)
 * - validated PlanSpec -> PlanLock/admission object
 * - PlanLock/admission object -> execution metadata
 * - PlanLock/admission object -> worker packet derivation
 */

import { createHash } from "node:crypto";
import { computeWorkspaceLockHash } from "./planlock-hash.js";
import type { LockAdmissionResult, PlanLock } from "./planlock-types.js";
import type { PlanSpecV5 } from "./planspec-v5-types.js";

// =============================================================================
// Admission
// =============================================================================

/**
 * Admit a PlanSpec v5 and produce a PlanLock.
 *
 * This is the minimal admission path for planspec_locked execution.
 * It requires the PlanSpec to have already passed schema and semantic validation.
 *
 * @param planSpec - A validated PlanSpec v5 object
 * @param planSpecJson - The canonical JSON string of the plan spec (for hashing)
 * @returns Admission result with PlanLock if successful
 */
export function admitPlanSpec(
	planSpec: PlanSpecV5,
	planSpecJson: string,
): {
	result: LockAdmissionResult;
	planLock?: PlanLock;
} {
	// Build hash input from the validated PlanSpec
	const workspaceIds = planSpec.workspaces.map((ws) => ws.id);
	const workspaceAllowedFiles: Record<string, string[]> = {};
	const workspaceForbiddenFiles: Record<string, string[]> = {};
	const workspaceDependencies: Record<string, string[]> = {};
	const workspaceACs: Record<string, string[]> = {};
	const workspaceValidationRefs: Record<string, string[]> = {};
	const workspaceFinalValidationRefs: Record<string, string[]> = {};
	const workspaceCommandsByRef: Record<string, Record<string, string>> = {};

	for (const ws of planSpec.workspaces) {
		workspaceAllowedFiles[ws.id] = ws.allowedFiles ?? [];
		workspaceForbiddenFiles[ws.id] = ws.forbiddenFiles ?? [];
		workspaceDependencies[ws.id] = ws.dependencies ?? [];
		workspaceACs[ws.id] = ws.acceptanceCriteria.map((ac) => ac.id);
		workspaceValidationRefs[ws.id] = ws.validation?.commandRefs ?? [];
		workspaceFinalValidationRefs[ws.id] = ws.finalValidationCommandRefs ?? [];

		const cmdMap: Record<string, string> = {};
		for (const cmd of ws.commands ?? []) {
			cmdMap[cmd.ref] = cmd.exact;
		}
		workspaceCommandsByRef[ws.id] = cmdMap;
	}

	// Collect all instruction prompts
	const workspaceInstructions: Record<string, string> = {};
	for (const ws of planSpec.workspaces) {
		// Use the workspace title as instruction content for the hash
		workspaceInstructions[ws.id] = ws.title ?? "";
	}

	// Collect report paths
	const reportPaths: string[] = [];
	for (const ws of planSpec.workspaces) {
		for (const report of ws.reports ?? []) {
			reportPaths.push(report.path ?? "");
		}
	}

	// Build command policy JSON
	const commandPolicyJson = planSpec.authority?.commands ? JSON.stringify(planSpec.authority.commands) : undefined;

	// Build P45 bridge JSON
	const p45BridgeJson = planSpec.workspaces.some((ws) => ws.p45Bridge)
		? JSON.stringify(
				planSpec.workspaces
					.filter((ws) => ws.p45Bridge)
					.map((ws) => ({ workspaceId: ws.id, bridge: ws.p45Bridge })),
			)
		: undefined;

	// Bypass the full PlanLockHashInput interface by computing hashes directly
	const canonicalJsonHash = sha256Hex(planSpecJson);

	// Workspace graph hash
	const graphLines: string[] = [];
	for (const wsId of [...workspaceIds].sort()) {
		const deps = (workspaceDependencies[wsId] ?? []).sort();
		graphLines.push(`${wsId}:${deps.join(",")}`);
	}
	const workspaceGraphHash = sha256Hex(graphLines.join("\n"));

	// Allowed files hash
	const allAllowedFiles = new Set<string>();
	for (const files of Object.values(workspaceAllowedFiles)) {
		for (const f of files) allAllowedFiles.add(f);
	}
	const allowedFilesHash = hashSortedStrings([...allAllowedFiles]);

	// Validation policy hash
	const validationLines: string[] = [];
	for (const wsId of [...workspaceIds].sort()) {
		const refs = (workspaceValidationRefs[wsId] ?? []).sort();
		const finalRefs = (workspaceFinalValidationRefs[wsId] ?? []).sort();
		validationLines.push(`${wsId}:v:${refs.join(",")};f:${finalRefs.join(",")}`);
	}
	const validationPolicyHash = sha256Hex(validationLines.join("\n"));

	// Acceptance criteria hash
	const allACs = new Set<string>();
	for (const acs of Object.values(workspaceACs)) {
		for (const ac of acs) allACs.add(ac);
	}
	const acceptanceCriteriaHash = hashSortedStrings([...allACs]);

	// Instruction hash
	const instructionLines: string[] = [];
	for (const wsId of [...workspaceIds].sort()) {
		const instr = workspaceInstructions[wsId] ?? "";
		instructionLines.push(`${wsId}:${sha256Hex(instr)}`);
	}
	const instructionHash = sha256Hex(instructionLines.join("\n"));

	// Report contract hash
	const reportContractHash = hashSortedStrings(reportPaths);

	// P45 bridge hash
	const p45BridgeH = p45BridgeJson ? sha256Hex(p45BridgeJson) : sha256Hex("");

	// Command policy hash
	const commandPolicyH = commandPolicyJson ? sha256Hex(commandPolicyJson) : sha256Hex("");

	// Composite plan lock hash
	const planLockHashInput = sha256Hex(
		[
			canonicalJsonHash,
			workspaceGraphHash,
			allowedFilesHash,
			validationPolicyHash,
			acceptanceCriteriaHash,
			instructionHash,
			reportContractHash,
			p45BridgeH,
			commandPolicyH,
			planSpec.executionClass ?? "implementation",
			String(planSpec.authority?.executionState?.maxParallelWorkspaces ?? 3),
			String(false), // worktreeRequired
			String(true), // validationLockRequired
		].join("|"),
	);

	// Build workspace locks
	const workspaces: Record<
		string,
		{
			workspaceLockHash: string;
			allowedFiles: readonly string[];
			forbiddenFiles: readonly string[];
			dependencies: readonly string[];
			acIds: readonly string[];
			validationRefs: readonly string[];
			finalValidationRefs: readonly string[];
			commandScope: Record<string, string>;
			requiredReports: readonly string[];
		}
	> = {};

	for (const ws of planSpec.workspaces) {
		const wsHash = computeWorkspaceLockHash(
			ws.id,
			ws.allowedFiles ?? [],
			ws.forbiddenFiles ?? [],
			ws.dependencies ?? [],
			ws.acceptanceCriteria.map((ac) => ac.id),
			ws.validation?.commandRefs ?? [],
			ws.finalValidationCommandRefs ?? [],
		);

		workspaces[ws.id] = {
			workspaceLockHash: wsHash,
			allowedFiles: Object.freeze([...(ws.allowedFiles ?? [])]),
			forbiddenFiles: Object.freeze([...(ws.forbiddenFiles ?? [])]),
			dependencies: Object.freeze([...(ws.dependencies ?? [])]),
			acIds: Object.freeze(Object.keys(allACs)),
			validationRefs: Object.freeze([...(ws.validation?.commandRefs ?? [])]),
			finalValidationRefs: Object.freeze([...(ws.finalValidationCommandRefs ?? [])]),
			commandScope: Object.freeze({ ...(workspaceCommandsByRef[ws.id] ?? {}) }),
			requiredReports: Object.freeze(reportPaths),
		};
	}

	const now = new Date().toISOString();
	const planLock: PlanLock = {
		accpVersion: planSpec.accpVersion ?? "1.2",
		planLockVersion: "1.0.0",
		source: {
			planSpecTaskId: planSpec.taskId,
			specPath: planSpec.specSource ?? "",
			lockedAt: now,
			lockedBy: "planspec_v5_admission",
		},
		planLockHash: planLockHashInput,
		contract: {
			workspaceCount: workspaceIds.length,
			mode: planSpec.authority?.executionState?.mode ?? "stable_3",
			maxParallelWorkspaces: planSpec.authority?.executionState?.maxParallelWorkspaces ?? 3,
			worktreeRequired: false,
			validationLockRequired: true,
		},
		integrity: {
			canonicalJsonHash,
			workspaceGraphHash,
			allowedFilesHash,
			validationPolicyHash,
			acceptanceCriteriaHash,
			instructionHash,
			reportContractHash,
			p45BridgeHash: p45BridgeH,
			commandPolicyHash: commandPolicyH,
		},
		normalized: {
			workspaceIds: Object.freeze([...workspaceIds]),
			workspaces: workspaces as unknown as Record<string, import("./planlock-types.js").WorkspaceLock>,
			commandPolicyFrozen: !!commandPolicyJson,
			schemaFrozen: true,
		},
	};

	return {
		result: { admitted: true },
		planLock,
	};
}

// =============================================================================
// Helpers
// =============================================================================

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf-8").digest("hex");
}

function hashSortedStrings(items: string[]): string {
	const sorted = [...items].sort();
	return sha256Hex(sorted.join("\n"));
}
