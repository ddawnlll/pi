/**
 * P45.03 — Ownership Manifest
 *
 * Records which files belong to which namespace, which are shared, and which
 * are assembler-only. Consumed by the namespace enforcer.
 */

import type { NamespaceAssignment } from "./predictive-spec-input.js";

// =============================================================================
// Types
// =============================================================================

export interface OwnershipEntry {
	file: string;
	namespace: string;
	role: "worker" | "shared_integration" | "assembler_only";
}

export interface OwnershipManifest {
	schemaVersion: string;
	generatedAt: string;
	entries: OwnershipEntry[];
}

// =============================================================================
// Manifest Builder
// =============================================================================

export function buildOwnershipManifest(
	namespaces: NamespaceAssignment[],
	sharedIntegrationFiles: string[],
	assemblerOnlyFiles: string[],
): OwnershipManifest {
	const entries: OwnershipEntry[] = [];
	const seen = new Set<string>();

	for (const ns of namespaces) {
		for (const file of ns.files) {
			if (sharedIntegrationFiles.includes(file)) {
				entries.push({ file, namespace: ns.namespace, role: "shared_integration" });
			} else if (assemblerOnlyFiles.includes(file)) {
				entries.push({ file, namespace: ns.namespace, role: "assembler_only" });
			} else {
				entries.push({ file, namespace: ns.namespace, role: "worker" });
			}
			seen.add(file);
		}
	}

	// Add shared and assembler files not already assigned
	for (const file of sharedIntegrationFiles) {
		if (!seen.has(file)) {
			entries.push({ file, namespace: "shared", role: "shared_integration" });
		}
	}
	for (const file of assemblerOnlyFiles) {
		if (!seen.has(file)) {
			entries.push({ file, namespace: "assembler", role: "assembler_only" });
		}
	}

	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		entries,
	};
}

/**
 * Check if a file can be edited by a specific namespace worker.
 */
export function canEditFile(
	manifest: OwnershipManifest,
	file: string,
	namespace: string,
): { allowed: boolean; reason?: string } {
	const entry = manifest.entries.find((e) => e.file === file);
	if (!entry) {
		return { allowed: false, reason: `File "${file}" not found in ownership manifest` };
	}
	if (entry.role === "assembler_only") {
		return { allowed: false, reason: `File "${file}" is assembler-only` };
	}
	if (entry.role === "shared_integration") {
		return { allowed: false, reason: `File "${file}" is shared integration — assembler only` };
	}
	if (entry.namespace !== namespace) {
		return { allowed: false, reason: `File "${file}" belongs to namespace "${entry.namespace}", not "${namespace}"` };
	}
	return { allowed: true };
}
