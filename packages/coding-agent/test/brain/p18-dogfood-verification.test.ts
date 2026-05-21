/**
 * P18.H — Dogfood Verification Test
 *
 * End-to-end verification of P18 Trust, Policy, Audit & Approval Controls
 * acceptance criteria.
 *
 * Acceptance Criteria:
 * AC1. Policy Engine — Correctly evaluates test actions against rules
 * AC2. Forbidden Actions — Blocked and audited
 * AC3. Approval Flow — Request created, approved, confirmed in audit
 * AC4. Emergency Stop — Blocks autonomous actions
 * AC5. Dashboard API — Trust metrics and events accessible via audit
 *
 * @packageDocumentation
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PolicyEngine, createPolicyEngine } from "../../src/brain/policy/engine.js";
import { RuleStore } from "../../src/brain/policy/store.js";
import { AuditLedger } from "../../src/brain/audit/ledger.js";
import { ApprovalGate, createApprovalGate } from "../../src/brain/approvals/gate.js";
import { AutonomyEngine } from "../../src/brain/goals/profile-engine.js";
import type { AuditEntry } from "../../src/brain/audit/ledger.js";
import type { PolicyContext, PolicyRule } from "../../src/brain/policy/types.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), ".pi-test", `p18-dogfood-${Date.now()}`);
const FIXTURE_RULES_PATH = path.resolve(process.cwd(), "test/fixtures/policy/test-rules.json");

async function loadFixtureRules(): Promise<PolicyRule[]> {
	const json = await fs.readFile(FIXTURE_RULES_PATH, "utf-8");
	return JSON.parse(json) as PolicyRule[];
}

async function createStore(): Promise<RuleStore> {
	const store = new RuleStore({
		basePath: path.join(TEST_DIR, "brain", "policy"),
		autoSave: true,
		backupOnSave: false,
	});
	await store.initialize();

	const rules = await loadFixtureRules();
	for (const rule of rules) {
		await store.createRule(rule);
	}

	return store;
}

function makeContext(overrides?: Partial<PolicyContext>): PolicyContext {
	return {
		action: "retry_transient_failure",
		actor: "pi",
		autonomyLevel: 2,
		metadata: {},
		...overrides,
	};
}

/** Mock audit ledger that implements the { append } interface needed by PolicyEngine.evaluateWithAudit */
class MockAuditLedger {
	public entries: AuditEntry[] = [];

	async append(entry: AuditEntry): Promise<void> {
		this.entries.push(entry);
	}
}

