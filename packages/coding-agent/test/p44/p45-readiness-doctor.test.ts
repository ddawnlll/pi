/**
 * P45 Bridge — Readiness Doctor Tests
 *
 * Tests for the P45ReadinessDoctor class, including:
 * - Candidate discovery
 * - Workspace readiness assessment
 * - Report formatting
 * - Edge cases (empty candidates, missing config, overlap)
 */

import { describe, expect, it } from "vitest";
import {
	CHECKS,
	createEmptyP45ReadinessReport,
	formatP45ReadinessReport,
	P45ReadinessDoctor,
	type P45WorkspaceCandidate,
} from "../../src/core/p44/p45-bridge/readiness-doctor.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCandidate(id: string, title: string, overrides?: Partial<P45WorkspaceCandidate>): P45WorkspaceCandidate {
	return {
		id,
		title,
		p45Bridge: { implementationAllowed: false, allowedFiles: ["src/main.ts"], forbiddenPaths: ["node_modules/**"] },
		allowedFiles: ["src/main.ts"],
		forbiddenFiles: ["node_modules/**"],
		writeSet: [],
		readSet: ["src/main.ts"],
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P45ReadinessDoctor", () => {
	describe("discoverCandidates", () => {
		it("should return workspaces with p45Bridge configured", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Has Bridge"),
				makeCandidate("WS-002", "No Bridge", { p45Bridge: undefined }),
				makeCandidate("WS-003", "Also Has Bridge"),
			];

			const candidates = doctor.discoverCandidates(workspaces);
			expect(candidates).toHaveLength(2);
			expect(candidates.map((c) => c.id)).toEqual(["WS-001", "WS-003"]);
		});

		it("should return empty array when no candidates exist", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "No Bridge", { p45Bridge: undefined }),
				makeCandidate("WS-002", "Also No Bridge", { p45Bridge: undefined }),
			];

			const candidates = doctor.discoverCandidates(workspaces);
			expect(candidates).toHaveLength(0);
		});
	});

	describe("assess (single workspace)", () => {
		it("should mark workspace as ready when all checks pass", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [makeCandidate("WS-001", "Ready Workspace")];

			const report = doctor.assess(workspaces);
			expect(report.overallVerdict).toBe("ready");
			expect(report.workspaces).toHaveLength(1);
			expect(report.workspaces[0].verdict).toBe("ready");
		});

		it("should mark workspace as not_ready when implementationAllowed is not false", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Bad Bridge", {
					p45Bridge: { implementationAllowed: true, allowedFiles: ["src/main.ts"] },
				}),
			];

			const report = doctor.assess(workspaces);
			expect(report.overallVerdict).toBe("not_ready");
			expect(report.workspaces[0].verdict).toBe("not_ready");

			const implCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.IMPLEMENTATION_DISABLED);
			expect(implCheck).toBeDefined();
			expect(implCheck!.severity).toBe("fail");
		});

		it("should mark workspace as not_ready when allowed files are empty", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "No Allowed Files", {
					p45Bridge: { implementationAllowed: false },
					allowedFiles: [],
				}),
			];

			const report = doctor.assess(workspaces);
			expect(report.overallVerdict).toBe("not_ready");
			expect(report.workspaces[0].verdict).toBe("not_ready");

			const allowedCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.ALLOWED_FILES_SPECIFIED);
			expect(allowedCheck).toBeDefined();
			expect(allowedCheck!.severity).toBe("fail");
		});

		it("should warn when forbidden paths are not specified", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "No Forbidden Paths", {
					p45Bridge: { implementationAllowed: false, allowedFiles: ["src/main.ts"] },
					forbiddenFiles: [],
				}),
			];

			const report = doctor.assess(workspaces);
			const forbiddenCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.FORBIDDEN_PATHS_SPECIFIED);
			expect(forbiddenCheck).toBeDefined();
			expect(forbiddenCheck!.severity).toBe("warn");
		});

		it("should fail when allowed files overlap with forbidden paths", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Overlapping Paths", {
					p45Bridge: {
						implementationAllowed: false,
						allowedFiles: ["src/main.ts", "node_modules/pkg/index.ts"],
						forbiddenPaths: ["node_modules/**"],
					},
					allowedFiles: ["src/main.ts", "node_modules/pkg/index.ts"],
					forbiddenFiles: ["node_modules/**"],
				}),
			];

			const report = doctor.assess(workspaces);
			expect(report.workspaces[0].verdict).toBe("not_ready");

			const overlapCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.ALLOWED_FORBIDDEN_NO_OVERLAP);
			expect(overlapCheck).toBeDefined();
			expect(overlapCheck!.severity).toBe("fail");
			expect(overlapCheck!.details).toContain("node_modules/pkg/index.ts");
		});

		it("should warn when workspace has writeSet defined", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Has Write Set", {
					writeSet: ["src/output.ts"],
				}),
			];

			const report = doctor.assess(workspaces);
			const writeCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.WRITE_SCOPE_RESTRICTED);
			expect(writeCheck).toBeDefined();
			expect(writeCheck!.severity).toBe("warn");
		});

		it("should pass write scope check when writeSet is empty", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "No Write Set", {
					writeSet: [],
				}),
			];

			const report = doctor.assess(workspaces);
			const writeCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.WRITE_SCOPE_RESTRICTED);
			expect(writeCheck).toBeDefined();
			expect(writeCheck!.severity).toBe("pass");
		});

		it("should mark workspace as not_applicable when p45Bridge is not configured", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [makeCandidate("WS-001", "Not a Candidate", { p45Bridge: undefined })];

			const report = doctor.assess(workspaces);
			expect(report.overallVerdict).toBe("no_candidates");
			expect(report.workspaces[0].verdict).toBe("not_applicable");
		});
	});

	describe("assess (multi-workspace)", () => {
		it("should produce mixed verdicts for mixed workspaces", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Ready", {
					p45Bridge: {
						implementationAllowed: false,
						allowedFiles: ["src/main.ts"],
						forbiddenPaths: ["node_modules/**"],
					},
					writeSet: [],
				}),
				makeCandidate("WS-002", "Not Ready", {
					p45Bridge: { implementationAllowed: false, allowedFiles: [] },
					allowedFiles: [],
				}),
				makeCandidate("WS-003", "Not a Candidate", { p45Bridge: undefined }),
			];

			const report = doctor.assess(workspaces);

			expect(report.overallVerdict).toBe("not_ready");
			expect(report.summary.totalWorkspaces).toBe(3);
			expect(report.summary.candidatesFound).toBe(2);
			expect(report.summary.readyCount).toBe(1);
			expect(report.summary.notReadyCount).toBe(1);
			expect(report.summary.notApplicableCount).toBe(1);
		});
	});

	describe("report summary counts", () => {
		it("should correctly count pass/warn/fail/error checks", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });

			// WS-001: ready — all pass
			// WS-002: not ready — some fail
			const workspaces = [
				makeCandidate("WS-001", "All Good"),
				makeCandidate("WS-002", "Bad Bridge", {
					p45Bridge: { implementationAllowed: true, allowedFiles: [] },
					allowedFiles: [],
				}),
			];

			const report = doctor.assess(workspaces);
			expect(report.summary.passChecks).toBeGreaterThanOrEqual(1);
			expect(report.summary.failChecks).toBeGreaterThanOrEqual(1);
			expect(report.summary.errorChecks).toBe(0);
		});
	});

	describe("formatP45ReadinessReport", () => {
		it("should format a report as markdown", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [makeCandidate("WS-001", "Test Workspace")];

			const report = doctor.assess(workspaces);
			const formatted = formatP45ReadinessReport(report);

			expect(formatted).toContain("# P45 Bridge Readiness Report");
			expect(formatted).toContain("WS-001");
			expect(formatted).toContain("Test Workspace");
			expect(formatted).toContain("Summary");
			expect(formatted).toContain(report.reportId);
		});

		it("should show PASS/FAIL labels for checks", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Test", {
					p45Bridge: { implementationAllowed: true, allowedFiles: [] },
					allowedFiles: [],
				}),
			];

			const report = doctor.assess(workspaces);
			const formatted = formatP45ReadinessReport(report);

			expect(formatted).toContain("FAIL");
			expect(formatted).toContain("NOT_READY");
		});

		it("should include details and recommendations for failing checks", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [
				makeCandidate("WS-001", "Test", {
					p45Bridge: { implementationAllowed: true, allowedFiles: [] },
					allowedFiles: [],
				}),
			];

			const report = doctor.assess(workspaces);
			const formatted = formatP45ReadinessReport(report);

			expect(formatted).toContain("Details & Recommendations");
			expect(formatted).toContain("Recommendation");
		});
	});

	describe("createEmptyP45ReadinessReport", () => {
		it("should create an empty report with no_candidates verdict", () => {
			const report = createEmptyP45ReadinessReport();
			expect(report.overallVerdict).toBe("no_candidates");
			expect(report.workspaces).toHaveLength(0);
			expect(report.summary.totalWorkspaces).toBe(0);
		});
	});

	describe("file existence checks", () => {
		it("should pass when skipFileExistenceChecks is true", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: true });
			const workspaces = [makeCandidate("WS-001", "Skipped")];

			const report = doctor.assess(workspaces);
			const fileCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.ALLOWED_FILES_EXIST);
			expect(fileCheck).toBeDefined();
			expect(fileCheck!.severity).toBe("pass");
			expect(fileCheck!.message).toContain("skipped");
		});

		it("should check file existence on disk when not skipped", () => {
			const doctor = new P45ReadinessDoctor({ skipFileExistenceChecks: false, projectRoot: "/tmp" });
			const workspaces = [
				makeCandidate("WS-001", "Missing Files", {
					p45Bridge: { implementationAllowed: false, allowedFiles: ["nonexistent-file.ts"], forbiddenPaths: [] },
					allowedFiles: ["nonexistent-file.ts"],
				}),
			];

			const report = doctor.assess(workspaces);
			const fileCheck = report.workspaces[0].checks.find((c) => c.id === CHECKS.ALLOWED_FILES_EXIST);
			expect(fileCheck).toBeDefined();
			expect(fileCheck!.severity).toBe("fail");
			expect(fileCheck!.details).toContain("nonexistent-file.ts");
		});
	});
});
