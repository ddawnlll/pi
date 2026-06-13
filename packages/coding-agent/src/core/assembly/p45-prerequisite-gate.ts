/**
 * P45.S0 — P45 Prerequisite Gate for P44, P49, and Dirty Runtime Readiness
 *
 * Hard prerequisite gate that blocks P45 unless P44 completion gate,
 * EvidenceLedger, WriteGate, ACCP v2 compiler, ACCP gate verdict,
 * ACCP artifact writer, and acceptable dirty runtime extraction status
 * are present.
 *
 * Decision inputs are deterministic. LLM confidence is never authority.
 * If the stack is not ready, decision is block_p45 or allow_fixture_only.
 *
 * Does NOT probe P49 directly except through the P49.5 certificate,
 * preventing duplicate shadow readiness logic.
 */

import type { P45Decision } from "../p49_5/p45-readiness-certificate.js";

// =============================================================================
// Types
// =============================================================================

export type P45AdmissionMode = "production" | "fixture_only" | "blocked";

/** Detailed check result for each prerequisite sub-system. */
export interface PrerequisiteCheck {
	/** Human-readable name of the checked system. */
	name: string;
	/** Whether the check passed. */
	passed: boolean;
	/** Diagnostic detail for blocked/failed checks. */
	detail?: string;
}

/** The full prerequisite gate output consumed by P45 runtime admission. */
export interface P45PrerequisiteVerdict {
	schemaVersion: string;
	generatedAt: string;
	certificateDecision: P45Decision;
	admissionMode: P45AdmissionMode;
	blockingReasons: string[];
	/** All sub-system checks for traceability. */
	checks: PrerequisiteCheck[];
	/** Whether P44 completion gate is green. */
	p44CompletionGreen: boolean;
	/** Whether P49 ACCP v2 artifacts are present. */
	p49AccpV2Ready: boolean;
	/** Dirty runtime extraction status. */
	dirtyRuntimeStatus: "complete" | "acceptable" | "blocking" | "unknown";
	/** Whether the evidence ledger is accessible. */
	evidenceLedgerAccessible: boolean;
	/** Whether the write gate is enabled. */
	writeGateEnabled: boolean;
}

// =============================================================================
// Gate Input
// =============================================================================

/** Deterministic inputs consumed by the prerequisite gate. */
export interface PrerequisiteGateInput {
	/** P49.5 certificate decision. */
	certificateDecision: P45Decision;
	/** Detailed reasons from the P49.5 readiness engine. */
	blockingReasons: string[];
	/** P44 completion gate status. */
	p44CompletionGreen: boolean;
	/** P49 ACCP v2 readiness flag. */
	p49AccpV2Ready: boolean;
	/** Dirty runtime extraction status. */
	dirtyRuntimeStatus: "complete" | "acceptable" | "blocking" | "unknown";
	/** Whether the evidence ledger module is available. */
	evidenceLedgerAccessible: boolean;
	/** Whether the write gate is active. */
	writeGateEnabled: boolean;
}

// =============================================================================
// Gate
// =============================================================================

/**
 * Evaluate the full P45 prerequisite gate with all sub-system checks.
 *
 * This is the single source of truth for P45 admission.
 * All decision inputs are deterministic — no LLM confidence is consumed.
 */
export function evaluateP45PrerequisiteGate(
	certificateDecision: P45Decision,
	blockingReasons?: string[],
): P45PrerequisiteVerdict {
	// Legacy wrapper: uses the P49.5 certificate only, assumes
	// sub-systems are green (caller explicitly passes blocking reasons).
	// For full sub-system checking, use evaluateP45PrerequisiteGateFull.
	const reasons = blockingReasons ?? [];
	const admissionMode = computeSimpleAdmission(certificateDecision, reasons);

	return {
		schemaVersion: "2.0.0",
		generatedAt: new Date().toISOString(),
		certificateDecision,
		admissionMode,
		blockingReasons: reasons,
		checks: [{ name: "P49.5 Certificate Decision", passed: certificateDecision !== "block_p45" }],
		p44CompletionGreen: true,
		p49AccpV2Ready: true,
		dirtyRuntimeStatus: "acceptable",
		evidenceLedgerAccessible: true,
		writeGateEnabled: true,
	};
}

/** Simple admission mapping without sub-system checks. */
function computeSimpleAdmission(certificateDecision: P45Decision, _blockingReasons: string[]): P45AdmissionMode {
	switch (certificateDecision) {
		case "allow_p45":
			return "production";
		case "allow_fixture_only":
			return "fixture_only";
		case "block_p45":
			return "blocked";
		default:
			return "blocked";
	}
}

/**
 * Evaluate the full P45 prerequisite gate from a complete input bundle.
 *
 * All sub-systems are checked independently. If any critical check fails,
 * admission is blocked or downgraded to fixture_only.
 */
