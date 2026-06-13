/**
 * P49.5.01 — P49 Readiness Input Contract
 *
 * Defines the input contract consumed by the P45 readiness decision engine.
 * This is a typed, validated contract that P49.5 workspaces must satisfy
 * before P45 can be allowed.
 */

import type { P49ArtifactInventory } from "./p49-completion-inventory.js";

// =============================================================================
// Types
// =============================================================================

export interface P49ReadinessInput {
	schemaVersion: string;
	inventory: P49ArtifactInventory;
	probeResults: P49CapabilityProbeResults;
	generatedAt: string;
}

export interface P49CapabilityProbeResults {
	compilerAvailable: boolean;
	gateVerdictAvailable: boolean;
	routeSignalAvailable: boolean;
	artifactWriterAvailable: boolean;
	reportValidatorAvailable: boolean;
	evidenceLedgerAvailable: boolean;
	completionGateV2Available: boolean;
	runtimeReadsCompiledJsonOnly: boolean;
}

/**
 * Validate that a P49ReadinessInput has all required fields.
 * Returns an array of error messages (empty = valid).
 */
export function validateReadinessInput(input: P49ReadinessInput): string[] {
	const errors: string[] = [];

	if (!input.schemaVersion) {
		errors.push("Missing schemaVersion");
	}
	if (!input.inventory) {
		errors.push("Missing inventory");
	}
	if (!input.probeResults) {
		errors.push("Missing probeResults");
	}

	if (input.probeResults) {
		if (typeof input.probeResults.compilerAvailable !== "boolean") {
			errors.push("probeResults.compilerAvailable must be a boolean");
		}
		if (typeof input.probeResults.gateVerdictAvailable !== "boolean") {
			errors.push("probeResults.gateVerdictAvailable must be a boolean");
		}
		if (typeof input.probeResults.routeSignalAvailable !== "boolean") {
			errors.push("probeResults.routeSignalAvailable must be a boolean");
		}
		if (typeof input.probeResults.artifactWriterAvailable !== "boolean") {
			errors.push("probeResults.artifactWriterAvailable must be a boolean");
		}
		if (typeof input.probeResults.runtimeReadsCompiledJsonOnly !== "boolean") {
			errors.push("probeResults.runtimeReadsCompiledJsonOnly must be a boolean");
		}
	}

	return errors;
}

/**
 * Determine whether P49 is fully ready based on the readiness input.
 * Follows fail-closed semantics: missing or ambiguous -> false.
 */
export function isP49FullyReady(input: P49ReadinessInput): boolean {
	if (validateReadinessInput(input).length > 0) {
		return false;
	}

	const p = input.probeResults;
	return (
		p.compilerAvailable &&
		p.gateVerdictAvailable &&
		p.routeSignalAvailable &&
		p.artifactWriterAvailable &&
		p.reportValidatorAvailable &&
		p.evidenceLedgerAvailable &&
		p.completionGateV2Available &&
		p.runtimeReadsCompiledJsonOnly
	);
}
