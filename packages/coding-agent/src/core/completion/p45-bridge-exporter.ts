/**
 * P45.B1 — Accepted WriteSet Export and Ownership Summary
 *
 * P44-to-P45 Bridge Artifact: Exports accepted write sets and ownership
 * summaries from the P44 completion subsystem for consumption by the P45
 * async assembly runtime.
 *
 * This module provides:
 * - AcceptedWriteSet type — the final, validated set of files a workspace
 *   is permitted to modify, distilled from WorkspaceCommitGate results
 * - OwnershipSummary type — maps workspaces to the namespaces/files they
 *   own, derived from aggregated write set data
 * - JSON/Markdown report generation for both artifacts
 *
 * Contract Schema: 4.1.1
 *
 * Used by:
 * - P45.B2 (Assembler-Only Candidate Discovery)
 * - P45.B3 (Evidence Ledger and Mutation Report Export)
 * - P45 Deterministic Assembler for write set verification
 */

import type { CompletionCommitGateResult } from "./workspace-commit-gate.js";
import type { WorkspaceWriteSet } from "./workspace-write-set.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Current schema version for P45 bridge artifacts.
 */
export const P45_BRIDGE_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Default output path for accepted write set reports (relative to repo root).
 */
export const DEFAULT_ACCEPTED_WRITE_SET_PATH = "reports/p44-verified-completion/accepted-write-set.json";

/**
 * Default output path for ownership summary reports (relative to repo root).
 */
export const DEFAULT_OWNERSHIP_SUMMARY_PATH = "reports/p44-verified-completion/ownership-summary.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The final, validated set of files a workspace is permitted to modify.
 *
 * This is the P44-to-P45 bridge artifact: it represents the "accepted truth"
 * that the P45 Deterministic Assembler uses to validate write permissions.
 * It is derived from the WorkspaceCommitGate's write set validation, after
 * all acceptance criteria have been satisfied.
 */
export interface AcceptedWriteSet {
	/** Schema version of this artifact */
	schemaVersion: string;
	/** Workspace that produced this write set */
	workspaceId: string;
	/** Plan or phase execution identifier */
	planExecId: string;
	/** When the write set was accepted (epoch ms) */
	acceptedAt: number;
	/** The authoritative list of file paths (repo-relative) this workspace owns */
	acceptedFiles: string[];
	/** File glob patterns that defined the original write set */
	declaredPatterns: string[];
	/** Files in the write set that were actually modified during execution */
	changedFiles: string[];
	/** Optional commit hash or lock hash under which this was accepted */
	lockHash?: string;
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Single ownership entry mapping a workspace to its owned files.
 */
export interface OwnershipEntry {
	/** Workspace identifier */
	workspaceId: string;
	/** File paths owned by this workspace */
	ownedFiles: string[];
	/** Number of owned files */
	fileCount: number;
}

/**
 * Summary of namespace/file ownership across multiple workspaces.
 *
 * This is the second P44-to-P45 bridge artifact: it provides a global view
 * of which workspaces own which files, enabling the P45 StaticPartitioner
 * and Deterministic Assembler to enforce disjoint write domains.
 */
export interface OwnershipSummary {
	/** Schema version of this artifact */
	schemaVersion: string;
	/** Plan or phase execution identifier */
	planExecId: string;
	/** When the summary was generated (epoch ms) */
	generatedAt: number;
	/** Ownership entries, one per workspace */
	ownership: OwnershipEntry[];
	/** Files that are shared or have no single owner */
	sharedOrUnclaimedFiles: string[];
	/** Aggregate statistics */
	statistics: {
		/** Total number of workspaces with ownership entries */
		totalWorkspaces: number;
		/** Total number of owned files across all workspaces */
		totalOwnedFiles: number;
		/** Total number of shared/unclaimed files */
		totalSharedOrUnclaimed: number;
		/** Mean files per workspace */
		meanFilesPerWorkspace: number;
	};
	/** Optional structured metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Options for building an AcceptedWriteSet from WorkspaceWriteSet data.
 */
export interface AcceptedWriteSetOptions {
	/** Optional lock hash to record */
	lockHash?: string;
	/** Optional metadata to attach */
	metadata?: Record<string, unknown>;
	/** Optional override for the accepted timestamp (default: Date.now()) */
	acceptedAt?: number;
}

/**
 * Options for building an OwnershipSummary.
 */
export interface OwnershipSummaryOptions {
	/** Optional metadata to attach */
	metadata?: Record<string, unknown>;
	/** Optional override for the generation timestamp (default: Date.now()) */
	generatedAt?: number;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Build an AcceptedWriteSet from a WorkspaceWriteSet.
 *
 * The accepted write set is the intersection of declared patterns and
 * actually-modified files that passed the commit gate. It represents
 * the final, validated set of files a workspace owns.
 *
 * @param writeSet - The WorkspaceWriteSet snapshot
 * @param gateResult - Optional CompletionCommitGateResult for validation
 * @param options - Optional build options
 * @returns An AcceptedWriteSet artifact
 */
export function buildAcceptedWriteSet(
	writeSet: WorkspaceWriteSet,
	gateResult?: CompletionCommitGateResult,
	options?: AcceptedWriteSetOptions,
): AcceptedWriteSet {
	// Determine accepted files: start with files that are declared or changed
	const files = writeSet.files;
	const acceptedFiles = files
		.filter((f) => f.declared || f.status === "created" || f.status === "modified")
		.map((f) => f.path)
		.sort();

	const changedFiles = files
		.filter((f) => f.status === "created" || f.status === "modified" || f.status === "deleted")
		.map((f) => f.path)
		.sort();

	// If a gate result is provided, intersect with its allowed files
	let finalAcceptedFiles = acceptedFiles;
	if (gateResult) {
		const gateAllowed = new Set(gateResult.rawResult?.allowedFiles ?? []);
		if (gateAllowed.size > 0) {
			finalAcceptedFiles = acceptedFiles.filter((f) => gateAllowed.has(f));
		}
	}

	return {
		schemaVersion: P45_BRIDGE_SCHEMA_VERSION,
		workspaceId: writeSet.workspaceId,
		planExecId: writeSet.planExecId,
		acceptedAt: options?.acceptedAt ?? Date.now(),
		acceptedFiles: finalAcceptedFiles,
		declaredPatterns: [...writeSet.declaredPatterns],
		changedFiles,
		lockHash: options?.lockHash,
		metadata: options?.metadata,
	};
}

/**
 * Build an OwnershipSummary from multiple AcceptedWriteSet artifacts.
 *
 * Aggregates ownership across workspaces to produce a global map of which
 * workspace owns which files. Detects shared or unclaimed files where
 * multiple workspaces claim the same file or no workspace claims it.
 *
 * @param writeSets - Array of AcceptedWriteSet artifacts
 * @param allTrackedFiles - Optional list of all tracked files in the plan;
 *   files not claimed by any workspace are reported as unclaimed
 * @param options - Optional build options
 * @returns An OwnershipSummary artifact
 */
export function buildOwnershipSummary(
	writeSets: AcceptedWriteSet[],
	allTrackedFiles?: string[],
	options?: OwnershipSummaryOptions,
): OwnershipSummary {
	const ownershipMap = new Map<string, string[]>();
	const fileClaimants = new Map<string, string[]>();

	// Collect ownership per workspace
	for (const ws of writeSets) {
		const files = [...ws.acceptedFiles].sort();
		ownershipMap.set(ws.workspaceId, files);
		for (const file of files) {
			const claimants = fileClaimants.get(file) ?? [];
			claimants.push(ws.workspaceId);
			fileClaimants.set(file, claimants);
		}
	}

	// Build ownership entries
	const ownership: OwnershipEntry[] = [];
	for (const [workspaceId, ownedFiles] of ownershipMap) {
		ownership.push({
			workspaceId,
			ownedFiles,
			fileCount: ownedFiles.length,
		});
	}
	ownership.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));

