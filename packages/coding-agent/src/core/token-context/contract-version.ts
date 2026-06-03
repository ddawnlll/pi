/**
 * P43 Token Context Runtime - Contract Version & Compatibility Guard (P43.00)
 *
 * Frozen interface version string and compatibility guard.
 * Any change to core contracts must bump the version and pass golden tests.
 */

/** P43 contract version - bump when core interfaces change */
export const P43_CONTRACT_VERSION = "1.0.0";

/** Compatible contract versions (accepts exact match and same-minor) */
const COMPATIBLE_VERSIONS = new Set(["1.0.0"]);

/**
 * Verify that a given contract version is compatible.
 * Throws if incompatible, returns true if compatible.
 */
export function checkContractCompatibility(version: string): boolean {
	if (COMPATIBLE_VERSIONS.has(version)) return true;
	throw new Error(
		`P43 contract version mismatch: expected one of [${[...COMPATIBLE_VERSIONS].join(", ")}], got ${version}`,
	);
}

/**
 * Golden test records for contract verification.
 * These are expected output shapes for key types.
 */
export const CONTRACT_GOLDEN = {
	smartReadResult: {
		content: "",
		mode: "raw" as const,
		mutationSafe: true,
		adapterConfidence: 1.0,
		adapterName: "test",
		isFallback: false,
	},
	tokenSavingEvent: {
		id: "",
		timestamp: 0,
		mechanism: "smart_read" as const,
		tool: "read",
		estimatedBaselineTokens: 0,
		estimatedOptimizedTokens: 0,
		estimatedSavingTokens: 0,
		confidence: "estimated" as const,
	},
	acrLedgerPolicy: {
		returnUnchanged: false,
		returnCompactSummary: false,
		returnDelta: false,
		forceExactSymbolRead: false,
		forceRawRead: true,
		blockMutation: false,
		markDirty: false,
		hardFail: false,
	},
} as const;
