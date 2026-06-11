/**
 * P45.07 — Artifact Acceptance Gate
 *
 * Requires P44 completion gate acceptance + ACCP compile pass + manifest validity
 * before any worker artifact is accepted for assembly.
 *
 * The gate performs three checks:
 * 1. P44 Completion Gate: artifact must have P44 acceptance evidence
 * 2. ACCP Compile: artifact manifest must have compiled ACCP refs with gate verdict "passed"
 * 3. Manifest Validity: artifact manifest must pass structural validation
 */

import type { ArtifactManifest } from "./artifact-manifest.js";
import { validateArtifactManifest } from "./artifact-manifest.js";

// =============================================================================
// Types
// =============================================================================

export type AcceptanceDecision = "accepted" | "rejected" | "held";

export interface AcceptanceResult {
	/** Final decision. */
	decision: AcceptanceDecision;
	/** Whether the artifact is accepted. */
	accepted: boolean;
	/** Blocking reasons if rejected or held. */
	reasons: string[];
	/** Gate checks that were performed. */
	checks: AcceptanceCheck[];
}

export interface AcceptanceCheck {
	name: string;
	passed: boolean;
	detail: string;
}

// =============================================================================
// Gate
// =============================================================================

/**
 * Evaluate artifact acceptance with all three gate checks.
 */
export function evaluateArtifactAcceptance(manifest: ArtifactManifest): AcceptanceResult {
	const checks: AcceptanceCheck[] = [];
	const reasons: string[] = [];

	// Check 1: P44 Completion Gate
	const p44Passed = manifest.p44CompletionVerdict === "passed";
	checks.push({
		name: "P44 Completion Gate",
		passed: p44Passed,
		detail: p44Passed
			? "P44 completion gate passed"
			: `P44 completion gate verdict: ${manifest.p44CompletionVerdict}`,
	});
	if (!p44Passed) {
		reasons.push(`P44 completion gate not passed (verdict: ${manifest.p44CompletionVerdict})`);
	}

	// Check 2: ACCP Compile
	const accpCompiled = manifest.accpCompiled;
	let accpGateBlocked = false;
	if (accpCompiled) {
		// Check individual ACCP ref gate verdicts
		for (const ref of manifest.accpRefs) {
			if (ref.gateVerdict === "blocked") {
				accpGateBlocked = true;
				break;
			}
		}
	}

	checks.push({
		name: "ACCP Compile + Gate Verdict",
		passed: accpCompiled && !accpGateBlocked,
		detail: !accpCompiled
			? "Manifest has not been ACCP-compiled"
			: accpGateBlocked
				? "ACCP gate verdict is blocked for one or more refs"
				: "ACCP compiled and gate verdict passed",
	});

	if (!accpCompiled) {
		reasons.push("Artifact has not been compiled by ACCP v2");
	}
	if (accpGateBlocked) {
		reasons.push("ACCP gate verdict blocked — artifact cannot be accepted");
	}

	// Check 3: Manifest Validity
	const manifestResult = validateArtifactManifest(manifest);
	checks.push({
		name: "Manifest Validity",
		passed: manifestResult.valid,
		detail: manifestResult.valid
			? "Manifest structure is valid"
			: `Manifest errors: ${manifestResult.errors.join("; ")}`,
	});

	if (!manifestResult.valid) {
		reasons.push(...manifestResult.errors);
	}

	// Determine decision
	let decision: AcceptanceDecision;
	if (reasons.length === 0) {
		decision = "accepted";
	} else if (!p44Passed || accpGateBlocked) {
		decision = "rejected";
	} else {
		decision = "held"; // Held pending: missing ACCP compile or minor manifest issues
	}

	return {
		decision,
		accepted: decision === "accepted",
		reasons,
		checks,
	};
}

/**
 * Batch-accept multiple manifests. Returns accepted manifests and rejection reasons.
 */
export function batchAcceptManifests(
	manifests: ArtifactManifest[],
): { accepted: ArtifactManifest[]; rejected: { manifest: ArtifactManifest; reasons: string[] }[] } {
	const accepted: ArtifactManifest[] = [];
	const rejected: { manifest: ArtifactManifest; reasons: string[] }[] = [];

	for (const manifest of manifests) {
		const result = evaluateArtifactAcceptance(manifest);
		if (result.accepted) {
			accepted.push(manifest);
		} else {
			rejected.push({ manifest, reasons: result.reasons });
		}
	}

	return { accepted, rejected };
}
