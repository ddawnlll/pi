/**
 * P45.02 — Contract Freeze
 *
 * Freezes the predictive spec, preventing further mutation without amendment.
 * Produces a frozen contract bundle that the assembler and workers consume.
 */

import type { PredictiveSpec } from "./predictive-spec-input.js";

// =============================================================================
// Types
// =============================================================================

export interface FrozenContract {
	/** Whether the spec has been frozen. */
	frozen: boolean;
	/** ISO timestamp of freeze. */
	frozenAt: string;
	/** Hash of the frozen spec. */
	specHash: string;
	/** The frozen spec (immutable after freeze). */
	spec: PredictiveSpec;
	/** Version of the freeze contract. */
	version: string;
}

export interface FreezeResult {
	success: boolean;
	contract?: FrozenContract;
	error?: string;
}

// =============================================================================
// Freezer
// =============================================================================

/**
 * Freeze a predictive spec into an immutable contract.
 * Once frozen, the spec can only be modified via the ContractAmendmentProtocol.
 */
export function freezeSpec(spec: PredictiveSpec): FrozenContract {
	const specHash = computeSpecHash(spec);

	return {
		frozen: true,
		frozenAt: new Date().toISOString(),
		specHash,
		spec: deepClone(spec),
		version: "1.0.0",
	};
}

/**
 * Verify that a frozen contract matches the expected spec hash.
 */
export function verifyFrozenContract(contract: FrozenContract): FreezeResult {
	const currentHash = computeSpecHash(contract.spec);
	if (currentHash !== contract.specHash) {
		return {
			success: false,
			error: `Spec hash mismatch: expected ${contract.specHash}, got ${currentHash}`,
		};
	}
	return { success: true, contract };
}

/**
 * Check if a contract is still valid (frozen and hash matches).
 */
export function isContractValid(contract: FrozenContract): boolean {
	if (!contract.frozen) return false;
	return computeSpecHash(contract.spec) === contract.specHash;
}

// =============================================================================
// Helpers
// =============================================================================

function computeSpecHash(spec: PredictiveSpec): string {
	// Hash only the deterministic parts, skip generatedAt
	const { generatedAt: _, ...rest } = spec;
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function deepClone<T>(obj: T): T {
	return JSON.parse(JSON.stringify(obj));
}
