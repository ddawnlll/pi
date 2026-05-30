/**
 * PatchArtifact Schema - P4.5 Workstream
 *
 * A PatchArtifact represents a concrete, validated set of file-level changes
 * scoped to a workspace execution. It captures the git base SHA, the
 * declared write set (files to be modified), and the individual file
 * operations (diffs / targeted edits / creates / deletes).
 *
 * Acceptance Criteria (P37.02):
 * 1. Patch without baseSha, writeSet, or diff/file operations is invalid.
 * 2. Store writes and reads artifact without data loss.
 * 3. Artifact paths are scoped to .pi/patches/.
 */

import type { PatchStatus } from "./patch-status.js";
import { validatePatchArtifact } from "./patch-validation-plan.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single file-level operation within a patch.
 */
export interface PatchFileOperation {
	/** Relative path of the file to operate on */
	filePath: string;
	/** Type of operation */
	operation: "edit" | "create" | "delete";
	/** For edit: exact old text to find (targeted replacement) */
	oldText?: string;
	/** For edit/create: replacement or new content */
	newText?: string;
	/** For edit: unified diff text as an alternative to oldText/newText */
	diff?: string;
	/** Human-readable description of this operation */
	description?: string;
}

/**
 * Write set declared by a patch — the set of files the patch intends to modify.
 */
export interface PatchWriteSet {
	/** Individual file paths */
	files: string[];
	/** Glob patterns for file declaration */
	patterns?: string[];
}

/**
 * PatchArtifact — the core schema for a workspace-level patch.
 *
 * Must be validated before storage. An invalid patch (missing baseSha,
 * writeSet, or fileOperations) is rejected by the store.
 */
export interface PatchArtifact {
	/** Unique artifact identifier */
	id: string;
	/** Plan execution ID this artifact belongs to */
	planExecId: string;
	/** Workspace ID this artifact targets */
	workspaceId: string;
	/** Git commit SHA the patch is based on */
	baseSha: string;
	/** Declared write set (files this patch will modify) */
	writeSet: PatchWriteSet;
	/** File operations (diffs, edits, creates, deletes) */
	fileOperations: PatchFileOperation[];
	/** Current lifecycle status */
	status: PatchStatus;
	/** ISO-8601 creation timestamp */
	createdAt: string;
	/** ISO-8601 last-updated timestamp */
	updatedAt: string;
	/** Optional error message when status is "failed" */
	error?: string;
	/** Optional human-readable description */
	description?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

/**
 * Generate a unique patch artifact ID.
 */
export function generatePatchArtifactId(): string {
	idCounter++;
	return `patch-artifact-${idCounter}-${Date.now()}`;
}

/**
 * Create a new PatchArtifact with default values.
 *
 * @param options - Required fields for the artifact
 * @returns A new PatchArtifact in "pending" status
 * @throws Error if the artifact fails validation
 */
export function createPatchArtifact(options: {
	planExecId: string;
	workspaceId: string;
	baseSha: string;
	writeSet: PatchWriteSet;
	fileOperations: PatchFileOperation[];
	description?: string;
}): PatchArtifact {
	const now = new Date().toISOString();
	const artifact: PatchArtifact = {
		id: generatePatchArtifactId(),
		planExecId: options.planExecId,
		workspaceId: options.workspaceId,
		baseSha: options.baseSha,
		writeSet: options.writeSet,
		fileOperations: options.fileOperations,
		status: "pending",
		createdAt: now,
		updatedAt: now,
		description: options.description,
	};

	const validation = validatePatchArtifact(artifact);
	if (!validation.valid) {
		const messages = validation.errors.map((e) => e.message).join("; ");
		throw new Error(`Invalid PatchArtifact: ${messages}`);
	}

	return artifact;
}

/**
 * Create a single file operation for a patch artifact.
 *
 * @param filePath - Relative file path
 * @param operation - Operation type
 * @param options - Additional options (oldText, newText, diff, description)
 * @returns PatchFileOperation
 */
export function createPatchFileOperation(
	filePath: string,
	operation: PatchFileOperation["operation"],
	options?: {
		oldText?: string;
		newText?: string;
		diff?: string;
		description?: string;
	},
): PatchFileOperation {
	return {
		filePath,
		operation,
		oldText: options?.oldText,
		newText: options?.newText,
		diff: options?.diff,
		description: options?.description,
	};
}

/**
 * Create a write set for a patch artifact.
 *
 * @param files - Individual file paths
 * @param patterns - Optional glob patterns
 * @returns PatchWriteSet
 */
export function createPatchWriteSet(files: string[], patterns?: string[]): PatchWriteSet {
	return { files, patterns };
}