	// Detect shared or unclaimed files
	const sharedOrUnclaimedFiles: string[] = [];
	const claimedByMultiple = new Set<string>();
	const claimedByAny = new Set<string>();

	for (const [file, claimants] of fileClaimants) {
		if (claimants.length > 1) {
			sharedOrUnclaimedFiles.push(file);
			claimedByMultiple.add(file);
		}
		claimedByAny.add(file);
	}

	// Add unclaimed files (tracked but not owned by any workspace)
	if (allTrackedFiles) {
		for (const file of allTrackedFiles) {
			if (!claimedByAny.has(file)) {
				sharedOrUnclaimedFiles.push(file);
			}
		}
	}
	sharedOrUnclaimedFiles.sort();

	const totalOwnedFiles = ownership.reduce((sum, entry) => sum + entry.fileCount, 0);
	const totalWorkspaces = ownership.length;

	return {
		schemaVersion: P45_BRIDGE_SCHEMA_VERSION,
		planExecId: writeSets.length > 0 ? writeSets[0].planExecId : "",
		generatedAt: options?.generatedAt ?? Date.now(),
		ownership,
		sharedOrUnclaimedFiles,
		statistics: {
			totalWorkspaces,
			totalOwnedFiles,
			totalSharedOrUnclaimed: sharedOrUnclaimedFiles.length,
			meanFilesPerWorkspace: totalWorkspaces > 0 ? Math.round((totalOwnedFiles / totalWorkspaces) * 100) / 100 : 0,
		},
		metadata: options?.metadata,
	};
}

// ---------------------------------------------------------------------------
// Report Generation (Markdown)
// ---------------------------------------------------------------------------

/**
 * Format an AcceptedWriteSet as a human-readable Markdown report.
 *
 * @param writeSet - The accepted write set artifact
 * @returns A Markdown-formatted report string
 */
export function formatAcceptedWriteSetReport(writeSet: AcceptedWriteSet): string {
	const lines: string[] = [
		`# Accepted WriteSet Report`,
		``,
		`**Workspace:** ${writeSet.workspaceId}`,
		`**Plan:** ${writeSet.planExecId}`,
		`**Accepted:** ${new Date(writeSet.acceptedAt).toISOString()}`,
		`**Schema Version:** ${writeSet.schemaVersion}`,
		``,
		`## Accepted Files (${writeSet.acceptedFiles.length})`,
		``,
	];

	if (writeSet.acceptedFiles.length === 0) {
		lines.push(`_No accepted files._`, ``);
	} else {
		for (const file of writeSet.acceptedFiles) {
			lines.push(`- \`${file}\``);
		}
		lines.push(``);
	}

	lines.push(`## Declared Patterns`, ``);
	for (const pattern of writeSet.declaredPatterns) {
		lines.push(`- \`${pattern}\``);
	}
	lines.push(``);

	lines.push(`## Changed Files (${writeSet.changedFiles.length})`, ``);
	if (writeSet.changedFiles.length === 0) {
		lines.push(`_No files changed._`, ``);
	} else {
		for (const file of writeSet.changedFiles) {
			lines.push(`- \`${file}\``);
		}
		lines.push(``);
	}

	if (writeSet.lockHash) {
		lines.push(`## Lock Hash`, ``, `\`${writeSet.lockHash}\``, ``);
	}

	return lines.join("\n");
}

/**
 * Format an OwnershipSummary as a human-readable Markdown report.
 *
 * @param summary - The ownership summary artifact
 * @returns A Markdown-formatted report string
 */
export function formatOwnershipSummaryReport(summary: OwnershipSummary): string {
	const lines: string[] = [
		`# Ownership Summary`,
		``,
		`**Plan:** ${summary.planExecId}`,
		`**Generated:** ${new Date(summary.generatedAt).toISOString()}`,
		`**Schema Version:** ${summary.schemaVersion}`,
		``,
		`## Statistics`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total Workspaces | ${summary.statistics.totalWorkspaces} |`,
		`| Total Owned Files | ${summary.statistics.totalOwnedFiles} |`,
		`| Shared / Unclaimed Files | ${summary.statistics.totalSharedOrUnclaimed} |`,
		`| Mean Files / Workspace | ${summary.statistics.meanFilesPerWorkspace} |`,
		``,
		`## Ownership by Workspace`,
		``,
	];

	for (const entry of summary.ownership) {
		lines.push(`### ${entry.workspaceId} (${entry.fileCount} files)`, ``);
		if (entry.ownedFiles.length === 0) {
			lines.push(`_No owned files._`, ``);
		} else {
			for (const file of entry.ownedFiles) {
				lines.push(`- \`${file}\``);
			}
		}
		lines.push(``);
	}

	if (summary.sharedOrUnclaimedFiles.length > 0) {
		lines.push(`## Shared / Unclaimed Files (${summary.sharedOrUnclaimedFiles.length})`, ``);
		for (const file of summary.sharedOrUnclaimedFiles) {
			lines.push(`- \`${file}\``);
		}
		lines.push(``);
	}

	return lines.join("\n");
}

/**
 * Generate a JSON-serializable AcceptedWriteSet report.
 *
 * @param writeSet - The accepted write set artifact
 * @returns JSON-ready object
 */
export function toAcceptedWriteSetJSON(writeSet: AcceptedWriteSet): Record<string, unknown> {
	return {
		schemaVersion: writeSet.schemaVersion,
		workspaceId: writeSet.workspaceId,
		planExecId: writeSet.planExecId,
		acceptedAt: writeSet.acceptedAt,
		acceptedFiles: writeSet.acceptedFiles,
		declaredPatterns: writeSet.declaredPatterns,
		changedFiles: writeSet.changedFiles,
		...(writeSet.lockHash ? { lockHash: writeSet.lockHash } : {}),
		...(writeSet.metadata ? { metadata: writeSet.metadata } : {}),
	};
}

/**
 * Generate a JSON-serializable OwnershipSummary report.
 *
 * @param summary - The ownership summary artifact
 * @returns JSON-ready object
 */
export function toOwnershipSummaryJSON(summary: OwnershipSummary): Record<string, unknown> {
	return {
		schemaVersion: summary.schemaVersion,
		planExecId: summary.planExecId,
		generatedAt: summary.generatedAt,
		ownership: summary.ownership.map((entry) => ({
			workspaceId: entry.workspaceId,
			ownedFiles: entry.ownedFiles,
			fileCount: entry.fileCount,
		})),
		sharedOrUnclaimedFiles: summary.sharedOrUnclaimedFiles,
		statistics: summary.statistics,
		...(summary.metadata ? { metadata: summary.metadata } : {}),
	};
}

/**
 * Serialize an AcceptedWriteSet as a formatted JSON string.
 *
 * @param writeSet - The accepted write set artifact
 * @returns Pretty-printed JSON string
 */
export function serializeAcceptedWriteSet(writeSet: AcceptedWriteSet): string {
	return `${JSON.stringify(toAcceptedWriteSetJSON(writeSet), null, 2)}\n`;
}

/**
 * Serialize an OwnershipSummary as a formatted JSON string.
 *
 * @param summary - The ownership summary artifact
 * @returns Pretty-printed JSON string
 */
export function serializeOwnershipSummary(summary: OwnershipSummary): string {
	return `${JSON.stringify(toOwnershipSummaryJSON(summary), null, 2)}\n`;
}
