/**
 * P44.13 — Final Promotion Report & Stable_3 Gate Tests
 *
 * Tests for:
 * - Stable_3 gate assessment
 * - FinalPromotionReportGenerator
 * - Report formatting (Markdown and JSON)
 * - Edge cases (empty data, partial completion, failures)
 */

import { describe, expect, it } from "vitest";
import {
	assessStable3Gate,
	createDefaultP44WorkspaceEntries,
	createEmptyPromotionReport,
	FinalPromotionReportGenerator,
	formatPromotionReport,
	formatPromotionReportJson,
	P44_WAVE_PLAN,
	STABLE_3_CHECKS,
	type WorkspacePromotionEntry,
} from "../../src/core/p44/final-promotion-report.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkspaceEntry(
	id: string,
	status: WorkspacePromotionEntry["status"] = "passed",
	overrides?: Partial<WorkspacePromotionEntry>,
): WorkspacePromotionEntry {
	const workspaceTitles: Record<string, string> = {
		"P44.01": "Acceptance Criteria & Traceability Schema",
		"P44.02": "EvidenceLedger -- Structured Evidence Collection",
		"P44.03": "CompletionGate v2 -- Evidence-First Algorithm",
		"P44.04": "Terminal Verdict Reconciliation",
		"P44.05": "Negative Assertion & Forbidden Shortcut Scanner",
		"P44.06": "WorkerReport Contract -- Structured Output",
		"P44.07": "PostImplementationAuditor -- Claim-Diff Mismatch Detection",
		"P44.07-integration": "Audit Production Wiring",
		"P44.08": "WorkspaceCommitGate -- Pre-Commit Validation",
		"P44.09": "Scoped Commit Integration",
		"NEW-WG-WIRE": "WriteGate Tool Wiring",
		"P44.10": "Visibility -- Dashboard Read Model",
		"P44.11": "Quality -- Fake-Complete & Commit-Scope Gauntlet",
		"P44.12": "Master Template v4.2.0 Update",
		"P45-BRIDGE-WS1": "P45 Bridge -- Accepted Write Set Export",
		"P45-BRIDGE-WS2": "P45 Bridge -- Ownership & Evidence Export",
		"P44.13": "Final Promotion Report & Stable_3 Gate",
	};

	const workspaceToWave: Record<string, string> = {};
	for (const wave of P44_WAVE_PLAN) {
		for (const wsId of wave.workspaceIds) {
			workspaceToWave[wsId] = wave.waveId;
		}
	}

	return {
		workspaceId: id,
		title: workspaceTitles[id] ?? id,
		waveId: workspaceToWave[id] ?? "UNKNOWN",
		status,
		evidenceRef: `reports/p44-verified-completion/workspace-${id.toLowerCase()}-summary.json`,
		...overrides,
	};
}

function makeAllPassedEntries(): WorkspacePromotionEntry[] {
	const allIds = [
		"P44.01",
		"P44.02",
		"P44.06",
		"P44.03",
		"P44.04",
		"P44.05",
		"P44.07",
		"P44.08",
		"P44.09",
		"NEW-WG-WIRE",
		"P44.07-integration",
		"P44.10",
		"P44.11",
		"P44.12",
		"P45-BRIDGE-WS1",
		"P45-BRIDGE-WS2",
		"P44.13",
	];
	return allIds.map((id) => makeWorkspaceEntry(id, "passed"));
}

const SKIP_FS = { skipFileExistenceChecks: true } as const;

