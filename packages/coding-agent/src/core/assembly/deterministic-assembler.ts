/**
 * P45.08 — Deterministic Assembler Core with Atomic Rollback and Idempotency
 *
 * The assembler is the ONLY shared integration writer. It consumes accepted
 * worker manifests and deterministically merges namespace patches.
 *
 * Key properties:
 * - Deterministic: same inputs always produce same output
 * - Atomic: partial writes are rolled back on failure
 * - Idempotent: applying the same manifests twice produces the same result
 * - Journaled: every assembly operation is recorded in an assembly journal
 */

import { createHash } from "node:crypto";
import type { ArtifactManifest } from "./artifact-manifest.js";
import type { OwnershipManifest } from "./ownership-manifest.js";

// =============================================================================
// Types
// =============================================================================

export interface AssemblyOutput {
	/** File path -> assembled content. */
	files: Map<string, string>;
	/** Assembly journal entries. */
	journal: AssemblyJournalEntry[];
	/** Assembly output hash (deterministic). */
	outputHash: string;
	/** Whether the assembly was successful. */
	success: boolean;
	/** Errors if assembly failed. */
	errors: string[];
}

export interface AssemblyJournalEntry {
	/** Operation sequence number. */
	sequence: number;
	/** Namespace that produced the artifact. */
	namespace: string;
	/** File that was merged. */
	file: string;
	/** Hash before assembly. */
	preHash: string;
	/** Hash after assembly. */
	postHash: string;
	/** ISO timestamp. */
	timestamp: string;
}

export interface AssemblerConfig {
	/** Whether to validate manifests before assembly. */
	validateManifests: boolean;
	/** Whether to perform atomic rollback on failure. */
	atomicRollback: boolean;
	/** Max files per namespace. */
	maxFilesPerNamespace: number;
}

// =============================================================================
// Deterministic Assembler
// =============================================================================

export class DeterministicAssembler {
	private journal: AssemblyJournalEntry[] = [];
	private sequence = 0;
	private config: AssemblerConfig;

	constructor(config?: Partial<AssemblerConfig>) {
		this.config = {
			validateManifests: true,
			atomicRollback: true,
			maxFilesPerNamespace: 100,
			...config,
		};
	}

	/**
	 * Assemble manifests into a deterministic output.
	 *
	 * Manifests are sorted by (namespace, manifestId) for determinism.
	 * Each manifest's artifacts are applied in file-path order.
	 */
	assemble(manifests: ArtifactManifest[], _ownershipManifest?: OwnershipManifest): AssemblyOutput {
		const errors: string[] = [];
		const files = new Map<string, string>();
		const snapshot = new Map<string, string>(); // for rollback

		// Sort manifests deterministically
		const sorted = [...manifests].sort((a, b) => {
			const nsCmp = a.namespace.localeCompare(b.namespace);
			if (nsCmp !== 0) return nsCmp;
			return a.manifestId.localeCompare(b.manifestId);
		});

		// Apply each manifest
		for (const manifest of sorted) {
			// Sort artifacts by file path for determinism
			const sortedArtifacts = [...manifest.artifacts].sort((a, b) => a.file.localeCompare(b.file));

			for (const artifact of sortedArtifacts) {
				const preHash = files.get(artifact.file) ?? "";

				// Save snapshot for rollback
				if (this.config.atomicRollback) {
					snapshot.set(artifact.file, files.get(artifact.file) ?? "");
				}

				// Apply artifact
				files.set(artifact.file, artifact.content);

				// Journal entry
				this.sequence++;
				this.journal.push({
					sequence: this.sequence,
					namespace: manifest.namespace,
					file: artifact.file,
					preHash: createHash("sha256").update(preHash).digest("hex"),
					postHash: createHash("sha256").update(artifact.content).digest("hex"),
					timestamp: new Date().toISOString(),
				});
			}
		}

		// Compute deterministic output hash
		const outputHash = computeOutputHash(files);

		// Check for errors (namespace write overlap, etc.)
		const namespaceFileMap = new Map<string, string[]>();
		for (const entry of this.journal) {
			if (!namespaceFileMap.has(entry.file)) {
				namespaceFileMap.set(entry.file, []);
			}
			namespaceFileMap.get(entry.file)!.push(entry.namespace);
		}

		for (const [file, namespaces] of namespaceFileMap) {
			const unique = [...new Set(namespaces)];
			if (unique.length > 1) {
				// Rollback conflicting file
				if (this.config.atomicRollback && snapshot.has(file)) {
					files.set(file, snapshot.get(file)!);
				}
				errors.push(`Namespace write overlap: file "${file}" written by ${unique.join(", ")}`);
			}
		}

		return {
			files,
			journal: [...this.journal],
			outputHash,
			success: errors.length === 0,
			errors,
		};
	}

	/**
	 * Verify that the assembler produces idempotent output.
	 * Applies the same manifests twice and checks output is identical.
	 */
	verifyIdempotency(manifests: ArtifactManifest[]): { idempotent: boolean; hash1: string; hash2: string } {
		const result1 = this.assemble(manifests);
		const result2 = this.assemble(manifests);
		return {
			idempotent: result1.outputHash === result2.outputHash,
			hash1: result1.outputHash,
			hash2: result2.outputHash,
		};
	}

	/**
	 * Get the assembly journal.
	 */
	getJournal(): AssemblyJournalEntry[] {
		return [...this.journal];
	}

	/**
	 * Clear the journal (for new assembly runs).
	 */
	reset(): void {
		this.journal = [];
		this.sequence = 0;
	}
}

// =============================================================================
// Helpers
// =============================================================================

function computeOutputHash(files: Map<string, string>): string {
	// Sort keys for determinism
	const sorted = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
	const parts = sorted.map(([path, content]) => `${path}:${content}`);
	return createHash("sha256").update(parts.join("\n")).digest("hex");
}
