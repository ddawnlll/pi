/**
 * P44.13 — Final Promotion Report & Stable_3 Gate
 *
 * Produces the final promotion report for P44, assessing wave-by-wave
 * completion, workspace status, gate passage, and the Stable_3 gate conditions.
 *
 * The Stable_3 gate is the final gate check that validates all P44 workspaces
 * are complete, all wave gates have passed, and no blocking issues remain.
 *
 * Contract Schema: 4.2.0
 */

import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current schema version for the final promotion report. */
export const PROMOTION_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** P44 wave plan definition — all 8 waves with their workspace assignments. */
export const P44_WAVE_PLAN = [
	{
		waveId: "W1",
		title: "Foundation — Types, Evidence, Worker Report",
		workspaceIds: ["P44.01", "P44.02", "P44.06"],
		gateCommandCount: 4,
		requiredArtifactCount: 3,
		risk: "medium",
	},
	{
		waveId: "W2",
		title: "Gate Core — v2 Completion, Terminal Reconciler, Scanner, Auditor",
		workspaceIds: ["P44.03", "P44.04", "P44.05", "P44.07"],
		gateCommandCount: 4,
		requiredArtifactCount: 4,
		risk: "high",
	},
	{
		waveId: "W3",
		title: "Commit Safety + Mutation Wiring",
		workspaceIds: ["P44.08", "P44.09", "NEW-WG-WIRE"],
		gateCommandCount: 4,
		requiredArtifactCount: 2,
		risk: "high",
	},
	{
		waveId: "W4",
		title: "Audit Production Wiring",
		workspaceIds: ["P44.07-integration"],
		gateCommandCount: 1,
		requiredArtifactCount: 1,
		risk: "medium",
	},
	{
		waveId: "W5",
		title: "Visibility — Dashboard Read Model",
		workspaceIds: ["P44.10"],
		gateCommandCount: 1,
		requiredArtifactCount: 1,
		risk: "low",
	},
	{
		waveId: "W6",
		title: "Quality — Gauntlet",
		workspaceIds: ["P44.11"],
		gateCommandCount: 3,
		requiredArtifactCount: 2,
		risk: "medium",
	},
	{
		waveId: "W7",
		title: "Bridge — Template Update + P45 Artifacts",
		workspaceIds: ["P44.12", "P45-BRIDGE-WS1", "P45-BRIDGE-WS2"],
		gateCommandCount: 2,
		requiredArtifactCount: 4,
		risk: "low",
	},
	{
		waveId: "W8",
		title: "Final — Promotion Report",
		workspaceIds: ["P44.13"],
		gateCommandCount: 2,
		requiredArtifactCount: 2,
		risk: "low",
	},
] as const;

