/**
 * V5 End-to-End Integration Test — Real PlanSpec Execution
 *
 * Tests the complete V5 runtime path with a realistic Python blog app plan.
 * This test simulates the execution flow without requiring a running server.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandPolicyEngine } from "../src/core/command-policy-engine.js";
import { extractWorkerEcho } from "../src/core/completion/worker-echo-extractor.js";
import { evaluateWorkspaceCompletionV2 } from "../src/core/completion-gate.js";
import { createPlanspecPolicyContext } from "../src/core/execution-policy.js";
import { isP45PathForbidden } from "../src/core/mutation/write-set-guard.js";
import { computeLockHashes, computeWorkspaceLockHash } from "../src/core/planlock-hash.js";
import { parsePlanSpecJsonOnly } from "../src/core/planspec-v5-parser.js";
import { parsePlanSpecV5 } from "../src/core/planspec-v5-schema.js";
import { validatePlanSpecSemantics } from "../src/core/planspec-v5-semantic-validator.js";
import type { PlanSpecV5 } from "../src/core/planspec-v5-types.js";
import { deriveWorkerPacket } from "../src/core/worker-packet-deriver.js";

// =============================================================================
// Helpers
// =============================================================================

function loadTestPlanSpec(): PlanSpecV5 {
	const fixturesDir = join(process.cwd(), "..", "..", "test-fixtures");
	const planFile = join(fixturesDir, "v5-e2e-python-blog-planspec.json");
	const json = readFileSync(planFile, "utf8");
	return JSON.parse(json);
}

// =============================================================================
// E2E-V5 Tests
// =============================================================================

describe("E2E-V5", () => {
	// E2E-V5-001: Load and parse real PlanSpec
	it("001 — loads and parses real Python blog PlanSpec", () => {
		const ps = loadTestPlanSpec();

		expect(ps.accpVersion).toBe("1.2");
		expect(ps.planspecVersion).toBe("5.0.0");
		expect(ps.taskId).toBe("V5-E2E-PYTHON-BLOG");
		expect(ps.workspaces.length).toBe(2);
		expect(ps.waves.length).toBe(2);
	});

	// E2E-V5-002: Validate PlanSpec schema
	it("002 — validates PlanSpec schema successfully", () => {
		const ps = loadTestPlanSpec();
		const json = JSON.stringify(ps);

		const parseResult = parsePlanSpecJsonOnly(json);
		expect(parseResult.success).toBe(true);

		const schemaResult = parsePlanSpecV5(json);
		expect(schemaResult.success).toBe(true);
	});

	// E2E-V5-003: Validate PlanSpec semantics
	it("003 — validates PlanSpec semantics successfully", () => {
		const ps = loadTestPlanSpec();
		const errors = validatePlanSpecSemantics(ps);
		expect(errors.length).toBe(0);
	});

	// E2E-V5-004: Admit PlanSpec and compute locks
	it("004 — admits PlanSpec and computes lock hashes", () => {
		const ps = loadTestPlanSpec();
		const canonicalJson = JSON.stringify(ps);

		// Compute workspace-specific data
		const workspaceIds = ps.workspaces.map((ws) => ws.id);
		const workspaceAllowedFiles: Record<string, string[]> = {};
		const workspaceForbiddenFiles: Record<string, string[]> = {};
		const workspaceDependencies: Record<string, string[]> = {};
		const workspaceACs: Record<string, string[]> = {};
		const workspaceValidationRefs: Record<string, string[]> = {};
		const workspaceFinalValidationRefs: Record<string, string[]> = {};
		const workspaceInstructions: Record<string, string> = {};

		for (const ws of ps.workspaces) {
			workspaceAllowedFiles[ws.id] = ["backend/**", "frontend/**"];
			workspaceForbiddenFiles[ws.id] = ["packages/coding-agent/src/p45/**"];
			workspaceDependencies[ws.id] = ws.dependencies;
			workspaceACs[ws.id] = ws.acceptanceCriteria.map((ac) => ac.id);
			workspaceValidationRefs[ws.id] = ws.validation?.commandRefs || [];
			workspaceFinalValidationRefs[ws.id] = [];
			workspaceInstructions[ws.id] = ws.description || "";
		}

		const hashes = computeLockHashes({
			canonicalPlanSpecJson: canonicalJson,
			workspaceIds,
			workspaceAllowedFiles,
			workspaceForbiddenFiles,
			workspaceDependencies,
			workspaceACs,
			workspaceValidationRefs,
			workspaceFinalValidationRefs,
			workspaceInstructions,
			reportPaths: [],
			mode: ps.authority.executionState.mode as any,
			maxParallelWorkspaces: ps.authority.executionState.maxParallelWorkspaces,
			worktreeRequired: false,
			validationLockRequired: true,
		});

		expect(hashes.canonicalJsonHash).toBeDefined();
		expect(hashes.planLockHashInput).toBeDefined();

		// Compute workspace lock hashes
		for (const ws of ps.workspaces) {
			const wsLockHash = computeWorkspaceLockHash(
				ws.id,
				workspaceAllowedFiles[ws.id],
				workspaceForbiddenFiles[ws.id],
				workspaceDependencies[ws.id],
				workspaceACs[ws.id],
				workspaceValidationRefs[ws.id],
				workspaceFinalValidationRefs[ws.id],
			);
			expect(wsLockHash).toBeDefined();
			expect(typeof wsLockHash).toBe("string");
		}
	});

	// E2E-V5-005: Derive WorkerPacketV5 for backend workspace
	it("005 — derives WorkerPacketV5 for backend workspace", () => {
		const ps = loadTestPlanSpec();
		const backendWs = ps.workspaces.find((ws) => ws.id === "WS-BACKEND");
		expect(backendWs).toBeDefined();

		const canonicalJson = JSON.stringify(ps);
		const hashes = computeLockHashes({
			canonicalPlanSpecJson: canonicalJson,
			workspaceIds: [backendWs!.id],
			workspaceAllowedFiles: { [backendWs!.id]: ["backend/**"] },
			workspaceForbiddenFiles: { [backendWs!.id]: [] },
			workspaceDependencies: { [backendWs!.id]: [] },
			workspaceACs: { [backendWs!.id]: backendWs!.acceptanceCriteria.map((ac) => ac.id) },
			workspaceValidationRefs: { [backendWs!.id]: backendWs!.validation?.commandRefs || [] },
			workspaceFinalValidationRefs: { [backendWs!.id]: [] },
			workspaceInstructions: { [backendWs!.id]: backendWs!.description || "" },
			reportPaths: [],
			mode: "planspec_locked",
			maxParallelWorkspaces: 2,
			worktreeRequired: false,
			validationLockRequired: true,
		});

		const wsLockHash = computeWorkspaceLockHash(
			backendWs!.id,
			["backend/**"],
			[],
			[],
			backendWs!.acceptanceCriteria.map((ac) => ac.id),
			backendWs!.validation?.commandRefs || [],
			[],
		);

		const planLock = {
			planLockHash: hashes.planLockHashInput,
			normalized: {
				workspaces: {
					[backendWs!.id]: {
						workspaceId: backendWs!.id,
						workspaceLockHash: wsLockHash,
						allowedFiles: ["backend/**"],
						forbiddenFiles: [],
						dependencies: [],
						acceptanceCriteria: backendWs!.acceptanceCriteria.map((ac) => ac.id),
						validationRefs: backendWs!.validation?.commandRefs || [],
						finalValidationRefs: [],
					},
				},
			},
		} as any;

		const commandScope: Record<string, string> = {};
		if (backendWs!.commands) {
			for (const cmd of backendWs!.commands) {
				commandScope[cmd.ref] = cmd.exact;
			}
		}

		const packet = deriveWorkerPacket({
			planLock,
			repoBaseSha: "test-sha",
			workspaceId: backendWs!.id,
			workspaceTitle: backendWs!.title,
			description: backendWs!.description,
			instructions: backendWs!.description,
			commandScope,
			requiredReports: (backendWs!.reports || []).map((r) => r.path),
		});

		expect(packet.planLockHash).toBe(hashes.planLockHashInput);
		expect(packet.workspaceLockHash).toBe(wsLockHash);
		expect(packet.workspaceId).toBe("WS-BACKEND");
		expect(packet.allowedFiles).toContain("backend/**");
		expect(packet.completionEchoRequired).toBe(true);
		expect(packet.acceptanceCriteria.length).toBe(5);
	});

	// E2E-V5-006: Derive WorkerPacketV5 for frontend workspace
	it("006 — derives WorkerPacketV5 for frontend workspace", () => {
		const ps = loadTestPlanSpec();
		const frontendWs = ps.workspaces.find((ws) => ws.id === "WS-FRONTEND");
		expect(frontendWs).toBeDefined();

		const canonicalJson = JSON.stringify(ps);
		const hashes = computeLockHashes({
			canonicalPlanSpecJson: canonicalJson,
			workspaceIds: [frontendWs!.id],
			workspaceAllowedFiles: { [frontendWs!.id]: ["backend/templates/**", "backend/static/**"] },
			workspaceForbiddenFiles: { [frontendWs!.id]: [] },
			workspaceDependencies: { [frontendWs!.id]: ["WS-BACKEND"] },
			workspaceACs: { [frontendWs!.id]: frontendWs!.acceptanceCriteria.map((ac) => ac.id) },
			workspaceValidationRefs: { [frontendWs!.id]: frontendWs!.validation?.commandRefs || [] },
			workspaceFinalValidationRefs: { [frontendWs!.id]: [] },
			workspaceInstructions: { [frontendWs!.id]: frontendWs!.description || "" },
			reportPaths: [],
			mode: "planspec_locked",
			maxParallelWorkspaces: 2,
			worktreeRequired: false,
			validationLockRequired: true,
		});

		const wsLockHash = computeWorkspaceLockHash(
			frontendWs!.id,
			["backend/templates/**", "backend/static/**"],
			[],
			["WS-BACKEND"],
			frontendWs!.acceptanceCriteria.map((ac) => ac.id),
			frontendWs!.validation?.commandRefs || [],
			[],
		);

		const planLock = {
			planLockHash: hashes.planLockHashInput,
			normalized: {
				workspaces: {
					[frontendWs!.id]: {
						workspaceId: frontendWs!.id,
						workspaceLockHash: wsLockHash,
						allowedFiles: ["backend/templates/**", "backend/static/**"],
						forbiddenFiles: [],
						dependencies: ["WS-BACKEND"],
						acceptanceCriteria: frontendWs!.acceptanceCriteria.map((ac) => ac.id),
						validationRefs: frontendWs!.validation?.commandRefs || [],
						finalValidationRefs: [],
					},
				},
			},
		} as any;

		const commandScope: Record<string, string> = {};
		if (frontendWs!.commands) {
			for (const cmd of frontendWs!.commands) {
				commandScope[cmd.ref] = cmd.exact;
			}
		}

		const packet = deriveWorkerPacket({
			planLock,
			repoBaseSha: "test-sha",
			workspaceId: frontendWs!.id,
			workspaceTitle: frontendWs!.title,
			description: frontendWs!.description,
			instructions: frontendWs!.description,
			commandScope,
			requiredReports: (frontendWs!.reports || []).map((r) => r.path),
		});

		expect(packet.planLockHash).toBe(hashes.planLockHashInput);
		expect(packet.workspaceLockHash).toBe(wsLockHash);
		expect(packet.workspaceId).toBe("WS-FRONTEND");
		expect(packet.dependencies).toContain("WS-BACKEND");
	});

	// E2E-V5-007: Command policy enforcement for backend commands
	it("007 — command policy enforces safe commands for backend", () => {
		const engine = createCommandPolicyEngine();
		const policyContext = createPlanspecPolicyContext("5.0.0", {
			planLockHash: undefined,
			planSpecJson: undefined,
		});

		// Safe commands should be allowed
		const mkdirDecision = engine.evaluateWithMode("mkdir -p backend", "/tmp/test", policyContext.mode);
		expect(["allow", "allow_with_evidence"]).toContain(mkdirDecision.decision);

		// pip install should require approval in strict mode
		const pipDecision = engine.evaluateWithMode("pip install flask", "/tmp/test", policyContext.mode);
		// In planspec_locked mode with commandGrantRequired, this may require approval
		expect(["allow", "allow_with_evidence", "requires_human_approval"]).toContain(pipDecision.decision);
	});

	// E2E-V5-008: P45 boundary enforcement
	it("008 — P45 boundary blocks forbidden paths", () => {
		// Should block P45 paths
		expect(isP45PathForbidden("packages/coding-agent/src/p45/runtime.ts", ["packages/coding-agent/src/p45/**"])).toBe(
			true,
		);

		// Should allow normal paths
		expect(isP45PathForbidden("backend/models.py", ["packages/coding-agent/src/p45/**"])).toBe(false);
		expect(isP45PathForbidden("backend/templates/index.html", ["packages/coding-agent/src/p45/**"])).toBe(false);
	});

	// E2E-V5-009: Simulate backend workspace completion with echo
	it("009 — simulates backend workspace completion with lock echo", () => {
		const ps = loadTestPlanSpec();
		const _backendWs = ps.workspaces.find((ws) => ws.id === "WS-BACKEND")!;

		// Simulate worker output with lock echo
		const workerOutput = JSON.stringify({
			workspaceId: "WS-BACKEND",
			planLockHash: "test-plan-lock-hash",
			workspaceLockHash: "test-workspace-lock-hash",
			verdict: "complete",
			evidenceRefs: ["EV-BACKEND-001", "EV-BACKEND-002"],
			reportPaths: ["reports/backend-api-summary.md"],
		});

		const echoResult = extractWorkerEcho(workerOutput);
		expect(echoResult.success).toBe(true);
		expect(echoResult.claim).toBeDefined();
		expect(echoResult.claim!.workspaceId).toBe("WS-BACKEND");
		expect(echoResult.claim!.verdict).toBe("complete");
	});

	// E2E-V5-010: Evaluate completion gate with all evidence
	it("010 — evaluates completion gate with all required evidence", () => {
		const state = {
			planExecId: "PLAN-E2E-001",
			workspaceId: "WS-BACKEND",
			implementationFinished: true,
			targetCommandPassed: true,
			lastCommandExitCode: 0,
			planspecMode: true,
			planLockHash: "test-plan-lock-hash",
			workspaceLockHash: "test-workspace-lock-hash",
			failureSignals: [],
			outOfRetries: false,
			watchModeCommandDetected: false,
			watchModeCommand: null,
			validationCommandRunning: false,
			targetCommandRunning: false,
			commandHistory: [],
			dangerousGitCommandDetected: false,
			dangerousGitCommand: null,
		} as any;

		const ws = { id: "WS-BACKEND", title: "Backend", dependencies: [] } as any;

		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "test-plan-lock-hash",
			expectedWorkspaceLockHash: "test-workspace-lock-hash",
			workerReportedPlanLockHash: "test-plan-lock-hash",
			workerReportedWorkspaceLockHash: "test-workspace-lock-hash",
			evidenceSatisfaction: {
				satisfied: 5, // All ACs satisfied
				failed: 0,
				unverified: 0,
				requiresAcceptanceCriteria: true,
			},
		});

		expect(result.canComplete).toBe(true);
		expect(result.blockReasons.length).toBe(0);
	});

	// E2E-V5-011: Verify wave dependencies
	it("011 — verifies wave structure is correct", () => {
		const ps = loadTestPlanSpec();

		expect(ps.waves.length).toBe(2);
		expect(ps.waves[0].id).toBe("WAVE-01");
		expect(ps.waves[0].workspaceRefs).toContain("WS-BACKEND");

		expect(ps.waves[1].id).toBe("WAVE-02");
		expect(ps.waves[1].workspaceRefs).toContain("WS-FRONTEND");

		// Frontend depends on backend
		const frontendWs = ps.workspaces.find((ws) => ws.id === "WS-FRONTEND");
		expect(frontendWs?.dependencies).toContain("WS-BACKEND");
	});

	// E2E-V5-012: Verify validation cases
	it("012 — verifies validation cases are defined", () => {
		const ps = loadTestPlanSpec();

		expect(ps.validationCases.length).toBeGreaterThan(0);

		for (const vc of ps.validationCases) {
			expect(vc.id).toBeDefined();
			expect(vc.description).toBeDefined();
			expect(vc.input).toBeDefined();
			expect(vc.expected).toBeDefined();
			expect(vc.expected.valid).toBeDefined();
		}
	});
});
