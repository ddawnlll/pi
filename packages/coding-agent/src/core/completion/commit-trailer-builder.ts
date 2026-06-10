/**
 * P44.5.07 — Commit Trailer Builder
 *
 * Builds the structured trailers that must be present in every P44.5 commit.
 * Required trailers:
 * - Pi-Plan: planId
 * - Pi-Workspace: workspaceId
 * - Pi-Agent: agentId
 * - Pi-Completion-Gate: "vNext"
 * - Pi-Commit-Durability: version or description
 * - Pi-Validation: validation outcome
 * - Pi-Generated-By: email or agent identifier
 *
 * Contract Schema: 4.1.1
 */

import type { GitActorIdentity } from "./git-actor-identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for building commit trailers.
 */
export interface CommitTrailerInput {
	/** Plan identifier */
	planId: string;
	/** Workspace identifier */
	workspaceId: string;
	/** Agent identifier */
	agentId: string;
	/** Completion gate version identifier */
	completionGateVersion?: string;
	/** Commit durability description */
	commitDurability?: string;
	/** Validation outcome description */
	validation?: string;
	/** Git actor identity (for Generated-By trailer) */
	identity: GitActorIdentity;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default Pi-Completion-Gate value.
 */
export const DEFAULT_COMPLETION_GATE_VERSION = "vNext";

/**
 * Default Pi-Commit-Durability value when not specified.
 */
export const DEFAULT_COMMIT_DURABILITY = "durable";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build structured commit trailers from input data.
 *
 * @param input - Trailer input data
 * @returns Record of trailer key-value pairs
 */
export function buildCommitTrailers(input: CommitTrailerInput): Record<string, string> {
	const trailers: Record<string, string> = {};

	trailers["Pi-Plan"] = input.planId;
	trailers["Pi-Workspace"] = input.workspaceId;
	trailers["Pi-Agent"] = input.agentId;
	trailers["Pi-Completion-Gate"] = input.completionGateVersion ?? DEFAULT_COMPLETION_GATE_VERSION;
	trailers["Pi-Commit-Durability"] = input.commitDurability ?? DEFAULT_COMMIT_DURABILITY;

	if (input.validation) {
		trailers["Pi-Validation"] = input.validation;
	}
	trailers["Pi-Generated-By"] = input.identity.userEmail;

	return trailers;
}

/**
 * Format trailers as a string for appending to a commit message.
 */
export function formatTrailers(trailers: Record<string, string>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(trailers)) {
		lines.push(`${key}: ${value}`);
	}
	return lines.join("\n");
}

/**
 * Validate that all required trailers are present.
 */
export function validateRequiredTrailers(
	trailers: Record<string, string>,
	requiredTrailerKeys: string[],
): { valid: boolean; missing: string[] } {
	const missing = requiredTrailerKeys.filter((key) => !trailers[key]);
	return {
		valid: missing.length === 0,
		missing,
	};
}
