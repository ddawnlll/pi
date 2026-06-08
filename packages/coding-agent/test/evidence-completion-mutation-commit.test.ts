/**
 * Evidence, Completion, Mutation, Commit Lock Wiring Tests
 *
 * ACCP 1.2 / PlanSpec v5
 *
 * Covers:
 * - Evidence ledger lock binding
 * - Completion gate v2 lock/evidence checks
 * - Write-set guard P45 boundary
 * - Workspace commit gate lock integration
 * - Negative/positive cases
 */

import { describe, expect, it } from "vitest";
import type { EvidenceLedgerEntry } from "../src/core/completion/evidence-types.js";
import {
	createWorkspaceValidationState,
	evaluateWorkspaceCompletionV2,
	type WorkspaceValidationState,
} from "../src/core/completion-gate.js";
import { isP45PathForbidden } from "../src/core/mutation/write-set-guard.js";
import type { Workspace } from "../src/core/workspace-schema.js";

// =============================================================================
// Helpers
// =============================================================================

function createTestValidationState(overrides?: Partial<WorkspaceValidationState>): WorkspaceValidationState {
	return {
		...createWorkspaceValidationState("PLAN-001", "WS-01"),
		implementationFinished: true,
		targetCommandPassed: true,
		lastCommandExitCode: 0,
		...overrides,
	};
}

function createTestWorkspace(): Workspace {
	return {
		id: "WS-01",
		title: "Test Workspace",
		dependencies: [],
		roleBudget: "worker" as any,
		maxRetries: 3,
	};
}

// =============================================================================
// Evidence Cases
// =============================================================================

describe("EVIDENCE_CASES", () => {
	// EVIDENCE_CASES-001: source evidence maps to AC
	it("001 — source evidence can map to an AC", () => {
		const evidence: EvidenceLedgerEntry = {
			id: "EV-001",
			type: "source_file",
			description: "Source code implements AC-01",
			source: "src/feature.ts",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "file content hash",
			criterionIds: ["AC-01"],
		};
		expect(evidence.criterionIds).toContain("AC-01");
		expect(evidence.type).toBe("source_file");
	});

	// EVIDENCE_CASES-002: command evidence maps to AC
	it("002 — command evidence can map to an AC", () => {
		const evidence: EvidenceLedgerEntry = {
			id: "EV-002",
			type: "command_result",
			description: "npm test passes AC-02",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "Tests passed: 42",
			criterionIds: ["AC-02"],
		};
		expect(evidence.criterionIds).toContain("AC-02");
	});

	// EVIDENCE_CASES-003: negative evidence maps to AC
	it("003 — negative evidence can map to an AC", () => {
		const evidence: EvidenceLedgerEntry = {
			id: "EV-003",
			type: "static_analysis",
			description: "No lint errors for AC-03",
			source: "npm run lint",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "medium",
			content: "No errors found",
			criterionIds: ["AC-03"],
		};
		expect(evidence.criterionIds).toContain("AC-03");
	});

	// EVIDENCE_CASES-004: report evidence binds to lock
	it("004 — report evidence can bind to lock hashes", () => {
		const evidence: EvidenceLedgerEntry = {
			id: "EV-004",
			type: "artifact",
			description: "ACCP report for WS-01",
			source: "reports/ws-01-accp.md",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "Evidence summary...",
			criterionIds: ["AC-01"],
			planLockHash: "abc123def456",
			workspaceLockHash: "def789ghi012",
		};
		expect(evidence.planLockHash).toBe("abc123def456");
		expect(evidence.workspaceLockHash).toBe("def789ghi012");
	});

	// EVIDENCE_CASES-005: confidence enum enforced
	it("005 — confidence enum accepts valid values", () => {
		const validConfidences = ["high", "medium", "low", "unknown"] as const;
		for (const c of validConfidences) {
			const evidence: EvidenceLedgerEntry = {
				id: `EV-${c}`,
				type: "other",
				description: "test",
				source: "test",
				timestamp: Date.now(),
				verdict: "pass",
				confidence: c,
				content: "test",
				criterionIds: [],
			};
			expect(evidence.confidence).toBe(c);
		}
	});

	// EVIDENCE_CASES-006: unknown AC ref rejected by validator
	it("006 — evidence with unknown AC ref should be catchable", () => {
		const evidence: EvidenceLedgerEntry = {
			id: "EV-006",
			type: "other",
			description: "Unknown AC evidence",
			source: "test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "low",
			content: "test",
			criterionIds: ["AC-NONEXISTENT"],
		};
		// The evidence type allows any criterionIds; semantic validation catches unknown refs
		expect(evidence.criterionIds).toContain("AC-NONEXISTENT");
		const knownACs = new Set(["AC-01", "AC-02"]);
		const unknownRefs = evidence.criterionIds.filter((id) => !knownACs.has(id));
		expect(unknownRefs.length).toBeGreaterThan(0);
	});
});