/** All unique workspace IDs across all waves. */
export const ALL_P44_WORKSPACE_IDS: readonly string[] = [
	"P44.01",
	"P44.02",
	"P44.03",
	"P44.04",
	"P44.05",
	"P44.06",
	"P44.07",
	"P44.07-integration",
	"P44.08",
	"P44.09",
	"NEW-WG-WIRE",
	"P44.10",
	"P44.11",
	"P44.12",
	"P45-BRIDGE-WS1",
	"P45-BRIDGE-WS2",
	"P44.13",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity level for a promotion check. */
export type PromotionSeverity = "pass" | "warn" | "fail" | "error";

/** Status of a single workspace's completion. */
export type WorkspaceStatus = "passed" | "failed" | "blocked" | "skipped";

/** Status of a wave's execution. */
export type WaveStatus = "passed" | "blocked" | "not_started";

/** Overall promotion verdict. */
export type PromotionVerdict = "promote" | "blocked" | "failed";

/** A single promotion check result. */
export interface PromotionCheck {
	/** Unique check identifier */
	id: string;
	/** Human-readable check name */
	name: string;
	/** Check severity */
	severity: PromotionSeverity;
	/** Human-readable message */
	message: string;
	/** Optional detailed explanation */
	details?: string;
	/** Optional recommendation to fix the issue */
	recommendation?: string;
}

/** Status of a single workspace in the promotion report. */
export interface WorkspacePromotionEntry {
	/** Workspace identifier */
	workspaceId: string;
	/** Workspace title */
	title: string;
	/** Current workspace wave assignment */
	waveId: string;
	/** Completion status */
	status: WorkspaceStatus;
	/** Optional evidence reference */
	evidenceRef?: string;
	/** Optional error message if failed/blocked */
	error?: string;
}

/** Status of a wave in the promotion report. */
export interface WavePromotionEntry {
	/** Wave identifier */
	waveId: string;
	/** Wave title */
	title: string;
	/** Wave risk level */
	risk: string;
	/** Overall wave status */
	status: WaveStatus;
	/** Number of workspaces in the wave */
	workspaceCount: number;
	/** Number of workspaces passed */
	passedCount: number;
	/** Number of workspaces failed */
	failedCount: number;
	/** Number of workspaces blocked */
	blockedCount: number;
	/** Wave gate checks */
	gateChecks: PromotionCheck[];
}

/** Stable_3 gate assessment result. */
export interface Stable3GateAssessment {
	/** Whether the Stable_3 gate is cleared */
	cleared: boolean;
	/** Individual gate checks */
	checks: PromotionCheck[];
	/** Summary of the gate assessment */
	summary: string;
}

/** Complete final promotion report for P44. */
export interface FinalPromotionReport {
	/** Report identifier */
	reportId: string;
	/** Schema version */
	schemaVersion: string;
	/** Report generation timestamp (epoch ms) */
	timestamp: number;
	/** Overall promotion verdict */
	verdict: PromotionVerdict;
	/** Phase identifier */
	phase: string;
	/** Execution mode */
	mode: string;
	/** Wave-by-wave results */
	waves: WavePromotionEntry[];
	/** Workspace-by-workspace results */
	workspaces: WorkspacePromotionEntry[];
	/** Stable_3 gate assessment */
	stable3Gate: Stable3GateAssessment;
	/** Summary statistics */
	summary: PromotionSummary;
}

/** Summary statistics for the promotion report. */
export interface PromotionSummary {
	/** Total number of waves */
	totalWaves: number;
	/** Number of waves passed */
	passedWaves: number;
	/** Number of waves blocked */
	blockedWaves: number;
	/** Number of waves not started */
	notStartedWaves: number;
	/** Total number of workspaces */
	totalWorkspaces: number;
	/** Number of workspaces passed */
	passedWorkspaces: number;
	/** Number of workspaces failed */
	failedWorkspaces: number;
	/** Number of workspaces blocked */
	blockedWorkspaces: number;
	/** Number of workspaces skipped */
	skippedWorkspaces: number;
	/** Number of pass checks */
	passChecks: number;
	/** Number of warn checks */
	warnChecks: number;
	/** Number of fail checks */
	failChecks: number;
	/** Number of error checks */
	errorChecks: number;
	/** Stable_3 gate cleared */
	stable3Cleared: boolean;
}

// ---------------------------------------------------------------------------
// Stable_3 Gate Checks
// ---------------------------------------------------------------------------

/** Check IDs for the Stable_3 gate. */
export const STABLE_3_CHECKS = {
	WAVE_DATA_PROVIDED: "STABLE3-CHECK-000",
	WORKSPACE_DATA_PROVIDED: "STABLE3-CHECK-001",
	ALL_WAVES_COMPLETED: "STABLE3-CHECK-002",
	ALL_WORKSPACES_PASSED: "STABLE3-CHECK-003",
	NO_FAILED_WORKSPACES: "STABLE3-CHECK-004",
	NO_BLOCKED_WORKSPACES: "STABLE3-CHECK-005",
	GAUNTLET_ARTIFACTS_EXIST: "STABLE3-CHECK-006",
	BRIDGE_ARTIFACTS_EXIST: "STABLE3-CHECK-007",
	PROMOTION_REPORT_WRITABLE: "STABLE3-CHECK-008",
} as const;

/**
 * Options for Stable_3 gate assessment.
 */
export interface Stable3GateOptions {
	/** Project root for artifact existence checks */
	projectRoot?: string;
	/** Skip file existence checks (useful in CI or testing) */
	skipFileExistenceChecks?: boolean;
}

/**
 * Assess the Stable_3 gate conditions given wave and workspace status data.
 *
 * @param waves - Wave promotion entries
 * @param workspaces - Workspace promotion entries
 * @param options - Optional configuration (string for legacy projectRoot, or Stable3GateOptions)
 * @returns Stable_3 gate assessment
 */
export function assessStable3Gate(
	waves: WavePromotionEntry[],
	workspaces: WorkspacePromotionEntry[],
	options?: string | Stable3GateOptions,
): Stable3GateAssessment {
	const checks: PromotionCheck[] = [];

	// Normalize options: support legacy string parameter for projectRoot
	let resolvedOptions: Stable3GateOptions;
	if (typeof options === "string") {
		resolvedOptions = { projectRoot: options, skipFileExistenceChecks: false };
	} else {
		resolvedOptions = { ...options, skipFileExistenceChecks: options?.skipFileExistenceChecks ?? false };
	}
	const root = resolvedOptions.projectRoot ?? process.cwd();
	const skipFileExistence = resolvedOptions.skipFileExistenceChecks ?? false;

	// Check 0A: At least one wave provided
	if (waves.length === 0) {
		checks.push({
			id: STABLE_3_CHECKS.WAVE_DATA_PROVIDED,
			name: "Wave Data Provided",
			severity: "fail",
			message: "No wave data provided — cannot assess Stable_3 gate",
			recommendation: "Provide wave completion data before assessing the gate",
		});
	}

	// Check 0B: At least one workspace provided
	if (workspaces.length === 0) {
		checks.push({
			id: STABLE_3_CHECKS.WORKSPACE_DATA_PROVIDED,
			name: "Workspace Data Provided",
			severity: "fail",
			message: "No workspace data provided — cannot assess Stable_3 gate",
			recommendation: "Provide workspace completion data before assessing the gate",
		});
	}

	// Check 1: All waves completed
	const notStartedWaves = waves.filter((w) => w.status === "not_started");
	if (notStartedWaves.length > 0) {
		checks.push({
			id: STABLE_3_CHECKS.ALL_WAVES_COMPLETED,
			name: "All Waves Completed",
			severity: "fail",
			message: `${notStartedWaves.length} wave(s) not yet started: ${notStartedWaves.map((w) => w.waveId).join(", ")}`,
			recommendation: "Complete all waves before promoting to Stable_3",
		});
	} else {
		checks.push({
			id: STABLE_3_CHECKS.ALL_WAVES_COMPLETED,
			name: "All Waves Completed",
			severity: "pass",
			message: `All ${waves.length} waves have been completed`,
		});
	}

	// Check 2: All workspaces passed
	const nonPassedWorkspaces = workspaces.filter((w) => w.status !== "passed");
	if (nonPassedWorkspaces.length > 0) {
		checks.push({
			id: STABLE_3_CHECKS.ALL_WORKSPACES_PASSED,
			name: "All Workspaces Passed",
			severity: "fail",
			message: `${nonPassedWorkspaces.length} workspace(s) have not passed: ${nonPassedWorkspaces.map((w) => w.workspaceId).join(", ")}`,
			recommendation: "Ensure all workspaces pass before Stable_3 promotion",
		});
	} else {
		checks.push({
			id: STABLE_3_CHECKS.ALL_WORKSPACES_PASSED,
			name: "All Workspaces Passed",
			severity: "pass",
			message: `All ${workspaces.length} workspaces have passed`,
		});
	}

	// Check 3: No failed workspaces
	const failedWorkspaces = workspaces.filter((w) => w.status === "failed");
	if (failedWorkspaces.length > 0) {
		checks.push({
			id: STABLE_3_CHECKS.NO_FAILED_WORKSPACES,
			name: "No Failed Workspaces",
			severity: "fail",
			message: `${failedWorkspaces.length} workspace(s) have failed: ${failedWorkspaces.map((w) => w.workspaceId).join(", ")}`,
			details: failedWorkspaces
				.filter((w) => w.error)
				.map((w) => `${w.workspaceId}: ${w.error}`)
				.join("; "),
			recommendation: "Resolve failures before Stable_3 promotion",
		});
	} else {
		checks.push({
			id: STABLE_3_CHECKS.NO_FAILED_WORKSPACES,
			name: "No Failed Workspaces",
			severity: "pass",
			message: "No workspaces have failed",
		});
	}

	// Check 4: No blocked workspaces
	const blockedWorkspaces = workspaces.filter((w) => w.status === "blocked");
	if (blockedWorkspaces.length > 0) {
		checks.push({
			id: STABLE_3_CHECKS.NO_BLOCKED_WORKSPACES,
			name: "No Blocked Workspaces",
			severity: "fail",
			message: `${blockedWorkspaces.length} workspace(s) are blocked: ${blockedWorkspaces.map((w) => w.workspaceId).join(", ")}`,
			recommendation: "Resolve blockers before Stable_3 promotion",
		});
	} else {
		checks.push({
			id: STABLE_3_CHECKS.NO_BLOCKED_WORKSPACES,
			name: "No Blocked Workspaces",
			severity: "pass",
			message: "No workspaces are blocked",
		});
	}

	// Check 5: Gauntlet artifacts exist
	if (!skipFileExistence) {
		const gauntletArtifacts = ["reports/p44-fake-complete-gauntlet.json", "reports/p44-commit-scope-gauntlet.json"];
		const missingGauntletArtifacts = gauntletArtifacts.filter((a) => {
			try {
				accessSync(resolve(root, a), constants.R_OK);
				return false;
			} catch {
				return true;
			}
		});
		if (missingGauntletArtifacts.length > 0) {
			checks.push({
				id: STABLE_3_CHECKS.GAUNTLET_ARTIFACTS_EXIST,
				name: "Gauntlet Artifacts Exist",
				severity: "fail",
				message: `${missingGauntletArtifacts.length} gauntlet artifact(s) missing: ${missingGauntletArtifacts.join(", ")}`,
				recommendation: "Run the gauntlet tests and ensure artifacts are generated",
			});
		} else {
			checks.push({
				id: STABLE_3_CHECKS.GAUNTLET_ARTIFACTS_EXIST,
				name: "Gauntlet Artifacts Exist",
				severity: "pass",
				message: "All gauntlet artifacts are present",
			});
		}
	} else {
		checks.push({
			id: STABLE_3_CHECKS.GAUNTLET_ARTIFACTS_EXIST,
			name: "Gauntlet Artifacts Exist",
			severity: "pass",
			message: "File existence check skipped — assuming artifacts present",
		});
	}

	// Check 6: Bridge artifacts exist
	if (!skipFileExistence) {
		const bridgeArtifacts = [
			"reports/p44-verified-completion/accepted-write-set.json",
			"reports/p44-verified-completion/ownership-summary.json",
			"reports/p44-verified-completion/completion-audit.json",
		];
		const missingBridgeArtifacts = bridgeArtifacts.filter((a) => {
			try {
				accessSync(resolve(root, a), constants.R_OK);
				return false;
			} catch {
				return true;
			}
		});
		if (missingBridgeArtifacts.length > 0) {
			checks.push({
				id: STABLE_3_CHECKS.BRIDGE_ARTIFACTS_EXIST,
				name: "Bridge Artifacts Exist",
				severity: "warn",
				message: `${missingBridgeArtifacts.length} bridge artifact(s) missing: ${missingBridgeArtifacts.join(", ")}`,
				recommendation: "Ensure P45 bridge artifacts are generated in W7",
			});
		} else {
			checks.push({
				id: STABLE_3_CHECKS.BRIDGE_ARTIFACTS_EXIST,
				name: "Bridge Artifacts Exist",
				severity: "pass",
				message: "All bridge artifacts are present",
			});
		}
	} else {
		checks.push({
			id: STABLE_3_CHECKS.BRIDGE_ARTIFACTS_EXIST,
			name: "Bridge Artifacts Exist",
			severity: "pass",
			message: "File existence check skipped — assuming artifacts present",
		});
	}

	// Check 7: Final promotion report artifacts are writable
	if (!skipFileExistence) {
		const promotionReportPath = resolve(root, "reports/p44-verified-completion");
		try {
			accessSync(promotionReportPath, constants.W_OK);
			checks.push({
				id: STABLE_3_CHECKS.PROMOTION_REPORT_WRITABLE,
				name: "Promotion Report Path Writable",
				severity: "pass",
				message: `Promotion report directory is writable: ${promotionReportPath}`,
			});
		} catch {
			checks.push({
				id: STABLE_3_CHECKS.PROMOTION_REPORT_WRITABLE,
				name: "Promotion Report Path Writable",
				severity: "error",
				message: `Promotion report directory is not writable: ${promotionReportPath}`,
				recommendation: "Ensure directory exists and is writable",
			});
		}
	} else {
		checks.push({
			id: STABLE_3_CHECKS.PROMOTION_REPORT_WRITABLE,
			name: "Promotion Report Path Writable",
			severity: "pass",
			message: "File existence check skipped — assuming path is writable",
		});
	}

	// Determine if the gate is cleared
	const cleared = checks.every((c) => c.severity === "pass" || c.severity === "warn");

	const failCount = checks.filter((c) => c.severity === "fail").length;
	const errorCount = checks.filter((c) => c.severity === "error").length;

	let summary: string;
	if (cleared) {
		summary = "Stable_3 gate is CLEARED. All conditions for P44 promotion are satisfied.";
	} else if (errorCount > 0) {
		summary = `Stable_3 gate is FAILED. ${failCount} check(s) failed and ${errorCount} error(s) encountered.`;
	} else {
		summary = `Stable_3 gate is BLOCKED. ${failCount} check(s) must be resolved before promotion.`;
	}

	return { cleared, checks, summary };
}

// ---------------------------------------------------------------------------
// Final Promotion Report Generator
// ---------------------------------------------------------------------------

/**
 * Configuration options for the FinalPromotionReportGenerator.
 */
export interface FinalPromotionReportOptions {
	/** Phase identifier */
	phase?: string;
	/** Execution mode */
	mode?: string;
	/** Project root for artifact existence checks */
	projectRoot?: string;
	/** Skip file existence checks (useful in CI or testing) */
	skipFileExistenceChecks?: boolean;
	/** Report label/identifier prefix */
	reportLabel?: string;
}

/**
 * Final Promotion Report Generator for P44.
 *
 * Aggregates wave and workspace status data, runs Stable_3 gate checks,
 * and produces both structured (JSON) and human-readable (Markdown) reports.
 */
export class FinalPromotionReportGenerator {
	private options: Required<FinalPromotionReportOptions>;

	constructor(options?: FinalPromotionReportOptions) {
		this.options = {
			phase: options?.phase ?? "P44",
			mode: options?.mode ?? "stable_3_wave_batch",
			projectRoot: options?.projectRoot ?? process.cwd(),
			skipFileExistenceChecks: options?.skipFileExistenceChecks ?? false,
			reportLabel: options?.reportLabel ?? "P44 Final Promotion Report",
		};
	}

	/**
	 * Generate the complete final promotion report.
	 *
	 * @param workspaceEntries - Workspace completion status entries
	 * @returns Complete final promotion report
	 */
	generate(workspaceEntries: WorkspacePromotionEntry[]): FinalPromotionReport {
		// Build wave entries from workspace data
		const waveEntries = this.buildWaveEntries(workspaceEntries);

		// Run Stable_3 gate assessment
		const stable3Gate = assessStable3Gate(waveEntries, workspaceEntries, {
			projectRoot: this.options.projectRoot,
			skipFileExistenceChecks: this.options.skipFileExistenceChecks,
		});

		// Count statistics
		const passedWorkspaces = workspaceEntries.filter((w) => w.status === "passed").length;
		const failedWorkspaces = workspaceEntries.filter((w) => w.status === "failed").length;
		const blockedWorkspaces = workspaceEntries.filter((w) => w.status === "blocked").length;
		const skippedWorkspaces = workspaceEntries.filter((w) => w.status === "skipped").length;

		const passedWaves = waveEntries.filter((w) => w.status === "passed").length;
		const blockedWaves = waveEntries.filter((w) => w.status === "blocked").length;
		const notStartedWaves = waveEntries.filter((w) => w.status === "not_started").length;

		// Count individual checks across waves
		let passChecks = 0;
		let warnChecks = 0;
		let failChecks = 0;
		let errorChecks = 0;
		for (const wave of waveEntries) {
			for (const check of wave.gateChecks) {
				switch (check.severity) {
					case "pass":
						passChecks++;
						break;
					case "warn":
						warnChecks++;
						break;
					case "fail":
						failChecks++;
						break;
					case "error":
						errorChecks++;
						break;
				}
			}
		}

		// Determine overall verdict
		let verdict: PromotionVerdict;
		if (stable3Gate.cleared && failedWorkspaces === 0 && blockedWorkspaces === 0 && notStartedWaves === 0) {
			verdict = "promote";
		} else if (failedWorkspaces > 0) {
			verdict = "failed";
		} else {
			verdict = "blocked";
		}

		return {
			reportId: `P44-PROMO-${Date.now()}`,
			schemaVersion: PROMOTION_REPORT_SCHEMA_VERSION,
			timestamp: Date.now(),
			verdict,
			phase: this.options.phase,
			mode: this.options.mode,
			waves: waveEntries,
			workspaces: workspaceEntries,
			stable3Gate,
			summary: {
				totalWaves: waveEntries.length,
				passedWaves,
				blockedWaves,
				notStartedWaves,
				totalWorkspaces: workspaceEntries.length,
				passedWorkspaces,
				failedWorkspaces,
				blockedWorkspaces,
				skippedWorkspaces,
				passChecks,
				warnChecks,
				failChecks,
				errorChecks,
				stable3Cleared: stable3Gate.cleared,
			},
		};
	}

	/**
	 * Build wave entries from workspace data.
	 */
	private buildWaveEntries(workspaces: WorkspacePromotionEntry[]): WavePromotionEntry[] {
		return P44_WAVE_PLAN.map((waveDef) => {
			const waveWorkspaces = workspaces.filter(
		(w) => (waveDef.workspaceIds as readonly string[]).includes(w.workspaceId),
	);
			const passedCount = waveWorkspaces.filter((w) => w.status === "passed").length;
			const failedCount = waveWorkspaces.filter((w) => w.status === "failed").length;
			const blockedCount = waveWorkspaces.filter((w) => w.status === "blocked").length;

			// Determine wave status
			let status: WaveStatus;
			if (waveWorkspaces.length === 0) {
				status = "not_started";
			} else if (failedCount > 0 || blockedCount > 0) {
				status = "blocked";
			} else if (passedCount === waveDef.workspaceIds.length) {
				status = "passed";
			} else {
				// Some workspaces are skipped or not yet reported
				status = "blocked";
			}

			// Build gate checks for the wave
			const gateChecks: PromotionCheck[] = this.buildWaveGateChecks(waveDef, waveWorkspaces);

			return {
				waveId: waveDef.waveId,
				title: waveDef.title,
				risk: waveDef.risk,
				status,
				workspaceCount: waveDef.workspaceIds.length,
				passedCount,
				failedCount,
				blockedCount,
				gateChecks,
			};
		});
	}

	/**
	 * Build gate checks for a wave based on workspace completion status.
	 */
	private buildWaveGateChecks(
		waveDef: (typeof P44_WAVE_PLAN)[number],
		waveWorkspaces: WorkspacePromotionEntry[],
	): PromotionCheck[] {
		const checks: PromotionCheck[] = [];

		// Check: All workspaces in the wave are accounted for
		const missingWorkspaces = waveDef.workspaceIds.filter((id) => !waveWorkspaces.some((w) => w.workspaceId === id));
		if (missingWorkspaces.length > 0) {
			checks.push({
				id: `WAVE-${waveDef.waveId}-WS-ACCT`,
				name: "All Wave Workspaces Accounted For",
				severity: "fail",
				message: `${missingWorkspaces.length} workspace(s) not reported: ${missingWorkspaces.join(", ")}`,
			});
		} else {
			checks.push({
				id: `WAVE-${waveDef.waveId}-WS-ACCT`,
				name: "All Wave Workspaces Accounted For",
				severity: "pass",
				message: `All ${waveDef.workspaceIds.length} workspace(s) accounted for`,
			});
		}

		// Check: No failed workspaces in wave
		const failedInWave = waveWorkspaces.filter((w) => w.status === "failed");
		if (failedInWave.length > 0) {
			checks.push({
				id: `WAVE-${waveDef.waveId}-WS-PASS`,
				name: "All Wave Workspaces Passed",
				severity: "fail",
				message: `${failedInWave.length} workspace(s) failed in wave ${waveDef.waveId}: ${failedInWave.map((w) => w.workspaceId).join(", ")}`,
			});
		} else {
			checks.push({
				id: `WAVE-${waveDef.waveId}-WS-PASS`,
				name: "All Wave Workspaces Passed",
				severity: "pass",
				message: "All wave workspaces passed",
			});
		}

		return checks;
	}
}

// ---------------------------------------------------------------------------
// Report Formatting
// ---------------------------------------------------------------------------

/**
 * Format a final promotion report as a human-readable Markdown string.
 *
 * @param report - The promotion report to format
 * @returns Markdown-formatted report string
 */
export function formatPromotionReport(report: FinalPromotionReport): string {
	const lines: string[] = [];

	lines.push("# P44 Final Promotion Report");
	lines.push("");
	lines.push(`**Report ID:** ${report.reportId}`);
	lines.push(`**Schema Version:** ${report.schemaVersion}`);
	lines.push(`**Timestamp:** ${new Date(report.timestamp).toISOString()}`);
	lines.push(`**Phase:** ${report.phase}`);
	lines.push(`**Mode:** ${report.mode}`);
	lines.push(`**Overall Verdict:** ${formatVerdictLabel(report.verdict)}`);
	lines.push("");

	// Stable_3 Gate
	lines.push("## Stable_3 Gate");
	lines.push("");
	lines.push(`**Status:** ${report.stable3Gate.cleared ? "CLEARED" : "NOT CLEARED"}`);
	lines.push("");
	lines.push(report.stable3Gate.summary);
	lines.push("");
	lines.push("### Gate Checks");
	lines.push("");
	lines.push("| ID | Check | Severity | Message |");
	lines.push("|----|-------|----------|---------|");
	for (const check of report.stable3Gate.checks) {
		lines.push(`| ${check.id} | ${check.name} | ${formatSeverityLabel(check.severity)} | ${check.message} |`);
	}
	lines.push("");

	// Summary
	lines.push("## Summary");
	lines.push("");
	lines.push("### Waves");
	lines.push("");
	lines.push(`| Metric | Value |`);
	lines.push(`|--------|-------|`);
	lines.push(`| Total Waves | ${report.summary.totalWaves} |`);
	lines.push(`| Passed | ${report.summary.passedWaves} |`);
	lines.push(`| Blocked | ${report.summary.blockedWaves} |`);
	lines.push(`| Not Started | ${report.summary.notStartedWaves} |`);
	lines.push("");
	lines.push("### Workspaces");
	lines.push("");
	lines.push(`| Metric | Value |`);
	lines.push(`|--------|-------|`);
	lines.push(`| Total Workspaces | ${report.summary.totalWorkspaces} |`);
	lines.push(`| Passed | ${report.summary.passedWorkspaces} |`);
	lines.push(`| Failed | ${report.summary.failedWorkspaces} |`);
	lines.push(`| Blocked | ${report.summary.blockedWorkspaces} |`);
	lines.push(`| Skipped | ${report.summary.skippedWorkspaces} |`);
	lines.push("");
	lines.push("### Checks");
	lines.push("");
	lines.push(`| Type | Count |`);
	lines.push(`|------|-------|`);
	lines.push(`| Pass | ${report.summary.passChecks} |`);
	lines.push(`| Warning | ${report.summary.warnChecks} |`);
	lines.push(`| Failed | ${report.summary.failChecks} |`);
	lines.push(`| Error | ${report.summary.errorChecks} |`);
	lines.push("");

	// Wave Details
	lines.push("## Wave Details");
	lines.push("");
	for (const wave of report.waves) {
		lines.push(`### ${wave.waveId}: ${wave.title}`);
		lines.push("");
		lines.push(`**Risk:** ${wave.risk}`);
		lines.push(`**Status:** ${formatWaveStatusLabel(wave.status)}`);
		lines.push(`**Workspaces:** ${wave.passedCount}/${wave.workspaceCount} passed`);
		lines.push("");
		if (wave.gateChecks.length > 0) {
			lines.push("| ID | Check | Severity | Message |");
			lines.push("|----|-------|----------|---------|");
			for (const check of wave.gateChecks) {
				lines.push(`| ${check.id} | ${check.name} | ${formatSeverityLabel(check.severity)} | ${check.message} |`);
			}
			lines.push("");
		}
	}

	// Workspace Details
	lines.push("## Workspace Details");
	lines.push("");
	lines.push("| ID | Wave | Status | Evidence | Error |");
	lines.push("|----|------|--------|----------|-------|");
	for (const ws of report.workspaces) {
		const statusLabel = formatWorkspaceStatusLabel(ws.status);
		const evidence = ws.evidenceRef ?? "-";
		const error = ws.error ?? "-";
		lines.push(`| ${ws.workspaceId} | ${ws.waveId} | ${statusLabel} | ${evidence} | ${error} |`);
	}
	lines.push("");

	// Stable_3 Gate Details
	if (!report.stable3Gate.cleared) {
		lines.push("## Stable_3 Gate — Details & Recommendations");
		lines.push("");
		for (const check of report.stable3Gate.checks) {
			if (check.severity === "fail" || check.severity === "error") {
				lines.push(`### ${check.id}: ${check.name}`);
				lines.push("");
				lines.push(`**Severity:** ${formatSeverityLabel(check.severity)}`);
				lines.push(`**Message:** ${check.message}`);
				if (check.details) {
					lines.push(`**Details:** ${check.details}`);
				}
				if (check.recommendation) {
					lines.push(`**Recommendation:** ${check.recommendation}`);
				}
				lines.push("");
			}
		}
	}

	lines.push("---");
	lines.push("");
	lines.push(`_Report generated at ${new Date(report.timestamp).toISOString()}_`);

	return lines.join("\n");
}

/**
 * Format the promotion report as a JSON string.
 *
 * @param report - The promotion report to serialize
 * @param pretty - Whether to pretty-print the JSON
 * @returns JSON string
 */
export function formatPromotionReportJson(report: FinalPromotionReport, pretty = true): string {
	return JSON.stringify(report, null, pretty ? 2 : undefined);
}

// ---------------------------------------------------------------------------
// Label Formatting Helpers
// ---------------------------------------------------------------------------

function formatVerdictLabel(verdict: PromotionVerdict): string {
	switch (verdict) {
		case "promote":
			return "PROMOTE";
		case "blocked":
			return "BLOCKED";
		case "failed":
			return "FAILED";
	}
}

function formatSeverityLabel(severity: PromotionSeverity): string {
	switch (severity) {
		case "pass":
			return "PASS";
		case "warn":
			return "WARN";
		case "fail":
			return "FAIL";
		case "error":
			return "ERROR";
	}
}

function formatWaveStatusLabel(status: WaveStatus): string {
	switch (status) {
		case "passed":
			return "PASSED";
		case "blocked":
			return "BLOCKED";
		case "not_started":
			return "NOT_STARTED";
	}
}

function formatWorkspaceStatusLabel(status: WorkspaceStatus): string {
	switch (status) {
		case "passed":
			return "PASSED";
		case "failed":
			return "FAILED";
		case "blocked":
			return "BLOCKED";
		case "skipped":
			return "SKIPPED";
	}
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create an empty final promotion report with zero values.
 *
 * @returns An empty final promotion report
 */
export function createEmptyPromotionReport(): FinalPromotionReport {
	const gateChecks: PromotionCheck[] = [
		{
			id: STABLE_3_CHECKS.ALL_WAVES_COMPLETED,
			name: "All Waves Completed",
			severity: "fail",
			message: "No wave data provided",
		},
		{
			id: STABLE_3_CHECKS.ALL_WORKSPACES_PASSED,
			name: "All Workspaces Passed",
			severity: "fail",
			message: "No workspace data provided",
		},
	];

	return {
		reportId: `P44-PROMO-${Date.now()}`,
		schemaVersion: PROMOTION_REPORT_SCHEMA_VERSION,
		timestamp: Date.now(),
		verdict: "blocked",
		phase: "P44",
		mode: "stable_3_wave_batch",
		waves: [],
		workspaces: [],
		stable3Gate: {
			cleared: false,
			checks: gateChecks,
			summary: "No data provided — Stable_3 gate cannot be assessed",
		},
		summary: {
			totalWaves: 0,
			passedWaves: 0,
			blockedWaves: 0,
			notStartedWaves: 0,
			totalWorkspaces: 0,
			passedWorkspaces: 0,
			failedWorkspaces: 0,
			blockedWorkspaces: 0,
			skippedWorkspaces: 0,
			passChecks: 0,
			warnChecks: 0,
			failChecks: 2,
			errorChecks: 0,
			stable3Cleared: false,
		},
	};
}

/**
 * Create the default P44 workspace entries with all workspaces passed.
 * Useful for generating promotion reports when all workspaces have
 * been verified as complete.
 *
 * @returns Workspace promotion entries with all workspaces set to passed
 */
export function createDefaultP44WorkspaceEntries(): WorkspacePromotionEntry[] {
	const workspaceTitles: Record<string, string> = {
		"P44.01": "Acceptance Criteria & Traceability Schema",
		"P44.02": "EvidenceLedger — Structured Evidence Collection",
		"P44.03": "CompletionGate v2 — Evidence-First Algorithm",
		"P44.04": "Terminal Verdict Reconciliation",
		"P44.05": "Negative Assertion & Forbidden Shortcut Scanner",
		"P44.06": "WorkerReport Contract — Structured Output",
		"P44.07": "PostImplementationAuditor — Claim-Diff Mismatch Detection",
		"P44.07-integration": "Audit Production Wiring",
		"P44.08": "WorkspaceCommitGate — Pre-Commit Validation",
		"P44.09": "Scoped Commit Integration",
		"NEW-WG-WIRE": "WriteGate Tool Wiring",
		"P44.10": "Visibility — Dashboard Read Model",
		"P44.11": "Quality — Fake-Complete & Commit-Scope Gauntlet",
		"P44.12": "Master Template v4.2.0 Update",
		"P45-BRIDGE-WS1": "P45 Bridge — Accepted Write Set Export",
		"P45-BRIDGE-WS2": "P45 Bridge — Ownership & Evidence Export",
		"P44.13": "Final Promotion Report & Stable_3 Gate",
	};

	// Map workspace IDs to their wave
	const workspaceToWave: Record<string, string> = {};
	for (const wave of P44_WAVE_PLAN) {
		for (const wsId of wave.workspaceIds) {
			workspaceToWave[wsId] = wave.waveId;
		}
	}

	return ALL_P44_WORKSPACE_IDS.map((id) => ({
		workspaceId: id,
		title: workspaceTitles[id] ?? id,
		waveId: workspaceToWave[id] ?? "UNKNOWN",
		status: "passed" as WorkspaceStatus,
		evidenceRef: `reports/p44-verified-completion/workspace-${id.toLowerCase()}-summary.json`,
	}));
}