function makeGenerator(opts?: Record<string, unknown>): FinalPromotionReportGenerator {
	return new FinalPromotionReportGenerator({ skipFileExistenceChecks: true, ...opts });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P44.13 — Final Promotion Report & Stable_3 Gate", () => {
	// -----------------------------------------------------------------------
	// assessStable3Gate
	// -----------------------------------------------------------------------
	describe("assessStable3Gate", () => {
		it("should clear gate when all waves and workspaces pass", () => {
			const entries = makeAllPassedEntries();
			const waves = makeGenerator().generate(entries).waves;
			const result = assessStable3Gate(waves, entries, SKIP_FS);

			expect(result.cleared).toBe(true);
			expect(result.checks.length).toBeGreaterThan(0);

			// All checks should pass or warn
			for (const check of result.checks) {
				expect(["pass", "warn"]).toContain(check.severity);
			}
		});

		it("should not clear gate when waves are not started", () => {
			const entries = makeAllPassedEntries();
			const waves = makeGenerator().generate(entries).waves;

			// Simulate some waves not started
			const modifiedWaves = waves.map((w) => (w.waveId === "W8" ? { ...w, status: "not_started" as const } : w));

			const result = assessStable3Gate(modifiedWaves, entries, SKIP_FS);
			expect(result.cleared).toBe(false);

			const allWavesCheck = result.checks.find((c) => c.id === STABLE_3_CHECKS.ALL_WAVES_COMPLETED);
			expect(allWavesCheck).toBeDefined();
			expect(allWavesCheck!.severity).toBe("fail");
		});

		it("should not clear gate when workspaces have failed", () => {
			const entries = makeAllPassedEntries();
			entries[0] = makeWorkspaceEntry("P44.01", "failed", { error: "Test failures detected" });

			const waves = makeGenerator().generate(entries).waves;
			const result = assessStable3Gate(waves, entries, SKIP_FS);

			expect(result.cleared).toBe(false);

			const noFailedCheck = result.checks.find((c) => c.id === STABLE_3_CHECKS.NO_FAILED_WORKSPACES);
			expect(noFailedCheck).toBeDefined();
			expect(noFailedCheck!.severity).toBe("fail");
		});

		it("should not clear gate when workspaces are blocked", () => {
			const entries = makeAllPassedEntries();
			entries[5] = makeWorkspaceEntry("P44.06", "blocked", {
				error: "Dependency on upstream workspace not complete",
			});

			const waves = makeGenerator().generate(entries).waves;
			const result = assessStable3Gate(waves, entries, SKIP_FS);

			expect(result.cleared).toBe(false);

			const noBlockedCheck = result.checks.find((c) => c.id === STABLE_3_CHECKS.NO_BLOCKED_WORKSPACES);
			expect(noBlockedCheck).toBeDefined();
			expect(noBlockedCheck!.severity).toBe("fail");
		});

		it("should handle empty wave list", () => {
			const result = assessStable3Gate([], [], SKIP_FS);
			expect(result.cleared).toBe(false);
			expect(result.checks.length).toBeGreaterThan(0);
		});

		it("should produce summary text for cleared gate", () => {
			const entries = makeAllPassedEntries();
			const waves = makeGenerator().generate(entries).waves;
			const result = assessStable3Gate(waves, entries, SKIP_FS);

			expect(result.summary).toContain("CLEARED");
		});

		it("should produce summary text for blocked gate", () => {
			const entries = makeAllPassedEntries();
			entries[0] = makeWorkspaceEntry("P44.01", "failed", { error: "Test failures" });

			const waves = makeGenerator().generate(entries).waves;
			const result = assessStable3Gate(waves, entries, SKIP_FS);

			expect(result.summary).toContain("BLOCKED");
		});
	});

	// -----------------------------------------------------------------------
	// FinalPromotionReportGenerator
	// -----------------------------------------------------------------------
	describe("FinalPromotionReportGenerator", () => {
		it("should generate a report with all waves and workspaces", () => {
			const entries = makeAllPassedEntries();
			const generator = makeGenerator({ projectRoot: process.cwd() });
			const report = generator.generate(entries);

			expect(report.phase).toBe("P44");
			expect(report.mode).toBe("stable_3_wave_batch");
			expect(report.waves).toHaveLength(8);
			expect(report.workspaces).toHaveLength(17);
			expect(report.verdict).toBe("promote");
		});

		it("should mark waves as blocked when workspaces fail", () => {
			const entries = makeAllPassedEntries();
			entries[0] = makeWorkspaceEntry("P44.01", "failed", { error: "Failed" });

			const report = makeGenerator().generate(entries);

			const w1 = report.waves.find((w) => w.waveId === "W1");
			expect(w1).toBeDefined();
			expect(w1!.status).toBe("blocked");
			expect(w1!.failedCount).toBe(1);
			expect(report.verdict).toBe("failed");
		});

		it("should compute summary statistics correctly", () => {
			const entries = makeAllPassedEntries();
			const report = makeGenerator().generate(entries);

			expect(report.summary.totalWaves).toBe(8);
			expect(report.summary.passedWaves).toBe(8);
			expect(report.summary.blockedWaves).toBe(0);
			expect(report.summary.notStartedWaves).toBe(0);
			expect(report.summary.totalWorkspaces).toBe(17);
			expect(report.summary.passedWorkspaces).toBe(17);
			expect(report.summary.failedWorkspaces).toBe(0);
			expect(report.summary.stable3Cleared).toBe(true);
		});

		it("should handle partially completed workspaces", () => {
			const entries = makeAllPassedEntries();
			entries[15] = makeWorkspaceEntry("P45-BRIDGE-WS2", "skipped");
			entries[16] = makeWorkspaceEntry("P44.13", "blocked");

			const report = makeGenerator().generate(entries);

			expect(report.summary.skippedWorkspaces).toBe(1);
			expect(report.summary.blockedWorkspaces).toBe(1);
			expect(report.summary.passedWorkspaces).toBe(15);
			expect(report.verdict).toBe("blocked");
		});

		it("should handle empty workspace entries", () => {
			const report = makeGenerator().generate([]);

			expect(report.workspaces).toHaveLength(0);
			expect(report.verdict).toBe("blocked");
			expect(report.stable3Gate.cleared).toBe(false);
		});

		it("should propagate custom options", () => {
			const report = makeGenerator({
				phase: "P45",
				mode: "stable_6",
				reportLabel: "Custom Report",
			}).generate([]);
			expect(report.phase).toBe("P45");
			expect(report.mode).toBe("stable_6");
		});
	});

	// -----------------------------------------------------------------------
	// formatPromotionReport (Markdown)
	// -----------------------------------------------------------------------
	describe("formatPromotionReport", () => {
		it("should produce valid Markdown output", () => {
			const report = makeGenerator().generate(makeAllPassedEntries());
			const md = formatPromotionReport(report);

			expect(md).toContain("# P44 Final Promotion Report");
			expect(md).toContain("## Stable_3 Gate");
			expect(md).toContain("## Summary");
			expect(md).toContain("## Wave Details");
			expect(md).toContain("## Workspace Details");
			expect(md).toContain("_Report generated at");
		});

		it("should include all waves in output", () => {
			const report = makeGenerator().generate(makeAllPassedEntries());
			const md = formatPromotionReport(report);

			for (const wave of P44_WAVE_PLAN) {
				expect(md).toContain(wave.waveId);
				expect(md).toContain(wave.title);
			}
		});

		it("should display all workspace entries in table", () => {
			const entries = makeAllPassedEntries();
			const report = makeGenerator().generate(entries);
			const md = formatPromotionReport(report);

			for (const ws of entries) {
				expect(md).toContain(ws.workspaceId);
			}
		});

		it("should include recommendations for failed checks", () => {
			const entries = makeAllPassedEntries();
			entries[0] = makeWorkspaceEntry("P44.01", "failed", { error: "Failed" });

			const report = makeGenerator().generate(entries);
			const md = formatPromotionReport(report);

			expect(md).toContain("STABLE3-CHECK");
			expect(md).toContain("Recommendation");
			expect(md).toContain("## Stable_3 Gate \u2014 Details & Recommendations");
		});
	});

	// -----------------------------------------------------------------------
	// formatPromotionReportJson
	// -----------------------------------------------------------------------
	describe("formatPromotionReportJson", () => {
		it("should produce valid JSON output", () => {
			const report = makeGenerator().generate(makeAllPassedEntries());
			const json = formatPromotionReportJson(report);

			const parsed = JSON.parse(json);
			expect(parsed.phase).toBe("P44");
			expect(parsed.verdict).toBe("promote");
			expect(parsed.waves).toHaveLength(8);
			expect(parsed.workspaces).toHaveLength(17);
			expect(parsed.stable3Gate.cleared).toBe(true);
			expect(parsed.schemaVersion).toBe("1.0.0");
		});

		it("should pretty-print by default", () => {
			const json = formatPromotionReportJson(createEmptyPromotionReport());
			expect(json).toContain("\n");
		});

		it("should support compact output", () => {
			const json = formatPromotionReportJson(createEmptyPromotionReport(), false);
			expect(json).not.toContain("\n  ");
		});
	});

	// -----------------------------------------------------------------------
	// createEmptyPromotionReport
	// -----------------------------------------------------------------------
	describe("createEmptyPromotionReport", () => {
		it("should create a report with blocked verdict", () => {
			const report = createEmptyPromotionReport();
			expect(report.verdict).toBe("blocked");
			expect(report.waves).toHaveLength(0);
			expect(report.workspaces).toHaveLength(0);
			expect(report.stable3Gate.cleared).toBe(false);
			expect(report.summary.totalWorkspaces).toBe(0);
		});

		it("should have report ID with expected prefix", () => {
			const report = createEmptyPromotionReport();
			expect(report.reportId).toMatch(/^P44-PROMO-/);
		});

		it("should have schema version set", () => {
			const report = createEmptyPromotionReport();
			expect(report.schemaVersion).toBe("1.0.0");
		});
	});

	// -----------------------------------------------------------------------
	// createDefaultP44WorkspaceEntries
	// -----------------------------------------------------------------------
	describe("createDefaultP44WorkspaceEntries", () => {
		it("should create entries for all 17 workspaces", () => {
			const entries = createDefaultP44WorkspaceEntries();
			expect(entries).toHaveLength(17);
		});

		it("should set all workspaces to passed", () => {
			const entries = createDefaultP44WorkspaceEntries();
			for (const entry of entries) {
				expect(entry.status).toBe("passed");
			}
		});

		it("should include all required workspace IDs", () => {
			const entries = createDefaultP44WorkspaceEntries();
			const ids = entries.map((e) => e.workspaceId);

			expect(ids).toContain("P44.01");
			expect(ids).toContain("P44.13");
			expect(ids).toContain("P45-BRIDGE-WS1");
			expect(ids).toContain("P45-BRIDGE-WS2");
			expect(ids).toContain("NEW-WG-WIRE");
		});
	});
});
