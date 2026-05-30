/**
 * PatchArtifactStore - P4.5 Workstream
 *
 * Persists and retrieves PatchArtifact instances on the filesystem.
 * All artifacts are stored under .pi/patches/ relative to the workspace root.
 *
 * Acceptance Criteria (P37.02):
 * 2. Store writes and reads artifact without data loss.
 * 3. Artifact paths are scoped to .pi/patches/.
 *
 * Key guarantees:
 * - Write validates before persisting (rejects invalid artifacts)
 * - Read returns the exact artifact that was written (no data loss)
 * - Paths are always scoped to <workspaceRoot>/.pi/patches/
 * - List returns all stored artifact IDs
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PatchArtifact } from "./patch-artifact.js";
import { validatePatchArtifact } from "./patch-validation-plan.js";

/**
 * PatchArtifactStoreConfig
 */
export interface PatchArtifactStoreConfig {
	/** Workspace root directory; .pi/patches/ is resolved relative to this */
	workspaceRoot: string;
}

/**
 * File system-backed store for PatchArtifact instances.
 *
 * Artifacts are serialized as JSON files inside .pi/patches/.
 * Each artifact is stored as <artifactId>.json.
 */
export class PatchArtifactStore {
	private readonly patchesDir: string;

	/**
	 * @param workspaceRoot - Root directory of the workspace.
	 *                        Artifacts are stored under <workspaceRoot>/.pi/patches/.
	 */
	constructor(workspaceRoot: string) {
		this.patchesDir = path.resolve(workspaceRoot, ".pi", "patches");
	}

	/**
	 * Get the resolved patches directory path.
	 */
	get patchesDirectory(): string {
		return this.patchesDir;
	}

	/**
	 * Write a patch artifact to disk.
	 *
	 * Validates the artifact before writing. Throws if validation fails.
	 * Creates the .pi/patches/ directory if it does not exist.
	 *
	 * @param artifact - The artifact to persist
	 * @throws Error if the artifact fails validation
	 */
	async write(artifact: PatchArtifact): Promise<void> {
		const validation = validatePatchArtifact(artifact);
		if (!validation.valid) {
			const messages = validation.errors.map((e) => e.message).join("; ");
			throw new Error(`Cannot write invalid PatchArtifact: ${messages}`);
		}

		await fs.mkdir(this.patchesDir, { recursive: true });

		const filePath = path.join(this.patchesDir, `${artifact.id}.json`);
		await fs.writeFile(filePath, JSON.stringify(artifact, null, 2), "utf-8");
	}

	/**
	 * Read a patch artifact from disk by ID.
	 *
	 * @param id - Artifact ID (without .json extension)
	 * @returns The artifact, or null if not found
	 */
	async read(id: string): Promise<PatchArtifact | null> {
		const filePath = path.join(this.patchesDir, `${id}.json`);
		try {
			const content = await fs.readFile(filePath, "utf-8");
			return JSON.parse(content) as PatchArtifact;
		} catch {
			return null;
		}
	}

	/**
	 * Delete a patch artifact from disk.
	 *
	 * @param id - Artifact ID (without .json extension)
	 * @returns true if deleted, false if not found
	 */
	async delete(id: string): Promise<boolean> {
		const filePath = path.join(this.patchesDir, `${id}.json`);
		try {
			await fs.unlink(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List all stored patch artifact IDs.
	 *
	 * @returns Array of artifact IDs (without .json extension)
	 */
	async list(): Promise<string[]> {
		try {
			const entries = await fs.readdir(this.patchesDir, { withFileTypes: true });
			return entries
				.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
				.map((entry) => entry.name.slice(0, -5)); // remove .json suffix
		} catch {
			return [];
		}
	}

	/**
	 * Check if an artifact exists in the store.
	 *
	 * @param id - Artifact ID
	 * @returns true if the artifact exists on disk
	 */
	async exists(id: string): Promise<boolean> {
		const filePath = path.join(this.patchesDir, `${id}.json`);
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
}
