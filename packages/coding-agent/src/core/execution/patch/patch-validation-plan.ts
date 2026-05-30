/**
 * Patch Validation Plan - P4.5 Workstream
 *
 * Defines the validation rules for PatchArtifact instances.
 *
 * Acceptance Criteria (P37.02):
 * 1. Patch without baseSha, writeSet, or diff/file operations is invalid.
 *
 * Validation rules:
 * - baseSha must be a non-empty string
 * - writeSet must be present with at least one file in files[]
 * - fileOperations must be a non-empty array
 */

import type { PatchArtifact } from "./patch-artifact.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A validation error describing why a patch artifact is invalid.
 */
export interface PatchValidationError {
	/** Machine-readable error code */
	code: string;
	/** Human-readable error message */
	message: string;
	/** The field that failed validation (optional) */
	field?: string;
}

/**
 * Result of validating a PatchArtifact.
 */
export interface PatchValidationResult {
	/** Whether the artifact passed all validation rules */
	valid: boolean;
	/** Validation errors (empty if valid) */
	errors: PatchValidationError[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a PatchArtifact against all schema rules.
 *
 * Rules:
 * - baseSha must be a non-empty string
 * - writeSet must be present with at least one file in files[]
 * - fileOperations must be a non-empty array
 *
 * @param artifact - The patch artifact to validate
 * @returns PatchValidationResult with errors if any rules are violated
 */
export function validatePatchArtifact(artifact: PatchArtifact): PatchValidationResult {
	const errors: PatchValidationError[] = [];

	// Rule 1: baseSha must be present and non-empty
	if (!artifact.baseSha || (typeof artifact.baseSha === "string" && artifact.baseSha.trim().length === 0)) {
		errors.push({
			code: "MISSING_BASE_SHA",
			message: "Patch must have a non-empty baseSha",
			field: "baseSha",
		});
	}

	// Rule 2: writeSet must be present with at least one file
	if (!artifact.writeSet) {
		errors.push({
			code: "MISSING_WRITE_SET",
			message: "Patch must have a writeSet",
			field: "writeSet",
		});
	} else if (!artifact.writeSet.files || artifact.writeSet.files.length === 0) {
		errors.push({
			code: "MISSING_WRITE_SET_FILES",
			message: "Patch writeSet must contain at least one file",
			field: "writeSet.files",
		});
	}

	// Rule 3: fileOperations must be present and non-empty
	if (!artifact.fileOperations) {
		errors.push({
			code: "MISSING_FILE_OPERATIONS",
			message: "Patch must have fileOperations",
			field: "fileOperations",
		});
	} else if (artifact.fileOperations.length === 0) {
		errors.push({
			code: "EMPTY_FILE_OPERATIONS",
			message: "Patch must have at least one file operation",
			field: "fileOperations",
		});
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
