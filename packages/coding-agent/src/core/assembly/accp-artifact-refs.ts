/**
 * P45.05 — ACCP Artifact References
 *
 * Manages ACCP artifact references within manifests.
 * Provides lookup, validation, and cross-reference functions.
 */

import type { AccpArtifactRef } from "./artifact-manifest.js";

// =============================================================================
// Types
// =============================================================================

export interface AccpRefIndex {
	/** All ACCP refs indexed by reportId. */
	byId: Map<string, AccpArtifactRef>;
	/** ACCP refs indexed by report type. */
	byType: Map<string, AccpArtifactRef[]>;
	/** Count of compiled vs uncompiled refs. */
	compiledCount: number;
	uncompiledCount: number;
}

// =============================================================================
// Index Builder
// =============================================================================

export function buildAccpRefIndex(refs: AccpArtifactRef[]): AccpRefIndex {
	const byId = new Map<string, AccpArtifactRef>();
	const byType = new Map<string, AccpArtifactRef[]>();
	let compiledCount = 0;
	let uncompiledCount = 0;

	for (const ref of refs) {
		byId.set(ref.reportId, ref);

		if (!byType.has(ref.reportType)) {
			byType.set(ref.reportType, []);
		}
		byType.get(ref.reportType)!.push(ref);

		if (ref.compiled) compiledCount++;
		else uncompiledCount++;
	}

	return { byId, byType, compiledCount, uncompiledCount };
}

/**
 * Validate that all required ACCP report types are present and compiled.
 */
export function validateAccpRefCoverage(
	refs: AccpArtifactRef[],
	requiredTypes: AccpArtifactRef["reportType"][] = ["IPR", "TVR"],
): { covered: boolean; missing: AccpArtifactRef["reportType"][]; uncompiled: string[] } {
	const presentTypes = new Set(refs.map((r) => r.reportType));
	const missing = requiredTypes.filter((t) => !presentTypes.has(t));
	const uncompiled = refs.filter((r) => !r.compiled).map((r) => r.reportId);

	return {
		covered: missing.length === 0,
		missing,
		uncompiled,
	};
}
