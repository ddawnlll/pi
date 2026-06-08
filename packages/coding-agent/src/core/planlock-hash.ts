/**
 * PlanLock Hash Utilities — ACCP 1.2 / PlanSpec v5
 *
 * Deterministic SHA-256 hashing for PlanLock integrity verification.
 * All hashes are hex-encoded SHA-256 strings.
 */

import { createHash } from "node:crypto";

// =============================================================================
// Core Hash Function
// =============================================================================

/**
 * Compute a SHA-256 hex hash of a string.
 */
export function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf-8").digest("hex");
}

/**
 * Compute a SHA-256 hex hash of a JSON-serializable value.
 * Serializes with sorted keys for deterministic output.
 */
export function hashJson(value: unknown): string {
	const json = JSON.stringify(value, Object.keys(value as object).sort());
	return sha256Hex(json);
}

/**
 * Compute a hash from a sorted, deduped array of strings.
 */
export function hashSortedStrings(items: string[]): string {
	const sorted = [...new Set(items)].sort();
	return sha256Hex(sorted.join("\n"));
}

// =============================================================================
// PlanLock Hash Computation
// =============================================================================

/**
 * Options for computing a plan lock hash.
 */
export interface PlanLockHashInput {
	canonicalPlanSpecJson: string;
	workspaceIds: string[];
	workspaceAllowedFiles: Record<string, string[]>;
	workspaceForbiddenFiles: Record<string, string[]>;
	workspaceDependencies: Record<string, string[]>;
	workspaceACs: Record<string, string[]>;
	workspaceValidationRefs: Record<string, string[]>;
	workspaceFinalValidationRefs: Record<string, string[]>;
	workspaceInstructions: Record<string, string>;
	reportPaths: string[];
	p45BridgeJson?: string;
	commandPolicyJson?: string;
	mode: string;
	maxParallelWorkspaces: number;
	worktreeRequired: boolean;
	validationLockRequired: boolean;
}

/**
 * Compute all integrity hashes for a PlanLock.
 */
export function computeLockHashes(input: PlanLockHashInput): {
	canonicalJsonHash: string;
	workspaceGraphHash: string;
	allowedFilesHash: string;
	validationPolicyHash: string;
	acceptanceCriteriaHash: string;
	instructionHash: string;
	reportContractHash: string;
	p45BridgeHash: string;
	commandPolicyHash: string;
	planLockHashInput: string;
} {
	// Canonical JSON hash
	const canonicalJsonHash = sha256Hex(input.canonicalPlanSpecJson);

	// Workspace graph hash: sorted workspace IDs + their deps
	const graphLines: string[] = [];
	for (const wsId of [...input.workspaceIds].sort()) {
		const deps = (input.workspaceDependencies[wsId] ?? []).sort();
		graphLines.push(`${wsId}:${deps.join(",")}`);
	}
	const workspaceGraphHash = sha256Hex(graphLines.join("\n"));

	// Allowed files hash: all allowed files sorted and deduped
	const allAllowedFiles = new Set<string>();
	for (const files of Object.values(input.workspaceAllowedFiles)) {
		for (const f of files) allAllowedFiles.add(f);
	}
	const allowedFilesHash = hashSortedStrings([...allAllowedFiles]);

	// Validation policy hash: sorted validation refs per workspace
	const validationLines: string[] = [];
	for (const wsId of [...input.workspaceIds].sort()) {
		const refs = (input.workspaceValidationRefs[wsId] ?? []).sort();
		const finalRefs = (input.workspaceFinalValidationRefs[wsId] ?? []).sort();
		validationLines.push(`${wsId}:v:${refs.join(",")};f:${finalRefs.join(",")}`);
	}
	const validationPolicyHash = sha256Hex(validationLines.join("\n"));

	// Acceptance criteria hash: sorted AC IDs
	const allACs = new Set<string>();
	for (const acs of Object.values(input.workspaceACs)) {
		for (const ac of acs) allACs.add(ac);
	}
	const acceptanceCriteriaHash = hashSortedStrings([...allACs]);

	// Instruction hash: sorted workspace prompts
	const instructionLines: string[] = [];
	for (const wsId of [...input.workspaceIds].sort()) {
		const instr = input.workspaceInstructions[wsId] ?? "";
		instructionLines.push(`${wsId}:${sha256Hex(instr)}`);
	}
	const instructionHash = sha256Hex(instructionLines.join("\n"));

	// Report contract hash
	const reportContractHash = hashSortedStrings(input.reportPaths);

	// P45 bridge hash
	const p45BridgeHash = input.p45BridgeJson ? sha256Hex(input.p45BridgeJson) : sha256Hex("");

	// Command policy hash
	const commandPolicyHash = input.commandPolicyJson ? sha256Hex(input.commandPolicyJson) : sha256Hex("");

	return {
		canonicalJsonHash,
		workspaceGraphHash,
		allowedFilesHash,
		validationPolicyHash,
		acceptanceCriteriaHash,
		instructionHash,
		reportContractHash,
		p45BridgeHash,
		commandPolicyHash,
		planLockHashInput: sha256Hex(
			[
				canonicalJsonHash,
				workspaceGraphHash,
				allowedFilesHash,
				validationPolicyHash,
				acceptanceCriteriaHash,
				instructionHash,
				reportContractHash,
				p45BridgeHash,
				commandPolicyHash,
				input.mode,
				String(input.maxParallelWorkspaces),
				String(input.worktreeRequired),
				String(input.validationLockRequired),
			].join("|"),
		),
	};
}

/**
 * Compute a workspace lock hash for a single workspace.
 */
export function computeWorkspaceLockHash(
	workspaceId: string,
	allowedFiles: string[],
	forbiddenFiles: string[],
	dependencies: string[],
	acIds: string[],
	validationRefs: string[],
	finalValidationRefs: string[],
): string {
	const parts = [
		`id:${workspaceId}`,
		`af:${hashSortedStrings(allowedFiles)}`,
		`ff:${hashSortedStrings(forbiddenFiles)}`,
		`dep:${hashSortedStrings(dependencies)}`,
		`ac:${hashSortedStrings(acIds)}`,
		`vr:${hashSortedStrings(validationRefs)}`,
		`fvr:${hashSortedStrings(finalValidationRefs)}`,
	];
	return sha256Hex(parts.join("|"));
}