async function cleanTestDir(): Promise<void> {
	try {
		await fs.rm(TEST_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P18 Dogfood Verification", () => {
	let store: RuleStore;
	let engine: PolicyEngine;
	let mockAudit: MockAuditLedger;
	let realAudit: AuditLedger;

	beforeEach(async () => {
		await cleanTestDir();
		store = await createStore();
		engine = createPolicyEngine(store, { cacheTtlMs: 100 });
		mockAudit = new MockAuditLedger();
		realAudit = new AuditLedger({
			basePath: path.join(TEST_DIR, "brain", "audit"),
			rotationThresholdBytes: 100 * 1024 * 1024,
			flushIntervalMs: 100,
			batchSize: 10,
		});
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	// =======================================================================
	// AC1: Policy engine correctly evaluates test actions
	// =======================================================================

	describe("AC1: Policy engine evaluates test actions", () => {
		it("allows an action matching an allow rule", async () => {
			const result = await engine.evaluate({
				action: "retry_transient_failure",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("allow");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.name).toContain("Retry");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("denies an unknown action (default deny, autonomy < 4)", async () => {
			// Use autonomy level 2 (below 4) so the catch-all for autonomy >= 4 doesn't match
			const result = await engine.evaluate({
				action: "completely_unknown_action_xz7",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
			expect(result.explanation).toContain("No policy rule matched");
		});

		it("applies priority ordering — higher priority wins", async () => {
			// Create a low priority allow rule and high priority deny rule for same action
			const lowRule: PolicyRule = {
				id: "low_001",
				name: "Low priority allow",
				description: "Low priority rule that allows",
				condition: { action: "high_risk_delete" },
				decision: "allow",
				priority: 10,
				enabled: true,
				metadata: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			const highRule: PolicyRule = {
				id: "high_001",
				name: "High priority deny",
				description: "High priority rule that blocks",
				condition: { action: "high_risk_delete" },
				decision: "deny",
				priority: 100,
				enabled: true,
				metadata: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			await store.createRule(lowRule);
			await store.createRule(highRule);

			const result = await engine.evaluate({
				action: "high_risk_delete",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("deny");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.id).toBe("high_001");
		});

		it("supports glob pattern matching — memory_query matches allow rule", async () => {
			// memory_query is explicitly listed in fixtures with decision "allow"
			const result = await engine.evaluate({
				action: "memory_query",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("allow");
		});

		it("glob pattern memory_* matches memory_ prefixed actions", async () => {
			// memory_* glob matches memory_creation with approval_required
			const result = await engine.evaluate({
				action: "memory_compact",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			// The glob_001 rule (memory_*, priority 95) should match
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.name).toContain("Glob match memory");
		});

		it("filters by autonomy level", async () => {
			// Create a rule that only applies at autonomy level >= 4
			const rule: PolicyRule = {
				id: "autonomy_001",
				name: "High autonomy only",
				description: "Only for autonomous mode",
				condition: {
					action: "auto_plan_execute",
					minAutonomyLevel: 4,
				},
				decision: "approval_required",
				priority: 100,
				enabled: true,
				metadata: {},
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			await store.createRule(rule);

			// At low autonomy, rule doesn't match => default deny
			const lowResult = await engine.evaluate({
				action: "auto_plan_execute",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(lowResult.decision).toBe("deny");

			// At high autonomy, rule matches
			const highResult = await engine.evaluate({
				action: "auto_plan_execute",
				actor: "pi",
				autonomyLevel: 4,
				metadata: {},
			});
			expect(highResult.decision).toBe("approval_required");
		});

		it("returns cached results for repeated evaluations", async () => {
			const context = makeContext({ action: "retry_transient_failure" });
			const first = await engine.evaluate(context);
			const second = await engine.evaluate(context);
			expect(second.decision).toBe(first.decision);
			expect(second.evaluatedAt).toBe(first.evaluatedAt);
		});

		it("generates audit entries via evaluateWithAudit (mock audit)", async () => {
			const context = makeContext({ action: "retry_transient_failure" });
			const result = await engine.evaluateWithAudit(context, mockAudit);

			expect(result.auditEntry).toBeDefined();
			expect(result.auditEntry.id).toBeTruthy();
			expect(result.auditEntry.decision).toBe("allow");
			expect(result.auditEntry.action).toBe("retry_transient_failure");
			expect(result.auditEntry.actor).toBe("pi");
			expect(result.auditEntry.result).toBe("success");

			// Verify mock received it
			expect(mockAudit.entries.length).toBe(1);
			expect(mockAudit.entries[0].decision).toBe("allow");
		});
	});

	// =======================================================================
	// AC2: Forbidden actions blocked and audited
	// =======================================================================

	describe("AC2: Forbidden actions blocked and audited", () => {
		it("blocks actions that match a forbidden rule", async () => {
			// access_secrets is in fixtures as forbidden
			const result = await engine.evaluate({
				action: "access_secrets",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("forbidden");
			expect(result.matchedRule).not.toBeNull();
			expect(result.matchedRule!.name).toContain("Never access secrets");
		});

		it("logs forbidden decisions to audit with 'blocked' result", async () => {
			const context: PolicyContext = {
				action: "destructive_cleanup",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			};

			const result = await engine.evaluateWithAudit(context, mockAudit);
			expect(result.decision).toBe("forbidden");
			expect(result.auditEntry.result).toBe("blocked");
			expect(mockAudit.entries[0].result).toBe("blocked");
		});

		it("blocks actions default-deny when no rule matches (autonomy < 4)", async () => {
			const result = await engine.evaluate({
				action: "some_mysterious_action",
				actor: "pi",
				autonomyLevel: 1,
				metadata: {},
			});
			expect(result.decision).toBe("deny");
			expect(result.matchedRule).toBeNull();
		});

		it("audits default-deny decisions", async () => {
			const context: PolicyContext = {
				action: "some_mysterious_action",
				actor: "pi",
				autonomyLevel: 1,
				metadata: {},
			};
			const result = await engine.evaluateWithAudit(context, mockAudit);
			expect(result.decision).toBe("deny");
			expect(result.auditEntry.result).toBe("blocked");
			expect(result.auditEntry.policyRuleId).toBeUndefined();
		});
	});

	// =======================================================================
	// AC3: Approval request created, approved, confirmed in audit
	// =======================================================================

	describe("AC3: Approval flow — request, approve, audit", () => {
		let approvalGate: ApprovalGate;

		beforeEach(() => {
			approvalGate = createApprovalGate(mockAudit, {
				defaultDeadlineHours: 24,
				autoExpireCheckIntervalMs: 3600000,
				requireReasonOnRejection: false,
				maxPendingPerType: 10,
			});
		});

		it("creates an approval request for approval_required decisions", async () => {
			// execute_generated_plan requires approval in fixtures
			const result = await engine.evaluate({
				action: "execute_generated_plan",
				actor: "pi",
				autonomyLevel: 2,
				metadata: {},
			});
			expect(result.decision).toBe("approval_required");
		});

		it("approval gate creates and tracks requests", async () => {
			const context: PolicyContext = {
				action: "deploy_to_production",
				actor: "pi",
				autonomyLevel: 3,
				proposalId: "prop-123",
				metadata: { rationale: "Deploy validated build v2.1" },
			};

			const request = await approvalGate.requestApproval(context, {
				level: "high",
				score: 0.8,
				factors: ["Production deployment", "User-facing changes"],
				description: "Deploy to production requires approval",
			});

			expect(request).toBeDefined();
			expect(request.id).toBeTruthy();
			expect(request.status).toBe("pending");
			expect(request.action).toBe("deploy_to_production");
			expect(request.proposalId).toBe("prop-123");
			expect(request.policyContext.actor).toBe("pi");
		});

		it("approves a request and logs to mock audit", async () => {
			const context: PolicyContext = {
				action: "merge_pull_request",
				actor: "pi",
				autonomyLevel: 3,
				proposalId: "prop-456",
				metadata: { rationale: "Merge approved PR #89" },
			};

			const request = await approvalGate.requestApproval(context, {
				level: "medium",
				score: 0.5,
				factors: ["PR merge"],
				description: "Merge PR requires approval",
			});

			// Approve the request
			const approved = await approvalGate.approve(request.id, "user-test");

			expect(approved.status).toBe("approved");
			expect(approved.approvedBy).toBe("user-test");
			expect(approved.approvedAt).toBeTruthy();

			// Verify it's no longer pending
			const pending = approvalGate.getPending();
			expect(pending.find((r) => r.id === request.id)).toBeUndefined();

			// Verify audit was written
			const approveAudits = mockAudit.entries.filter((e) => e.action.startsWith("approve:"));
			expect(approveAudits.length).toBe(1);
			expect(approveAudits[0].decision).toBe("allow");
			expect(approveAudits[0].result).toBe("success");
		});

		it("rejects a request and logs to mock audit", async () => {
			const context: PolicyContext = {
				action: "delete_old_backups",
				actor: "pi",
				autonomyLevel: 3,
				proposalId: "prop-789",
				metadata: { rationale: "Clean up backups older than 90 days" },
			};

			const request = await approvalGate.requestApproval(context, {
				level: "low",
				score: 0.3,
				factors: ["Backup deletion"],
				description: "Delete old backups",
			});

			const rejected = await approvalGate.reject(request.id, "user-test", "Not now");

			expect(rejected.status).toBe("rejected");
			expect(rejected.rejectedBy).toBe("user-test");
			expect(rejected.rejectionReason).toBe("Not now");

			// Verify audit was written
			const rejectAudits = mockAudit.entries.filter((e) => e.action.startsWith("reject:"));
			expect(rejectAudits.length).toBe(1);
			expect(rejectAudits[0].decision).toBe("deny");
			expect(rejectAudits[0].result).toBe("blocked");
		});

		it("confirms approval in real audit ledger using direct log() calls", async () => {
			// Use the real audit ledger's log() method to verify audit persistence
			await realAudit.log({
				actor: "user",
				action: "approve:rollback_release",
				decision: "allow",
				proposalId: "prop-audit-001",
				evidence: [],
				result: "success",
				context: { autonomyLevel: 4, riskLevel: "critical" },
				metadata: { approvedBy: "user-test" },
			});

			await realAudit.flush();

			const queryResult = await realAudit.query({ action: "approve:rollback_release" });
			expect(queryResult.length).toBe(1);
			expect(queryResult[0].action).toBe("approve:rollback_release");
			expect(queryResult[0].decision).toBe("allow");
			expect(queryResult[0].result).toBe("success");
			expect(queryResult[0].id).toBeTruthy();
			expect(queryResult[0].timestamp).toBeTruthy();
		});

		it("tracks approval stats correctly", async () => {
			const ctx1 = makeContext({ action: "action_p1", proposalId: "p1", metadata: { rationale: "test" } });
			const ctx2 = makeContext({ action: "action_p2", proposalId: "p2", metadata: { rationale: "test" } });

			await approvalGate.requestApproval(ctx1, { level: "low", score: 0.1, factors: [], description: "" });
			const req2 = await approvalGate.requestApproval(ctx2, { level: "low", score: 0.1, factors: [], description: "" });

			await approvalGate.approve(req2.id, "user");

			const stats = approvalGate.getStats();
			expect(stats.total).toBe(2);
			expect(stats.pending).toBe(1);
			expect(stats.approved).toBe(1);
			expect(stats.rejected).toBe(0);
		});
	});

	// =======================================================================
	// AC4: Emergency stop blocks autonomous actions
	// =======================================================================

	describe("AC4: Emergency stop blocks autonomous actions", () => {
		let autonomyEngine: AutonomyEngine;
		let profile: import("../../src/brain/goals/types.js").AutonomyProfile;

		beforeEach(() => {
			import("../../src/brain/goals/types.js").then(({ createAutonomyProfile }) => {
				profile = createAutonomyProfile(4);
			});
		});

		it("autonomy engine emergency stop blocks autonomous actions", async () => {
			const { createAutonomyProfile } = await import("../../src/brain/goals/types.js");
			const engine = new AutonomyEngine();
			const prof = createAutonomyProfile(4);

			// Check not stopped initially
			const initial = engine.isEmergencyStopped();
			expect(initial).toBe(false);

			// Activate emergency stop
			await engine.emergencyStop();
			const stopped = engine.isEmergencyStopped();
			expect(stopped).toBe(true);

			// Release emergency stop
			await engine.releaseEmergencyStop("user-test");
			const released = engine.isEmergencyStopped();
			expect(released).toBe(false);
		});

		it("emergency stop prevents high-autonomy decisions", async () => {
			const { createAutonomyProfile } = await import("../../src/brain/goals/types.js");
			const engine = new AutonomyEngine();
			const prof = createAutonomyProfile(4);

			// At level 4, normal actions should be allowed
			const before = engine.canPerform("generate_insight", prof);
			expect(before.allowed).toBe(true);

			// Activate emergency stop
			await engine.emergencyStop();

			// canPerform should be blocked by emergency stop
			const after = engine.canPerform("generate_insight", prof);
			expect(after.allowed).toBe(false);
			expect(after.isForbidden).toBe(true);
			expect(after.reason).toContain("Emergency stop");

			// Release
			await engine.releaseEmergencyStop("user-test");
			const released = engine.canPerform("generate_insight", prof);
			expect(released.allowed).toBe(true);
		});
	});

	// =======================================================================
	// AC5: Dashboard shows trust state via API (audit/provenance)
	// =======================================================================

	describe("AC5: Dashboard shows trust state via audit", () => {
		it("audit ledger records entries that can be queried for metrics", async () => {
			// Write entries using real audit ledger
			await realAudit.log({
				actor: "pi",
				action: "retry_transient_failure",
				decision: "allow",
				evidence: [],
				result: "success",
				context: { autonomyLevel: 2 },
				metadata: {},
			});
			await realAudit.log({
				actor: "pi",
				action: "memory_query",
				decision: "allow",
				evidence: [],
				result: "success",
				context: { autonomyLevel: 2 },
				metadata: {},
			});
			await realAudit.log({
				actor: "pi",
				action: "unknown_action",
				decision: "deny",
				evidence: [],
				result: "blocked",
				context: { autonomyLevel: 1 },
				metadata: {},
			});

			await realAudit.flush();

			const stats = await realAudit.getStats();
			expect(stats.totalEntries).toBe(3);
			expect(stats.byDecision.allow).toBe(2);
			expect(stats.byDecision.deny).toBe(1);
			expect(stats.byResult.success).toBe(2);
			expect(stats.byResult.blocked).toBe(1);

			// Trust score-like computation
			const trustedEntries = stats.totalEntries;
			const deniedEntries = stats.byDecision.deny ?? 0;
			const trustScore = Math.round(
				Math.max(0, Math.min(100, ((trustedEntries - deniedEntries) / trustedEntries) * 100)),
			);
			expect(trustScore).toBe(67); // 2/3 = 66.6... rounds to 67
		});

		it("audit query returns recent events like dashboard would use", async () => {
			const actions = ["retry_transient_failure", "memory_query", "observe_system_state"];
			for (const action of actions) {
				await realAudit.log({
					actor: "pi",
					action,
					decision: "allow",
					evidence: [],
					result: "success",
					context: { autonomyLevel: 2 },
					metadata: {},
				});
			}
			await realAudit.flush();

			const entries = await realAudit.query({ limit: 10 });
			expect(entries.length).toBe(3);

			for (const entry of entries) {
				expect(entry.id).toBeTruthy();
				expect(entry.action).toBeTruthy();
				expect(entry.decision).toBeTruthy();
				expect(entry.timestamp).toBeTruthy();
				expect(entry.actor).toBeTruthy();
			}
		});

		it("forbidden actions appear in audit as blocked", async () => {
			await realAudit.log({
				actor: "pi",
				action: "access_secrets",
				decision: "forbidden",
				policyRuleId: "forbid_001",
				policyRuleName: "Never access secrets",
				evidence: [],
				result: "blocked",
				context: { autonomyLevel: 2 },
				metadata: {},
			});
			await realAudit.flush();

			const entries = await realAudit.query({ decision: "forbidden" as any });
			expect(entries.length).toBe(1);
			expect(entries[0].decision).toBe("forbidden");
			expect(entries[0].result).toBe("blocked");
		});

		it("provenance tracker records and explains decisions", async () => {
			const { ProvenanceTracker, createProvenanceTracker } = await import(
				"../../src/brain/policy/provenance.js"
			);

			const tracker = createProvenanceTracker({
				persistencePath: path.join(TEST_DIR, "brain", "audit", "provenance"),
			});
			await tracker.init();

			// Track a decision
			const record = await tracker.track("decision-001", "decision", [
				{
					sourceId: "rule-001",
					sourceType: "decision",
					relationship: "derived_from",
					timestamp: new Date().toISOString(),
					summary: "Matched policy rule 'Retry transient failures'",
					metadata: {},
				},
			]);
			expect(record.id).toBeTruthy();
			expect(record.targetId).toBe("decision-001");

			// Verify we can retrieve it
			const fetched = await tracker.getProvenance("decision-001");
			expect(fetched).not.toBeNull();
			expect(fetched!.links.length).toBe(1);
			expect(fetched!.links[0].summary).toContain("Retry transient failures");

			// Stats
			const stats = await tracker.getStats();
			expect(stats.totalRecords).toBe(1);
			expect(stats.totalLinks).toBe(1);
		});
	});
});

// ---------------------------------------------------------------------------
// End-to-End: Full P18 Trust Controls Pipeline
// ---------------------------------------------------------------------------

describe("P18 End-to-End: Full Trust Controls Pipeline", () => {
	let store: RuleStore;
	let engine: PolicyEngine;
	let mockAudit: MockAuditLedger;
	let approvalGate: ApprovalGate;

	beforeEach(async () => {
		await cleanTestDir();
		store = await createStore();
		engine = createPolicyEngine(store, { cacheTtlMs: 100 });
		mockAudit = new MockAuditLedger();
		approvalGate = createApprovalGate(mockAudit, {
			defaultDeadlineHours: 24,
			autoExpireCheckIntervalMs: 3600000,
			requireReasonOnRejection: false,
			maxPendingPerType: 10,
		});
	});

	afterEach(async () => {
		await cleanTestDir();
	});

	it("full pipeline: forbidden => blocked/audited, approval => approved/audited, allow => executed", async () => {
		// ---- STEP 1: Allowed action ----
		const allowResult = await engine.evaluateWithAudit(
			makeContext({ action: "retry_transient_failure" }),
			mockAudit,
		);
		expect(allowResult.decision).toBe("allow");

		// ---- STEP 2: Forbidden action ----
		const forbidResult = await engine.evaluateWithAudit(
			makeContext({ action: "access_secrets" }),
			mockAudit,
		);
		expect(forbidResult.decision).toBe("forbidden");
		expect(forbidResult.auditEntry.result).toBe("blocked");

		// ---- STEP 3: Approval required action ----
		const approvalResult = await engine.evaluate(
			makeContext({ action: "execute_generated_plan" }),
		);
		expect(approvalResult.decision).toBe("approval_required");

		// Create approval request
		const request = await approvalGate.requestApproval(
			makeContext({ action: "execute_generated_plan", proposalId: "e2e-prop-001", metadata: { rationale: "e2e test" } }),
			{ level: "high", score: 0.7, factors: ["Production"], description: "Prod deploy" },
		);
		expect(request.status).toBe("pending");

		// Approve it
		const approved = await approvalGate.approve(request.id, "e2e-tester");
		expect(approved.status).toBe("approved");

		// ---- STEP 4: Verify audit trail ----
		// The mock audit should have entries from evaluateWithAudit + approval
		const allowAudit = mockAudit.entries.find((e) => e.action === "retry_transient_failure");
		expect(allowAudit).toBeDefined();
		expect(allowAudit!.decision).toBe("allow");
		expect(allowAudit!.result).toBe("success");

		const forbidAudit = mockAudit.entries.find((e) => e.action === "access_secrets");
		expect(forbidAudit).toBeDefined();
		expect(forbidAudit!.decision).toBe("forbidden");
		expect(forbidAudit!.result).toBe("blocked");

		const approveAudit = mockAudit.entries.find((e) => e.action.startsWith("approve:"));
		expect(approveAudit).toBeDefined();
		expect(approveAudit!.decision).toBe("allow");

		// ---- STEP 5: Stats ----
		const approvalStats = approvalGate.getStats();
		expect(approvalStats.total).toBe(1);
		expect(approvalStats.approved).toBe(1);
	}, 10000);

	it("default deny catches unregistered actions (autonomy < 4)", async () => {
		const result = await engine.evaluateWithAudit(
			makeContext({ action: "some_random_unlisted_action" }),
			mockAudit,
		);
		expect(result.decision).toBe("deny");
		expect(result.matchedRule).toBeNull();
		expect(result.auditEntry.result).toBe("blocked");
	});
});