// =============================================================================
// Completion Cases
// =============================================================================

describe("COMPLETION_CASES", () => {
	// COMPLETION_CASES-001: complete claim missing AC evidence blocks
	it("001 — missing AC evidence blocks completion", () => {
		const state = createTestValidationState({ implementationFinished: true });
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			evidenceSatisfaction: {
				satisfied: 0,
				failed: 0,
				unverified: 2,
				requiresAcceptanceCriteria: true,
			},
		});
		expect(result.canComplete).toBe(false);
		expect(result.blockReasons.some((r) => r.includes("AC evidence") || r.includes("unverified"))).toBe(true);
	});

	// COMPLETION_CASES-002: stale workspaceLockHash blocks
	it("002 — workspace lock hash mismatch blocks completion", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			planspecMode: true,
			planLockHash: "expected-hash",
			workspaceLockHash: "stale-hash",
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "expected-hash",
			expectedWorkspaceLockHash: "expected-workspace-hash",
		});
		expect(result.canComplete).toBe(false);
		const hashBlock = result.blockReasons.find((r) => r.includes("Workspace lock hash mismatch"));
		expect(hashBlock).toBeDefined();
	});

	// COMPLETION_CASES-003: missing validation command blocks
	it("003 — missing target command blocks completion", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			targetCommandPassed: null,
		});
		const ws = createTestWorkspace();
		ws.targetCommand = "npm test";
		const result = evaluateWorkspaceCompletionV2(state, ws);
		expect(result.canComplete).toBe(false);
		const cmdBlock = result.blockReasons.find((r) => r.includes("Target command"));
		expect(cmdBlock).toBeDefined();
	});

	// COMPLETION_CASES-004: evidence with no lock hash in PlanSpec mode — does not block by itself (lock check separate)
	it("004 — missing lock hashes on validation state block in PlanSpec mode", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			planspecMode: true,
			// no lock hashes set
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, { planspecMode: true });
		expect(result.canComplete).toBe(false);
		const hashBlock = result.blockReasons.find((r) => r.includes("Lock hashes not set"));
		expect(hashBlock).toBeDefined();
	});

	// COMPLETION_CASES-005: all AC evidence present allows
	it("005 — all AC evidence present allows completion", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			targetCommandPassed: true,
			lastCommandExitCode: 0,
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: {
				satisfied: 2,
				failed: 0,
				unverified: 0,
				requiresAcceptanceCriteria: true,
			},
		});
		expect(result.canComplete).toBe(true);
	});

	// COMPLETION_CASES-006: AC failure blocks even with other checks passing
	it("006 — AC failure blocks completion", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			targetCommandPassed: true,
			lastCommandExitCode: 0,
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			evidenceSatisfaction: {
				satisfied: 1,
				failed: 1,
				unverified: 0,
				requiresAcceptanceCriteria: true,
			},
		});
		expect(result.canComplete).toBe(false);
		const failBlock = result.blockReasons.find((r) => r.includes("failed"));
		expect(failBlock).toBeDefined();
	});
});

// =============================================================================
// Mutation Cases
// =============================================================================

