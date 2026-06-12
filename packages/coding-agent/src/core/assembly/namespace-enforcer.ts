/**
 * P45.06 — Namespace Worker Enforcement and Patch Artifact Adapter
 *
 * Enforces that namespace workers only edit their allowed files.
 * Checks ownership manifest on every mutation attempt.
 * Adapts worker patches for the deterministic assembler.
 */

import type { ArtifactManifest, ManifestValidationResult, WorkerArtifact } from "./artifact-manifest.js";
import type { OwnershipManifest } from "./ownership-manifest.js";
import { canEditFile } from "./ownership-manifest.js";

// =============================================================================
// Types
// =============================================================================

export interface EnforcementResult {
	/** Whether the mutation is allowed. */
	allowed: boolean;
	/** Reason if not allowed. */
	reason?: string;
	/** The file that was checked. */
	file: string;
	/** The namespace attempting the edit. */
	namespace: string;
}

export interface PatchArtifact {
	/** File path being patched. */
	file: string;
	/** Original content hash (pre-mutation). */
	originalHash: string;
	/** New content hash (post-mutation). */
	newHash: string;
	/** Unified diff or full content. */
	patch: string;
	/** Whether this is a diff or full replacement. */
	kind: "diff" | "full";
}

export interface NamespaceEnforcer {
	/** The manifest defining ownership. */
	manifest: OwnershipManifest;
	/** Check whether a namespace can edit a file. */
	canEdit: (file: string, namespace: string) => EnforcementResult;
}

// =============================================================================
// Enforcer
// =============================================================================

export function createNamespaceEnforcer(manifest: OwnershipManifest): NamespaceEnforcer {
	return {
		manifest,
		canEdit: (file: string, namespace: string): EnforcementResult => {
			const result = canEditFile(manifest, file, namespace);
			return {
				allowed: result.allowed,
				reason: result.reason,
				file,
				namespace,
			};
		},
	};
}

/**
 * Enforce that all artifacts in a manifest belong to the declared namespace.
 */
export function enforceManifestNamespace(
	manifest: ArtifactManifest,
	enforcer: NamespaceEnforcer,
): { valid: boolean; violations: EnforcementResult[] } {
	const violations: EnforcementResult[] = [];

	for (const artifact of manifest.artifacts) {
		const result = enforcer.canEdit(artifact.file, manifest.namespace);
		if (!result.allowed) {
			violations.push(result);
		}
	}

	return { valid: violations.length === 0, violations };
}

// =============================================================================
// Patch Artifact Adapter
// =============================================================================

/**
 * Adapt worker artifacts into patch format for the deterministic assembler.
 */
export function adaptToPatchArtifacts(artifacts: WorkerArtifact[]): PatchArtifact[] {
	return artifacts.map((a) => ({
		file: a.file,
		originalHash: a.contentHash,
		newHash: a.contentHash, // Same until assembled
		patch: a.content,
		kind: a.kind === "patch" ? "diff" : "full",
	}));
}

/**
 * Validate that a namespace worker's manifest does not contain forbidden mutations:
 * - No edits to assembler-only files
 * - No edits to shared integration files
 * - No edits to files outside the worker's namespace
 */
export function validateWorkerManifest(
	manifest: ArtifactManifest,
	ownershipManifest: OwnershipManifest,
): ManifestValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// Check each artifact against ownership
	for (const artifact of manifest.artifacts) {
		const entry = ownershipManifest.entries.find((e) => e.file === artifact.file);

		if (!entry) {
			errors.push(`File "${artifact.file}" not found in ownership manifest — worker may not create new files`);
			continue;
		}

		if (entry.role === "assembler_only") {
			errors.push(`File "${artifact.file}" is assembler-only — worker "${manifest.namespace}" cannot edit it`);
		}

		if (entry.role === "shared_integration") {
			errors.push(`File "${artifact.file}" is shared integration — only the assembler can write it`);
		}

		if (entry.namespace !== manifest.namespace && entry.role === "worker") {
			errors.push(`File "${artifact.file}" belongs to namespace "${entry.namespace}", not "${manifest.namespace}"`);
		}
	}

	// Check that no shared or assembler files are in the manifest
	const sharedOrAssembler = ownershipManifest.entries.filter(
		(e) => e.role === "shared_integration" || e.role === "assembler_only",
	);

	for (const saEntry of sharedOrAssembler) {
		const hasShared = manifest.artifacts.some((a) => a.file === saEntry.file);
		if (hasShared) {
			// Already caught above, skip
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}