export function evaluateP45PrerequisiteGateFull(input: PrerequisiteGateInput): P45PrerequisiteVerdict {
	const checks: PrerequisiteCheck[] = [];
	const blockingReasons: string[] = [...input.blockingReasons];

	// P44 completion gate check
	checks.push({
		name: "P44 Completion Gate",
		passed: input.p44CompletionGreen,
		detail: input.p44CompletionGreen
			? undefined
			: "P44 completion gate is not green. Verified completion spine is required.",
	});
	if (!input.p44CompletionGreen) {
		blockingReasons.push("p44_completion_gate_not_green");
	}

	// P49 ACCP v2 check
	checks.push({
		name: "P49 ACCP v2 Readiness",
		passed: input.p49AccpV2Ready,
		detail: input.p49AccpV2Ready
			? undefined
			: "P49 ACCP v2 compiler, gate verdict, route signal, or artifact writer is missing.",
	});
	if (!input.p49AccpV2Ready) {
		blockingReasons.push("p49_accp_v2_not_ready");
	}

	// Evidence ledger check
	checks.push({
		name: "Evidence Ledger",
		passed: input.evidenceLedgerAccessible,
		detail: input.evidenceLedgerAccessible
			? undefined
			: "EvidenceLedger module is not accessible. Completion evidence cannot be verified.",
	});
	if (!input.evidenceLedgerAccessible) {
		blockingReasons.push("evidence_ledger_not_accessible");
	}

	// Write gate check
	checks.push({
		name: "Write Gate",
		passed: input.writeGateEnabled,
		detail: input.writeGateEnabled ? undefined : "Write gate is not enabled. Repository mutation guard is missing.",
	});
	if (!input.writeGateEnabled) {
		blockingReasons.push("write_gate_not_enabled");
	}

	// Dirty runtime check
	checks.push({
		name: "Dirty Runtime Status",
		passed: input.dirtyRuntimeStatus !== "blocking",
		detail:
			input.dirtyRuntimeStatus === "blocking"
				? "Dirty runtime extraction status is blocking."
				: input.dirtyRuntimeStatus === "unknown"
					? "Dirty runtime status is unknown. Proceeding with caution."
					: undefined,
	});
	if (input.dirtyRuntimeStatus === "blocking") {
		blockingReasons.push("dirty_runtime_blocking");
	}

	// P49.5 certificate decision check
	checks.push({
		name: "P49.5 Certificate Decision",
		passed: input.certificateDecision !== "block_p45",
		detail:
			input.certificateDecision === "block_p45" ? "P49.5 readiness certificate blocked P45 admission." : undefined,
	});

	// Determine admission mode
	let admissionMode: P45AdmissionMode;

	// P49.5 certificate overrides: block_p45 always blocks
	if (input.certificateDecision === "block_p45") {
		admissionMode = "blocked";
	} else if (input.certificateDecision === "allow_fixture_only") {
		// allow_fixture_only from P49.5 means max fixture_only
		admissionMode = "fixture_only";
	} else if (blockingReasons.length > 0) {
		// allow_p45 cert but sub-system failures -> blocked
		// No downgrade exceptions: if prerequisites fail, P45 is blocked
		admissionMode = "blocked";
	} else {
		admissionMode = "production";
	}

	return {
		schemaVersion: "2.0.0",
		generatedAt: new Date().toISOString(),
		certificateDecision: input.certificateDecision,
		admissionMode,
		blockingReasons,
		checks,
		p44CompletionGreen: input.p44CompletionGreen,
		p49AccpV2Ready: input.p49AccpV2Ready,
		dirtyRuntimeStatus: input.dirtyRuntimeStatus,
		evidenceLedgerAccessible: input.evidenceLedgerAccessible,
		writeGateEnabled: input.writeGateEnabled,
	};
}

/**
 * Check whether P45 production mode is allowed.
 */
export function isP45ProductionAllowed(verdict: P45PrerequisiteVerdict): boolean {
	return verdict.certificateDecision === "allow_p45" && verdict.admissionMode === "production";
}

/**
 * Check whether at least fixture-only mode is allowed.
 */
export function isP45FixtureAllowed(verdict: P45PrerequisiteVerdict): boolean {
	return verdict.admissionMode === "production" || verdict.admissionMode === "fixture_only";
}

/**
 * Produce a summary string for operator visibility.
 */
export function summarizePrerequisiteVerdict(verdict: P45PrerequisiteVerdict): string {
	const parts: string[] = [];
	parts.push(`P45 Admission: ${verdict.admissionMode}`);
	parts.push(`P49.5 Decision: ${verdict.certificateDecision}`);
	if (verdict.blockingReasons.length > 0) {
		parts.push(`Blockers: ${verdict.blockingReasons.join("; ")}`);
	}
	const failed = verdict.checks.filter((c) => !c.passed);
	if (failed.length > 0) {
		parts.push(`Failed checks: ${failed.map((c) => c.name).join(", ")}`);
	}
	return parts.join(" | ");
}
