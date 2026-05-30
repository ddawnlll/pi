/**
 * Patch Status - Lifecycle states for a PatchArtifact.
 *
 * P4.5 Workstream: Tracks the lifecycle from creation through
 * validation, application, failure, or reversion.
 *
 * States:
 * - pending:   Artifact created but not yet validated or applied
 * - validated: Artifact passed validation (baseSha, writeSet, file ops present)
 * - applied:   Artifact has been successfully applied to the workspace
 * - failed:    Artifact application failed (validation or execution error)
 * - reverted:  Artifact application was reverted/rolled back
 */

/**
 * Lifecycle status of a PatchArtifact.
 */
export type PatchStatus = "pending" | "validated" | "applied" | "failed" | "reverted";
