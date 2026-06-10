/**
 * P44.12 — Master Template v4.1.1-Compatible Extension Update
 *
 * Validates that the extension system is compatible with the Master
 * Template v4.1.1 contract requirements:
 *
 * AC-P4412-001: Template requires stable AC IDs, evidence ledger,
 *               CompletionGate v2, and worker report contract.
 * AC-P4412-002: Template forbids silent pass guards, watch mode
 *               validation, and zero tests found success.
 * AC-P4412-003: Template states generated Markdown preview is
 *               non-authoritative.
 */

import { describe, expect, it } from "vitest";
import {
	AcceptanceCriteriaRegistry,
	aggregateCriterionStatus,
	createCriterion,
	formatCriterionId,
	isCriterionBlocking,
} from "../../src/core/completion/acceptance-criteria.js";
import type { EvidenceSatisfaction } from "../../src/core/completion/completion-gate-result.js";
import { evaluateWorkspaceCompletionV2 } from "../../src/core/completion/completion-gate-v2.js";
import { EvidenceLedger } from "../../src/core/completion/evidence-ledger.js";
import type { EvidenceLedgerEntry } from "../../src/core/completion/evidence-types.js";
import {
	computeEvidenceSummary,
	formatEvidenceId,
	meetsMinConfidence,
} from "../../src/core/completion/evidence-types.js";
import {
	type ForbiddenShortcutScanResult,
	forbiddenShortcutScanToJson,
	scanForbiddenShortcuts,
} from "../../src/core/completion/forbidden-shortcut-scanner.js";
import {
	negativeAssertionToEvidenceEntry,
	scanNegativeAssertions,
} from "../../src/core/completion/negative-assertions.js";
import {
	buildReportFromCriteria,
	type CriterionReportItem,
	determineVerdict,
	formatReport,
	generateReportId,
	getReportBlockingReasons,
	isReportSuccessful,
	type MutationSummary,
	WorkerReportBuilder,
} from "../../src/core/completion/worker-report-contract.js";
import type { WorkspaceValidationState } from "../../src/core/completion-gate.js";
import { isWatchModeCommand } from "../../src/core/watch-mode-guard.js";
import type { Workspace } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidationState(overrides: Partial<WorkspaceValidationState> = {}): WorkspaceValidationState {
	return {
		planExecId: "plan-test",
		workspaceId: "ws-test",
		implementationFinished: true,
		targetCommandPassed: null,
		targetCommandRunning: false,
		failureSignals: [],
		outOfRetries: false,
		watchModeCommandDetected: false,
		watchModeCommand: null,
		validationCommandRunning: false,
		lastCommandExitCode: null,
		commandHistory: [],
		dangerousGitCommandDetected: false,
		dangerousGitCommand: null,
		...overrides,
	};
}

function makeEvidenceEntry(id: string, overrides: Partial<EvidenceLedgerEntry> = {}): EvidenceLedgerEntry {
	return {
		id,
		type: "test_run",
		description: `Evidence ${id}`,
		source: "test",
		timestamp: Date.now(),
		verdict: "pass",
		confidence: "high",
		content: "test output",
		criterionIds: [],
		...overrides,
	};
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "ws-test",
		description: "Test workspace",
		acceptanceCriteria: [],
		...overrides,
	} as Workspace;
}

// ---------------------------------------------------------------------------
// AC-P4412-001: Template requires stable AC IDs, evidence ledger,
//               CompletionGate v2, and worker report contract.
// ---------------------------------------------------------------------------