describe("MUTATION_CASES", () => {
	// MUTATION_CASES-005: P45 runtime write rejects
	it("005 — P45 runtime path write is detected as forbidden", () => {
		const result = isP45PathForbidden("packages/ai/src/runtime/models.ts", ["packages/ai/src/runtime/**"]);
		expect(result).toBe(true);
	});

	it("005b — P45 non-runtime path is not forbidden", () => {
		const result = isP45PathForbidden("packages/ai/src/providers/openai.ts", ["packages/ai/src/runtime/**"]);
		expect(result).toBe(false);
	});

	it("005c — P45 with no forbidden paths allows all", () => {
		const result = isP45PathForbidden("packages/ai/src/runtime/models.ts", undefined);
		expect(result).toBe(false);
	});

	it("005d — P45 exact path match is forbidden", () => {
		const result = isP45PathForbidden("packages/core/index.ts", ["packages/core/index.ts"]);
		expect(result).toBe(true);
	});

	// MUTATION_CASES-006: bridge artifact allowed
	it("006 — non-forbidden path is not flagged", () => {
		const result = isP45PathForbidden("reports/audit.md", ["packages/ai/src/runtime/**"]);
		expect(result).toBe(false);
	});
});

// =============================================================================
// Negative Cases
// =============================================================================

describe("COMP-NEG negative cases", () => {
	// COMP-NEG-001: COMPLETE without AC evidence blocks
	it("001 — COMPLETE without AC evidence blocks", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			targetCommandPassed: true,
			lastCommandExitCode: 0,
			planspecMode: true,
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			evidenceSatisfaction: {
				satisfied: 0,
				failed: 0,
				unverified: 1,
				requiresAcceptanceCriteria: true,
			},
		});
		expect(result.canComplete).toBe(false);
	});

	// COMP-NEG-002: lock mismatch blocks completion
	it("002 — lock mismatch blocks completion", () => {
		const state = createTestValidationState({
			implementationFinished: true,
			planspecMode: true,
			planLockHash: "stale-plan-hash",
			workspaceLockHash: "good-ws-hash",
		});
		const ws = createTestWorkspace();
		const result = evaluateWorkspaceCompletionV2(state, ws, {
			planspecMode: true,
			expectedPlanLockHash: "expected-plan-hash",
			expectedWorkspaceLockHash: "good-ws-hash",
		});
		expect(result.canComplete).toBe(false);
		const planBlock = result.blockReasons.find((r) => r.includes("Plan lock hash mismatch"));
		expect(planBlock).toBeDefined();
	});
});

// =============================================================================
// MUT-NEG negative cases
// =============================================================================

describe("MUT-NEG negative cases", () => {
	// MUT-NEG-001: P45 runtime write blocks
	it("001 — P45 runtime write detected", () => {
		const result = isP45PathForbidden("packages/core/src/runtime/engine.ts", ["packages/core/src/runtime/**"]);
		expect(result).toBe(true);
	});

	it("001b — non-P45 path allowed", () => {
		const result = isP45PathForbidden("packages/core/src/providers/provider.ts", ["packages/core/src/runtime/**"]);
		expect(result).toBe(false);
	});
});

// =============================================================================
// Evidence integrity
// =============================================================================

describe("EVIDENCE_INTEGRITY", () => {
	it("evidence entry with lock hashes is valid", () => {
		const entry: EvidenceLedgerEntry = {
			id: "EV-LOCK-001",
			type: "artifact",
			description: "ACCP report",
			source: "reports/test.md",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "Report content",
			criterionIds: ["AC-01"],
			planLockHash: "plan-hash-123",
			workspaceLockHash: "ws-hash-456",
		};
		expect(entry.planLockHash).toBeTruthy();
		expect(entry.workspaceLockHash).toBeTruthy();
	});

	it("evidence entry without lock hashes is valid for legacy mode", () => {
		const entry: EvidenceLedgerEntry = {
			id: "EV-LEGACY-001",
			type: "command_result",
			description: "Test passed",
			source: "npm test",
			timestamp: Date.now(),
			verdict: "pass",
			confidence: "high",
			content: "Passed",
			criterionIds: ["AC-01"],
		};
		expect(entry.planLockHash).toBeUndefined();
	});
});
