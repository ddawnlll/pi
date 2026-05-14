/**
 * Repo Health Signal Types - P8.C Repo Scanning & Analysis
 *
 * Defines the signal types, evidence, and proposals produced by the
 * repo health scanner. Each health signal links concrete evidence
 * (file paths, line numbers, command output) to actionable proposals.
 *
 * Signals are grouped into categories for easier consumption.
 */

// ---------------------------------------------------------------------------
// Signal Severity
// ---------------------------------------------------------------------------

/**
 * Severity of a health signal.
 */
export type SignalSeverity = "error" | "warning" | "info";

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence supporting a health signal.
 *
 * Evidence always references a concrete location or observation,
 * never a general statement. This ensures scanner findings are
 * auditable and traceable.
 */
export interface SignalEvidence {
	/**
	 * Human-readable description of the evidence.
	 * Example: "File packages/ai/src/types.ts exports unused type 'Api'"
	 */
	description: string;

	/**
	 * File path relative to repo root (if applicable).
	 */
	filePath?: string;

	/**
	 * Line number range (1-indexed, if applicable).
	 */
	lineStart?: number;
	lineEnd?: number;

	/**
	 * Raw output snippet that supports the signal (if applicable).
	 * Limited to a few lines for readability.
	 */
	snippet?: string;

	/**
	 * Command that produced the output (if applicable).
	 */
	command?: string;

	/**
	 * Exit code of the command (if applicable).
	 */
	exitCode?: number;
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/**
 * A proposed remediation for a health signal.
 *
 * Proposals are actionable suggestions that can be directly
 * translated into workspace tasks or plan amendments.
 */
export interface SignalProposal {
	/**
	 * Concise action-oriented description.
	 * Example: "Remove unused export 'Api' from packages/ai/src/types.ts"
	 */
	description: string;

	/**
	 * File path(s) that would need to be modified.
	 */
	targetFiles: string[];

	/**
	 * Estimated effort.
	 */
	effort: "trivial" | "small" | "medium" | "large";

	/**
	 * Whether this proposal can be automated (e.g., auto-fix).
	 */
	autoFixable: boolean;
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * Category of repository health signal.
 */
export type HealthCategory =
	/** TypeScript compilation / type check issues */
	| "typecheck"
	/** Build failures */
	| "build"
	/** Test infrastructure issues (missing tests, failing test config) */
	| "test"
	/** Schema validation issues in workspace queues */
	| "schema"
	/** Dependency graph issues (cycles, orphaned nodes) */
	| "dependency_graph"
	/** Workspace configuration issues (broad scopes, missing fields) */
	| "workspace_config"
	/** File scope / access pattern hygiene */
	| "file_scope"
	/** Import resolution issues (broken imports, missing modules) */
	| "imports"
	/** Dead code (unused exports, unreferenced symbols) */
	| "dead_code"
	/** Git / working tree issues */
	| "git"
	/** Security / safety concerns */
	| "safety"
	/** Missing or misconfigured skills */
	| "skills"
	/** Repo metadata (package.json, tsconfig issues) */
	| "repo_metadata";

// ---------------------------------------------------------------------------
// Health Signal
// ---------------------------------------------------------------------------

/**
 * A single health signal produced by the repo scanner.
 *
 * Each signal represents one finding with supporting evidence and
 * a proposed remediation. Signals are the atomic unit of scanner output.
 */
export interface HealthSignal {
	/** Unique identifier within a scan run (e.g., "signal-001") */
	id: string;

	/** Human-readable title */
	title: string;

	/** Detailed description of the finding */
	description: string;

	/** Severity */
	severity: SignalSeverity;

	/** Category */
	category: HealthCategory;

	/** Scope: which package or area this signal relates to */
	scope: string;

	/** Evidence supporting this signal */
	evidence: SignalEvidence[];

	/** Proposed remediation(s) */
	proposals: SignalProposal[];

	/** Whether this signal has been auto-verified (confirmed by re-checking) */
	verified: boolean;

	/** When this signal was produced (ISO 8601) */
	timestamp: string;
}

// ---------------------------------------------------------------------------
// Scanner Summary
// ---------------------------------------------------------------------------

/**
 * Summary counts for a scan run.
 */
export interface ScanSummary {
	/** Total signals produced */
	totalSignals: number;

	/** Count by severity */
	errors: number;
	warnings: number;
	infos: number;

	/** Count by category */
	byCategory: Partial<Record<HealthCategory, number>>;

	/** Total evidence items across all signals */
	totalEvidence: number;

	/** Total proposals across all signals */
	totalProposals: number;

	/** How many signals are auto-fixable */
	autoFixableCount: number;

	/** Duration of the scan in milliseconds */
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Scan Result
// ---------------------------------------------------------------------------

/**
 * Complete result of a repo health scan.
 */
export interface ScanResult {
	/** All health signals produced */
	signals: HealthSignal[];

	/** Summary statistics */
	summary: ScanSummary;

	/** Repo root path */
	repoRoot: string;

	/** When the scan was started (ISO 8601) */
	startedAt: string;

	/** When the scan completed (ISO 8601) */
	completedAt: string;

	/** Scanner version / identity */
	scannerVersion: string;
}
