/**
 * P44.6.30 — Evidence Ledger Export for Mode Decisions
 *
 * Immutable snapshot of mode mapping, gate verdicts, patch evidence,
 * and validation results for the evidence ledger.
 *
 * Contract Schema: 4.1.1
 */

export interface EvidenceSnapshot {
	/** Timestamp of the snapshot (epoch ms). */
	timestamp: number;
	/** The compiled mode at snapshot time. */
	mode: string | null;
	/** Gate verdict at snapshot time. */
	gateVerdict: "pass" | "fail" | "warning" | null;
	/** Route signal at snapshot time. */
	routeSignal: string | null;
	/** Validation results included in the snapshot. */
	validationResults: string[];
	/** Export version for schema migration. */
	version: string;
}

export function createEvidenceSnapshot(
	mode: string | null,
	gateVerdict: "pass" | "fail" | "warning" | null,
	routeSignal: string | null,
	validationResults: string[],
): EvidenceSnapshot {
	return {
		timestamp: Date.now(),
		mode,
		gateVerdict,
		routeSignal,
		validationResults,
		version: "1.0.0",
	};
}