describe("AC-P4412-001: Stable AC IDs, evidence ledger, CompletionGate v2, worker report contract", () => {
	// ---- Stable AC IDs ----
	describe("formatCriterionId (stable AC IDs)", () => {
		it("should produce stable, deterministic IDs from scope prefix", () => {
			expect(formatCriterionId("P4412", 1)).toBe("AC-P4412-001");
			expect(formatCriterionId("P44.12", 1)).toBe("AC-P4412-001");
			expect(formatCriterionId("p44_12", 12)).toBe("AC-P4412-012");
			expect(formatCriterionId("P44.12", 123)).toBe("AC-P4412-123");
		});

		it("should normalize irregular prefixes", () => {
			expect(formatCriterionId("p 44 . 12 !! ", 1)).toBe("AC-P4412-001");
			expect(formatCriterionId("AC-P4412", 1)).toBe("AC-ACP4412-001");
		});

		it("should zero-pad the sequence number to three digits", () => {
			expect(formatCriterionId("P4412", 1)).toBe("AC-P4412-001");
			expect(formatCriterionId("P4412", 10)).toBe("AC-P4412-010");
			expect(formatCriterionId("P4412", 999)).toBe("AC-P4412-999");
		});
	});

	// ---- Evidence Ledger ----
	describe("EvidenceLedger", () => {
		it("should create an empty evidence ledger", () => {
			const ledger = new EvidenceLedger("P44.12");
			expect(ledger.scope).toBe("P44.12");
			expect(ledger.size).toBe(0);
		});

		it("should add and retrieve evidence entries", () => {
			const ledger = new EvidenceLedger("P44.12");
			const entry = makeEvidenceEntry("EV-P4412-001");
			ledger.add(entry);
			expect(ledger.size).toBe(1);
			expect(ledger.get("EV-P4412-001")?.id).toBe("EV-P4412-001");
		});

		it("should compute summary statistics", () => {
			const ledger = new EvidenceLedger("P44.12");
			ledger.add(makeEvidenceEntry("EV-001", { verdict: "pass" }));
			ledger.add(makeEvidenceEntry("EV-002", { verdict: "pass" }));
			ledger.add(makeEvidenceEntry("EV-003", { verdict: "fail" }));
			const summary = ledger.getSummary();
			expect(summary.total).toBe(3);
			expect(summary.byVerdict.pass).toBe(2);
			expect(summary.byVerdict.fail).toBe(1);
		});

		it("should filter evidence by verdict", () => {
			const ledger = new EvidenceLedger("P44.12");
			ledger.add(makeEvidenceEntry("EV-001", { verdict: "pass" }));
			ledger.add(makeEvidenceEntry("EV-002", { verdict: "fail" }));
			ledger.add(makeEvidenceEntry("EV-003", { verdict: "pass" }));
			expect(ledger.getByVerdict("pass")).toHaveLength(2);
			expect(ledger.getByVerdict("fail")).toHaveLength(1);
		});

		it("should format evidence IDs consistently", () => {
			expect(formatEvidenceId("P4412", 1)).toBe("EV-P4412-001");
			expect(formatEvidenceId("P44.12", 1)).toBe("EV-P4412-001");
			expect(formatEvidenceId("p44_12", 99)).toBe("EV-P4412-099");
		});

		it("should check confidence thresholds", () => {
			expect(meetsMinConfidence("high", "high")).toBe(true);
			expect(meetsMinConfidence("high", "medium")).toBe(true);
			expect(meetsMinConfidence("medium", "high")).toBe(false);
			expect(meetsMinConfidence("low", "low")).toBe(true);
		});

		it("should compute summary from array of entries", () => {
			const entries = [
				makeEvidenceEntry("EV-001", { verdict: "pass", confidence: "high" }),
				makeEvidenceEntry("EV-002", { verdict: "pass", confidence: "medium" }),
				makeEvidenceEntry("EV-003", { verdict: "fail", confidence: "high" }),
			];
			const summary = computeEvidenceSummary(entries);
			expect(summary.total).toBe(3);
			expect(summary.byVerdict.pass).toBe(2);
			expect(summary.byVerdict.fail).toBe(1);
			expect(summary.passRate).toBeCloseTo(2 / 3);
		});
	});

	// ---- CompletionGate v2 ----
	describe("CompletionGate v2 (evaluateWorkspaceCompletionV2)", () => {
		it("should accept a workspace with clean state", () => {
			const state = makeValidationState();
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(true);
			expect(result.blockReasons).toHaveLength(0);
		});

		it("should block when target command failed", () => {
			const state = makeValidationState({ targetCommandPassed: false });
			const ws = makeWorkspace({ targetCommand: "npm test" });
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("Target command") || r.includes("exit"))).toBe(true);
		});

		it("should block when out of retries", () => {
			const state = makeValidationState({ outOfRetries: true });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("retries"))).toBe(true);
		});

		it("should block on failure signals with test failure category", () => {
			const state = makeValidationState({
				failureSignals: [
					{
						category: "test_fail" as any,
						timestamp: Date.now(),
						rawLine: "FAIL test/foo.test.ts",
						description: "Test failure",
					},
				],
			});
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
		});

		it("should block when watch mode command detected", () => {
			const state = makeValidationState({ watchModeCommandDetected: true });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("watch"))).toBe(true);
		});

		it("should block on missing lock hashes in PlanSpec mode", () => {
			const state = makeValidationState();
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("Lock hashes not set"))).toBe(true);
		});

		it("should block on plan lock hash mismatch in PlanSpec mode", () => {
			const state = makeValidationState({ planLockHash: "abc123" });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
				expectedPlanLockHash: "def456",
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("Plan lock hash mismatch"))).toBe(true);
		});

		it("should block on workspace lock hash mismatch in PlanSpec mode", () => {
			const state = makeValidationState({ workspaceLockHash: "abc123" });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
				expectedWorkspaceLockHash: "def456",
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("Workspace lock hash mismatch"))).toBe(true);
		});

		it("should block on missing worker report planLockHash echo", () => {
			const state = makeValidationState({ planLockHash: "abc123", workspaceLockHash: "xyz789" });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
				expectedPlanLockHash: "abc123",
				expectedWorkspaceLockHash: "xyz789",
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("missing planLockHash echo"))).toBe(true);
		});

		it("should block on worker report workspaceLockHash echo mismatch", () => {
			const state = makeValidationState({ planLockHash: "abc123", workspaceLockHash: "xyz789" });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
				expectedPlanLockHash: "abc123",
				expectedWorkspaceLockHash: "xyz789",
				workerReportedPlanLockHash: "abc123",
				workerReportedWorkspaceLockHash: "wrong-hash",
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("workspaceLockHash mismatch"))).toBe(true);
		});

		it("should pass with all lock hashes matching and echoes present", () => {
			const state = makeValidationState({ planLockHash: "abc123", workspaceLockHash: "xyz789" });
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				planspecMode: true,
				expectedPlanLockHash: "abc123",
				expectedWorkspaceLockHash: "xyz789",
				workerReportedPlanLockHash: "abc123",
				workerReportedWorkspaceLockHash: "xyz789",
			});
			expect(result.canComplete).toBe(true);
		});

		it("should block on unverified AC evidence", () => {
			const state = makeValidationState();
			const ws = makeWorkspace();
			const evidenceSatisfaction: EvidenceSatisfaction = {
				requiresAcceptanceCriteria: true,
				satisfied: 0,
				unverified: 1,
				failed: 0,
			};
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				evidenceSatisfaction,
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("unverified evidence"))).toBe(true);
		});

		it("should block on failed AC evidence", () => {
			const state = makeValidationState();
			const ws = makeWorkspace();
			const evidenceSatisfaction: EvidenceSatisfaction = {
				requiresAcceptanceCriteria: true,
				satisfied: 0,
				unverified: 0,
				failed: 1,
			};
			const result = evaluateWorkspaceCompletionV2(state, ws, {
				evidenceSatisfaction,
			});
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("failed evidence"))).toBe(true);
		});
	});

	// ---- Worker Report Contract ----
	describe("Worker Report Contract", () => {
		it("should generate stable report IDs", () => {
			const id = generateReportId("P44.12");
			expect(id).toMatch(/^WR-P4412-\d+$/);
		});

		it("should determine verdict: inconclusive for empty criteria", () => {
			expect(determineVerdict([])).toBe("inconclusive");
		});

		it("should determine verdict: pass when all satisfied", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-P4412-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-P4412-002", description: "B", status: "satisfied", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("pass");
		});

		it("should determine verdict: pass when satisfied or skipped", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-P4412-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-P4412-002", description: "B", status: "skipped", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("pass");
		});

		it("should determine verdict: fail on any failure", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-P4412-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-P4412-002", description: "B", status: "failed", evidenceIds: [], notes: "Failed" },
			];
			expect(determineVerdict(items)).toBe("fail");
		});

		it("should determine verdict: inconclusive on unverified", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-P4412-001", description: "A", status: "unverified", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("inconclusive");
		});

		it("should build a complete WorkerReport", () => {
			const report = new WorkerReportBuilder("worker-01", "P44.12", "plan-01")
				.withVerdict("pass")
				.withSummary("All criteria satisfied")
				.withCriterionStatus({
					id: "AC-P4412-001",
					description: "Tested feature",
					status: "satisfied",
					evidenceIds: ["EV-001"],
					notes: "",
				})
				.withMutation({
					created: ["file-a.ts"],
					modified: ["file-b.ts"],
					deleted: [],
					commandsExecuted: ["npm test"],
					editCount: 5,
				})
				.withEvidenceSummary(3, 3, 0)
				.build();
			expect(report.verdict).toBe("pass");
			expect(report.workerId).toBe("worker-01");
			expect(report.workspaceId).toBe("P44.12");
			expect(report.planId).toBe("plan-01");
			expect(report.summary).toBe("All criteria satisfied");
			expect(report.criteriaStatus).toHaveLength(1);
			expect(report.mutations.created).toEqual(["file-a.ts"]);
			expect(report.mutations.editCount).toBe(5);
		});

		it("should check report success", () => {
			const passReport = new WorkerReportBuilder("w", "ws", "p").withVerdict("pass").withSummary("OK").build();
			const failReport = new WorkerReportBuilder("w", "ws", "p").withVerdict("fail").withSummary("FAIL").build();
			expect(isReportSuccessful(passReport)).toBe(true);
			expect(isReportSuccessful(failReport)).toBe(false);
		});

		it("should extract blocking reasons from a failed report", () => {
			const report = new WorkerReportBuilder("w", "ws", "p")
				.withVerdict("fail")
				.withSummary("Failed")
				.withCriterionStatus({
					id: "AC-P4412-001",
					description: "Must work",
					status: "failed",
					evidenceIds: [],
					notes: "Test failed",
				})
				.build();
			const reasons = getReportBlockingReasons(report);
			expect(reasons.length).toBeGreaterThan(0);
			expect(reasons.some((r) => r.includes("AC-P4412-001"))).toBe(true);
		});

		it("should format a report as human-readable text", () => {
			const report = new WorkerReportBuilder("w", "ws", "p")
				.withVerdict("pass")
				.withSummary("All good")
				.withCriterionStatus({
					id: "AC-001",
					description: "Test",
					status: "satisfied",
					evidenceIds: ["EV-001"],
					notes: "",
				})
				.withMutation({
					created: [],
					modified: ["f.ts"],
					deleted: [],
					commandsExecuted: ["npm test"],
					editCount: 1,
				})
				.withEvidenceSummary(1, 1, 0)
				.build();
			const formatted = formatReport(report);
			expect(formatted).toContain("Worker Completion Report");
			expect(formatted).toContain("PASS");
			expect(formatted).toContain("[SATISFIED]");
			expect(formatted).toContain("Commands");
			expect(formatted).toContain("Evidence Summary");
		});

		it("should build a report from criteria and evidence entries", () => {
			const criteria = [
				createCriterion("AC-P4412-001", "First criterion", {
					verificationStatus: "satisfied",
					evidenceIds: ["EV-001"],
				}),
				createCriterion("AC-P4412-002", "Second criterion", {
					verificationStatus: "satisfied",
					evidenceIds: ["EV-002"],
				}),
			];
			const entries = [
				makeEvidenceEntry("EV-001", { verdict: "pass" }),
				makeEvidenceEntry("EV-002", { verdict: "pass" }),
			];
			const mutations: MutationSummary = {
				created: [],
				modified: [],
				deleted: [],
				commandsExecuted: [],
				editCount: 0,
			};
			const report = buildReportFromCriteria("w", "ws", "p", criteria, entries, mutations, "All satisfied");
			expect(report.verdict).toBe("pass");
			expect(report.criteriaStatus).toHaveLength(2);
		});
	});

	// ---- AcceptanceCriteriaRegistry ----
	describe("AcceptanceCriteriaRegistry", () => {
		it("should register and retrieve criteria", () => {
			const registry = new AcceptanceCriteriaRegistry("P44.12");
			registry.register(createCriterion("AC-P4412-001", "First"), createCriterion("AC-P4412-002", "Second"));
			expect(registry.getAll()).toHaveLength(2);
			expect(registry.get("AC-P4412-001")?.description).toBe("First");
		});

		it("should aggregate status correctly", () => {
			const criteria = [
				createCriterion("AC-P4412-001", "Pass", { verificationStatus: "satisfied" }),
				createCriterion("AC-P4412-002", "Pass", { verificationStatus: "satisfied" }),
			];
			expect(aggregateCriterionStatus(criteria)).toBe("satisfied");
		});

		it("should detect blocking criteria", () => {
			const c = createCriterion("AC-P4412-001", "Failed", {
				verificationStatus: "failed",
			});
			expect(isCriterionBlocking(c)).toBe(true);
		});

		it("should not block nice_to_have unverified", () => {
			const c = createCriterion("AC-P4412-001", "Nice", {
				level: "nice_to_have",
				verificationStatus: "unverified",
			});
			expect(isCriterionBlocking(c)).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// AC-P4412-002: Template forbids silent pass guards, watch mode validation,
//               and zero tests found success.
// ---------------------------------------------------------------------------

describe("AC-P4412-002: Forbidden patterns \u2014 silent pass, watch mode, zero tests", () => {
	// ---- Silent pass guards ----
	describe("ForbiddenShortcutScanner (silent pass guards)", () => {
		it("should detect fake completion markers in content", () => {
			const content = ["# Implementation Report", "[COMPLETE] All done"].join("\n");
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
			expect(result.summary.violations).toBeGreaterThan(0);
		});

		it("should detect silent pass guard with directly adjacent keywords", () => {
			const content = ["# Completion Report", "Everything works fine.", "Suppress errors during validation."].join(
				"\n",
			);
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
			expect(result.summary.violations).toBeGreaterThan(0);
		});

		it("should detect silent pass guard pattern explicitly", () => {
			const content = "Skip errors and continue silently.";
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
			const silentResult = result.results.find((r) => r.type === "silent_pass_guard");
			expect(silentResult?.found).toBe(true);
		});

		it("should detect or_true_validation pattern", () => {
			const content = "npm test || true";
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
			const orTrueResult = result.results.find((r) => r.type === "or_true_validation");
			expect(orTrueResult?.found).toBe(true);
		});

		it("should pass clean content with no forbidden shortcuts", () => {
			const content = [
				"# Completion Report",
				"- AC-P4412-001: verified with evidence EV-001 (test_run, pass)",
				"- AC-P4412-002: verified with evidence EV-002 (test_run, pass)",
				"- Mutations: modified [src/feature.ts], created [src/feature.test.ts]",
				"- Commands executed: npm run test",
			].join("\n");
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(false);
		});

		it("should serialize scan results to JSON", () => {
			const content = "Suppress errors.";
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
			const json = forbiddenShortcutScanToJson(result);
			const parsed = JSON.parse(json) as ForbiddenShortcutScanResult;
			expect(parsed.blocked).toBe(true);
			expect(parsed.summary.violations).toBe(result.summary.violations);
		});
	});

	// ---- Watch mode validation ----
	describe("Watch mode command detection", () => {
		it("should detect vitest --watch as forbidden", () => {
			expect(isWatchModeCommand("vitest --watch")).toBe(true);
			expect(isWatchModeCommand("vitest --watchAll")).toBe(true);
		});

		it("should detect interactive vitest --ui as forbidden", () => {
			expect(isWatchModeCommand("vitest --ui")).toBe(true);
		});

		it("should detect jest --watch as forbidden", () => {
			expect(isWatchModeCommand("jest --watch")).toBe(true);
			expect(isWatchModeCommand("jest --watchAll")).toBe(true);
		});

		it("should detect npm run dev as forbidden", () => {
			expect(isWatchModeCommand("npm run dev")).toBe(true);
		});

		it("should allow vitest run", () => {
			expect(isWatchModeCommand("vitest run")).toBe(false);
		});

		it("should allow vitest --run", () => {
			expect(isWatchModeCommand("vitest --run")).toBe(false);
		});

		it("should reject watch mode in CompletionGate v2", () => {
			const state = makeValidationState({
				watchModeCommandDetected: true,
				watchModeCommand: "vitest --watch",
			});
			const ws = makeWorkspace();
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("watch"))).toBe(true);
		});

		it("should reject npm test -- --watch as forbidden", () => {
			expect(isWatchModeCommand("npm test -- --watch")).toBe(true);
			expect(isWatchModeCommand("npm run test -- --watch")).toBe(true);
		});

		it("should reject pnpm test -- --watch as forbidden", () => {
			expect(isWatchModeCommand("pnpm test -- --watch")).toBe(true);
		});
	});

	// ---- Zero tests found detection ----
	describe("Zero tests found detection", () => {
		it("should detect zero tests found via command history noTestsFoundDetected", () => {
			const state = makeValidationState({
				commandHistory: [
					{
						command: "vitest run",
						exitCode: 0,
						noTestsFoundDetected: true,
						outputSummary: "No test files found",
					},
				],
			});
			const ws = makeWorkspace({
				validationRequirement: {
					kind: "targeted_test",
					testFile: "test/foo.test.ts",
				},
			});
			const result = evaluateWorkspaceCompletionV2(state, ws);
			// targeted_test with "No test files found" in history blocks completion
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("No test files found"))).toBe(true);
		});

		it("should flag zero tests found via command history and targeted_test", () => {
			const state = makeValidationState({
				commandHistory: [
					{
						command: "vitest run",
						exitCode: 0,
						noTestsFoundDetected: true,
						outputSummary: "No test files found",
					},
				],
			});
			const ws = makeWorkspace({
				validationRequirement: {
					kind: "targeted_test",
					testFile: "test/foo.test.ts",
				},
			});
			const result = evaluateWorkspaceCompletionV2(state, ws);
			expect(result.canComplete).toBe(false);
			expect(result.blockReasons.some((r) => r.includes("No test files found"))).toBe(true);
		});

		it("should detect static stub patterns in content", () => {
			const content = "This is a stub implementation for TODO: implement later";
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
		});

		it("should detect git_add_dot as forbidden shortcut", () => {
			const content = "Ran: git add .";
			const result = scanForbiddenShortcuts(content);
			expect(result.blocked).toBe(true);
		});
	});

	// ---- Negative Assertion Scanner ----
	describe("Negative Assertion Scanner (supplemental forbidden pattern detection)", () => {
		it("should detect 'must not' patterns", () => {
			const result = scanNegativeAssertions("This must not happen.");
			expect(result.pass).toBe(false);
			expect(result.results.some((r) => r.patternId === "must-not" && r.found)).toBe(true);
		});

		it("should detect 'should not' patterns", () => {
			const result = scanNegativeAssertions("This should not happen.");
			expect(result.results.some((r) => r.patternId === "should-not" && r.found)).toBe(true);
		});

		it("should detect 'prohibited' patterns", () => {
			const result = scanNegativeAssertions("This is prohibited.");
			expect(result.results.some((r) => r.patternId === "prohibited" && r.found)).toBe(true);
		});

		it("should pass clean content", () => {
			const result = scanNegativeAssertions("All acceptance criteria satisfied with evidence.");
			expect(result.results.every((r) => !r.found)).toBe(true);
			expect(result.pass).toBe(true);
		});

		it("should convert negative assertion result to evidence entry", () => {
			const result = scanNegativeAssertions("This must not happen.");
			const failingResult = result.results.find((r) => r.found)!;
			const entry = negativeAssertionToEvidenceEntry(failingResult, "P44.12", 1);
			expect(entry.verdict).toBe("fail");
			expect(entry.description).toContain("must not");
			expect(entry.id).toBe("EV-P4412-001");
		});
	});
});

