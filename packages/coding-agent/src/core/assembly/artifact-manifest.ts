/**
 * P45.05 — ACCP-Aware Async Assembly Artifact Manifest Protocol
 *
 * Defines the artifact manifest that every namespace worker must produce.
 * Extended with ACCP compiled artifact refs: IPR/FPR, ECR, TVR, gate verdict,
 * route signal, diagnostics, and evidence ledger refs.
 *
 * The manifest is the bridge between worker output and the deterministic assembler.
 * Workers produce manifests; the assembler validates, verifies, and integrates.
 */

import { createHash } from "node:crypto";

// =============================================================================
// Types
// =============================================================================

export type ArtifactStatus = "proposed" | "accepted" | "rejected" | "stale";

export interface AccpArtifactRef {
	/** ACCP report ID (e.g., ipr_ns_worker_1). */
	reportId: string;
	/** ACCP report type. */
	reportType: "IPR" | "FPR" | "ECR" | "TVR" | "RAR" | "HIR" | "CAR" | "DCR" | "PRR";
	/** Path to the compiled JSON artifact (if compiled). */
	compiledPath: string;
	/** SHA-256 hash of the compiled artifact. */
	compiledHash: string;
	/** Gate verdict (passed/blocked/hold). */
	gateVerdict: "passed" | "blocked" | "hold" | "unknown";
	/** Whether the artifact has been compiled by ACCP v2. */
	compiled: boolean;
}

export interface WorkerArtifact {
	/** File path owned by this namespace. */
	file: string;
	/** SHA-256 of the file content after mutation. */
	contentHash: string;
	/** Whether the artifact is a patch (diff) or full file. */
	kind: "patch" | "full";
	/** The actual content/patch. */
	content: string;
	/** ISO timestamp of last modification. */
	modifiedAt: string;
}

export interface EvidenceLedgerRef {
	/** Evidence entry ID. */
	entryId: string;
	/** Type of evidence. */
	kind: "command_evidence" | "test_result" | "typecheck_result" | "accp_compile" | "gate_verdict";
	/** Path to evidence artifact. */
	path: string;
	/** SHA-256 of evidence. */
	hash: string;
}

export interface ArtifactManifest {
	/** Schema version. */
	schemaVersion: string;
	/** Unique manifest ID (namespace-scoped). */
	manifestId: string;
	/** Namespace that produced this manifest. */
	namespace: string;
	/** Workspace ID within the PlanSpec. */
	workspaceId: string;
	/** ISO timestamp of manifest generation. */
	generatedAt: string;
	/** Worker artifacts (files mutated). */
	artifacts: WorkerArtifact[];
	/** ACCP report references. */
	accpRefs: AccpArtifactRef[];
	/** Evidence ledger references. */
	evidenceRefs: EvidenceLedgerRef[];
	/** P44 completion gate verdict. */
	p44CompletionVerdict: "passed" | "failed" | "unknown";
	/** Whether the artifact has been compiled by ACCP. */
	accpCompiled: boolean;
	/** Hash of the complete manifest (for integrity). */
	manifestHash?: string;
}

export interface ManifestValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

// =============================================================================
// Manifest Builder
// =============================================================================

export function buildArtifactManifest(params: {
	namespace: string;
	workspaceId: string;
	artifacts: WorkerArtifact[];
	accpRefs?: AccpArtifactRef[];
	evidenceRefs?: EvidenceLedgerRef[];
	p44CompletionVerdict?: ArtifactManifest["p44CompletionVerdict"];
	accpCompiled?: boolean;
}): ArtifactManifest {
	const manifest: ArtifactManifest = {
		schemaVersion: "1.0.0",
		manifestId: `${params.namespace}-${params.workspaceId}-${Date.now()}`,
		namespace: params.namespace,
		workspaceId: params.workspaceId,
		generatedAt: new Date().toISOString(),
		artifacts: params.artifacts,
		accpRefs: params.accpRefs ?? [],
		evidenceRefs: params.evidenceRefs ?? [],
		p44CompletionVerdict: params.p44CompletionVerdict ?? "unknown",
		accpCompiled: params.accpCompiled ?? false,
	};

	manifest.manifestHash = createHash("sha256")
		.update(JSON.stringify({ ...manifest, manifestHash: undefined }))
		.digest("hex");

	return manifest;
}

// =============================================================================
// Manifest Validator
// =============================================================================

/**
 * Validate an artifact manifest against all hard requirements.
 * Fail-closed: any missing required field or invalid ref blocks acceptance.
 */
export function validateArtifactManifest(manifest: ArtifactManifest): ManifestValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Required fields
	if (!manifest.manifestId) errors.push("Missing manifestId");
	if (!manifest.namespace) errors.push("Missing namespace");
	if (!manifest.workspaceId) errors.push("Missing workspaceId");
	if (manifest.artifacts.length === 0) errors.push("Manifest has no artifacts");

	// Artifact validation
	for (const artifact of manifest.artifacts) {
		if (!artifact.file) errors.push(`Artifact missing file path`);
		if (!artifact.contentHash) errors.push(`Artifact "${artifact.file}" missing contentHash`);
		if (!artifact.content && artifact.kind === "full") {
			errors.push(`Artifact "${artifact.file}" has empty content`);
		}
	}

	// ACCP refs validation
	for (const ref of manifest.accpRefs) {
		if (!ref.compiled) {
			warnings.push(`ACCP ref "${ref.reportId}" is not compiled`);
		}
		if (!ref.compiledHash) {
			errors.push(`ACCP ref "${ref.reportId}" missing compiledHash`);
		}
		if (ref.gateVerdict === "unknown") {
			warnings.push(`ACCP ref "${ref.reportId}" has unknown gate verdict`);
		}
	}

	// Evidence refs validation
	for (const ref of manifest.evidenceRefs) {
		if (!ref.hash) {
			errors.push(`Evidence ref "${ref.entryId}" missing hash`);
		}
	}

	// P44 completion gate check
	if (manifest.p44CompletionVerdict === "failed") {
		errors.push("P44 completion gate failed — artifact cannot be accepted");
	}
	if (manifest.p44CompletionVerdict === "unknown") {
		warnings.push("P44 completion gate verdict is unknown");
	}

	// ACCP compiled check
	if (!manifest.accpCompiled) {
		warnings.push("Manifest has not been ACCP-compiled");
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if a manifest has all required ACCP refs for acceptance.
 */
export function hasRequiredAccpRefs(manifest: ArtifactManifest): boolean {
	const requiredTypes: AccpArtifactRef["reportType"][] = ["IPR", "TVR"];
	const presentTypes = new Set(manifest.accpRefs.map((r) => r.reportType));
	return requiredTypes.every((t) => presentTypes.has(t));
}

/**
 * Compute a manifest's content hash for integrity verification.
 */
export function computeManifestHash(manifest: Omit<ArtifactManifest, "manifestHash">): string {
	return createHash("sha256")
		.update(JSON.stringify(manifest))
		.digest("hex");
}

/**
 * Verify that a manifest's hash matches its embedded hash.
 */
export function verifyManifestIntegrity(manifest: ArtifactManifest): boolean {
	const { manifestHash, ...rest } = manifest;
	const computed = computeManifestHash(rest);
	return computed === manifestHash;
}
