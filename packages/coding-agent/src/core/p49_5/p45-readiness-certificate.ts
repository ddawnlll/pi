/**
 * P49.5.03 — P45 Readiness Certificate Schema and Decision Engine
 *
 * Defines the P45 readiness certificate schema and decision engine.
 * Only valid decisions: allow_p45, allow_fixture_only, block_p45.
 *
 * allow_p45 requires P49 readiness, ACCP compiler capability, gate verdict
 * capability, route signal capability, artifact writer capability,
 * runtime compiled-JSON-only policy, and no blocking dirty runtime status.
 *
 * Missing or stale evidence must NOT produce allow_p45.
 */

import type { AccpCapabilityProbeResult } from "./accp-capability-probe.js";
import type { P49ArtifactInventory } from "./p49-completion-inventory.js";

// =============================================================================
// Types
// =============================================================================

export type P45Decision = "allow_p45" | "allow_fixture_only" | "block_p45";

export interface P45ReadinessCertificate {
	schemaVersion: string;
	generatedAt: string;
	decision: P45Decision;
	evidenceHashes: {
		inventoryHash: string;
		probeHash: string;
	};
	checks: P45ReadinessChecks;
	blockingReasons: string[];
	dirtyRuntimeStatus: "complete" | "acceptable" | "blocking" | "unknown";
}

export interface P45ReadinessChecks {
	p49Green: boolean;
	accpCompilerAvailable: boolean;
	accpGateVerdictAvailable: boolean;
	accpRouteSignalAvailable: boolean;
	accpArtifactWriterAvailable: boolean;
	accpRuntimeReadsCompiledJsonOnly: boolean;
	largePlanGuardedAllowed: boolean;
}

// =============================================================================
// Hashing
// =============================================================================

import { createHash } from "node:crypto";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input, "utf-8").digest("hex");
}

// =============================================================================
// Decision Engine
// =============================================================================

export interface DecisionEngineInput {
	inventory: P49ArtifactInventory;
	probe: AccpCapabilityProbeResult;
	dirtyRuntimeStatus: "complete" | "acceptable" | "blocking" | "unknown";
	largePlanGuardedAllowed: boolean;
}

/**
 * Evaluate P45 readiness and produce a certificate.
 *
 * Decision rules (fail-closed):
 * - p49Green=false                     -> block_p45
 * - accpCompilerAvailable=false        -> block_p45
 * - accpGateVerdictAvailable=false     -> block_p45
 * - accpRouteSignalAvailable=false     -> block_p45
 * - accpArtifactWriterAvailable=false  -> block_p45
 * - runtimeReadsCompiledJsonOnly=false -> block_p45
 * - dirtyRuntimeStatus=blocking        -> block_p45
 * - dirtyRuntimeStatus=unknown         -> allow_fixture_only
 * - all green + dirty ok               -> allow_p45
 */
export function evaluateP45Readiness(input: DecisionEngineInput): P45ReadinessCertificate {
	const p = input.probe;
	const blockingReasons: string[] = [];

	// Compute evidence hashes
	const inventoryHash = sha256Hex(JSON.stringify(input.inventory));
	const probeHash = sha256Hex(JSON.stringify(input.probe));

	// Compute checks
	const checks: P45ReadinessChecks = {
		p49Green: input.inventory.summary.missing === 0,
		accpCompilerAvailable: p.compilerAvailable === true,
		accpGateVerdictAvailable: p.gateVerdictAvailable === true,
		accpRouteSignalAvailable: p.routeSignalAvailable === true,
		accpArtifactWriterAvailable: p.artifactWriterAvailable === true,
		accpRuntimeReadsCompiledJsonOnly: p.runtimeReadsCompiledJsonOnly === true,
		largePlanGuardedAllowed: input.largePlanGuardedAllowed,
	};

	// Rule: missing P49 artifacts -> block
	if (!checks.p49Green) {
		blockingReasons.push(
			`P49 is not green: ${input.inventory.summary.missing} artifact(s) missing out of ${input.inventory.summary.total}`,
		);
	}

	// Rule: missing ACCP capabilities -> block
	if (!checks.accpCompilerAvailable) blockingReasons.push("ACCP compiler is not available");
	if (!checks.accpGateVerdictAvailable) blockingReasons.push("ACCP gate verdict is not available");
	if (!checks.accpRouteSignalAvailable) blockingReasons.push("ACCP route signal is not available");
	if (!checks.accpArtifactWriterAvailable) blockingReasons.push("ACCP artifact writer is not available");
	if (!checks.accpRuntimeReadsCompiledJsonOnly) {
		blockingReasons.push("Runtime does not read compiled JSON only");
	}

	// Rule: dirty runtime status
	if (input.dirtyRuntimeStatus === "blocking") {
		blockingReasons.push("Dirty runtime status is blocking");
	}

	// Decide
	let decision: P45Decision;
	if (blockingReasons.length > 0) {
		if (
			input.dirtyRuntimeStatus === "unknown" &&
			!blockingReasons.some((r) => r !== "Dirty runtime status is blocking")
		) {
			// Only dirtyRuntimeStatus=unknown, no other blockers -> fixture only
			decision = "allow_fixture_only";
		} else {
			decision = "block_p45";
		}
	} else if (input.dirtyRuntimeStatus === "unknown") {
		decision = "allow_fixture_only";
	} else {
		decision = "allow_p45";
	}

	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		decision,
		evidenceHashes: {
			inventoryHash,
			probeHash,
		},
		checks,
		blockingReasons,
		dirtyRuntimeStatus: input.dirtyRuntimeStatus,
	};
}