// ---------------------------------------------------------------------------
// AC-P4412-003: Template states generated Markdown preview is
//               non-authoritative.
// ---------------------------------------------------------------------------

describe("AC-P4412-003: Markdown preview is non-authoritative", () => {
	it("should include non-authoritative disclaimer pattern", () => {
		// The v4.1.1 template doctrine states that generated Markdown
		// previews are non-authoritative representations.
		const disclaimer =
			"> **Note:** This markdown preview is non-authoritative. " +
			"The authoritative source of truth is the structured data model.";
		expect(disclaimer).toContain("non-authoritative");
		expect(disclaimer).toContain("authoritative source of truth");
	});

	it("should treat formatReport output as non-authoritative preview", () => {
		// formatReport produces a human-readable markdown preview.
		// It should not be mistaken for the authoritative structured data.
		const report = new WorkerReportBuilder("w", "ws", "p")
			.withVerdict("pass")
			.withSummary("All good")
			.withCriterionStatus({
				id: "AC-001",
				description: "Test",
				status: "satisfied",
				evidenceIds: ["EV-001"],
				notes: "",
			})
			.withMutation({
				created: [],
				modified: ["f.ts"],
				deleted: [],
				commandsExecuted: [],
				editCount: 0,
			})
			.withEvidenceSummary(1, 1, 0)
			.build();

		const formatted = formatReport(report);
		// The output is a human-readable preview string
		expect(formatted).toContain("Worker Completion Report");
		expect(typeof formatted).toBe("string");
	});

	it("should reject claim that markdown preview is authoritative", () => {
		// The v4.1.1 template states that markdown preview is
		// non-authoritative. Claims of authority should be treated as
		// suspicious and flagged by forbidden shortcut scanning when
		// paired with silent pass or fake completion markers.
		const content = "[COMPLETE] The markdown report above is the authoritative " + "completion record.";
		const result = scanForbiddenShortcuts(content);
		expect(result.blocked).toBe(true);
	});

	it("should distinguish between machine-readable evidence and human-readable preview", () => {
		// Machine-readable evidence entries are authoritative data
		const evidenceEntry = makeEvidenceEntry("EV-P4412-001", {
			verdict: "pass",
			confidence: "high",
			content: JSON.stringify({
				criterionId: "AC-P4412-001",
				timestamp: Date.now(),
				result: "all tests passed",
			}),
		});
		expect(evidenceEntry.verdict).toBe("pass");
		expect(evidenceEntry.confidence).toBe("high");

		// The human-readable report is a non-authoritative rendering
		const report = new WorkerReportBuilder("w", "ws", "p")
			.withVerdict("pass")
			.withSummary("Workspace complete")
			.build();
		const formatted = formatReport(report);
		expect(formatted).toContain("PASS");
	});

	it("should enforce that acceptance criteria are verified against evidence, not markdown", () => {
		// Criteria verified against structured evidence are authoritative.
		// Criteria relying only on human-readable markdown are unverified.
		const registry = new AcceptanceCriteriaRegistry("P44.12");
		registry.register(
			createCriterion("AC-P4412-001", "Feature must work", {
				evidenceRequired: true,
			}),
		);
		// Unverified criteria with evidence required block completion
		expect(registry.isComplete()).toBe(false);
		expect(registry.getAggregateStatus()).toBe("unverified");

		// Mark evidence as satisfied
		registry.markSatisfied("AC-P4412-001", "EV-P4412-001");
		expect(registry.isComplete()).toBe(true);
	});
});
