/**
 * User Protocol Actions — P15.F — Tests
 *
 * Covers:
 * - Morning protocol: getMorningData, generateMorningMarkdown
 * - Daytime protocol: processApproval, processRejection, processMemoryCorrection
 * - Night protocol: configureNightRun, startNightRun, checkNightRunStatus
 * - Explain: explainDecision
 * - Constants: ALL_NIGHT_PROTOCOL_STOP_CONDITIONS, DEFAULT_NIGHT_MAX_DURATION_HOURS
 * - Error handling: missing required params, invalid states
 */

import { describe, expect, test } from "vitest";
import { DecisionClassifier } from "../../../src/brain/goals/decisions.js";
import { AutonomyEngine } from "../../../src/brain/goals/profile-engine.js";
import {
	ALL_NIGHT_PROTOCOL_STOP_CONDITIONS,
	DEFAULT_NIGHT_MAX_DURATION_HOURS,
	DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS,
	UserProtocol,
} from "../../../src/brain/goals/protocol.js";
import { GoalStore } from "../../../src/brain/goals/store.js";

// ---------------------------------------------------------------------------
// Constants tests
// ---------------------------------------------------------------------------

describe("constants", () => {
	test("ALL_NIGHT_PROTOCOL_STOP_CONDITIONS contains all expected conditions", () => {
		const conditions = ALL_NIGHT_PROTOCOL_STOP_CONDITIONS.map((s) => s.condition);
		expect(conditions).toContain("integration_queue_dirty");
		expect(conditions).toContain("merge_conflict");
		expect(conditions).toContain("policy_violation");
		expect(conditions).toContain("low_confidence_unsafe");
		expect(conditions).toContain("user_intervention");
		expect(conditions).toContain("error_threshold_exceeded");
	});

	test("DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS contains a subset", () => {
		expect(DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS.length).toBeGreaterThan(0);
		expect(DEFAULT_NIGHT_PROTOCOL_STOP_CONDITIONS.length).toBeLessThanOrEqual(
			ALL_NIGHT_PROTOCOL_STOP_CONDITIONS.length,
		);
	});

	test("DEFAULT_NIGHT_MAX_DURATION_HOURS is 8", () => {
		expect(DEFAULT_NIGHT_MAX_DURATION_HOURS).toBe(8);
	});
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe("UserProtocol — construction", () => {
	test("creates with required dependencies", () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);
		expect(protocol).toBeInstanceOf(UserProtocol);
	});

	test("creates with all dependencies", () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const classifier = new DecisionClassifier();
		const protocol = new UserProtocol(store, engine, classifier);
		expect(protocol).toBeInstanceOf(UserProtocol);
	});
});

// ---------------------------------------------------------------------------
// Morning Protocol
// ---------------------------------------------------------------------------

describe("UserProtocol — morning protocol", () => {
	test("getMorningData returns structured data with date", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const data = await protocol.getMorningData();

		expect(data).toHaveProperty("date");
		expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(data.whatRan).toBeInstanceOf(Array);
		expect(data.whatCompleted).toBeInstanceOf(Array);
		expect(data.whatStopped).toBeInstanceOf(Array);
		expect(data.whatChanged).toBeInstanceOf(Array);
		expect(data.whatLearned).toBeInstanceOf(Array);
		expect(data.needsApproval).toBeInstanceOf(Array);
		expect(data.top3NextActions).toBeInstanceOf(Array);
		expect(data.artifactLinks).toBeInstanceOf(Array);
	});

	test("generateMorningMarkdown returns a string", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const markdown = await protocol.generateMorningMarkdown();

		expect(typeof markdown).toBe("string");
		expect(markdown.length).toBeGreaterThan(0);
		expect(markdown).toContain("# Morning Report");
	});

	test("morning report includes needs approval items when pending", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		// Register a pending approval
		protocol.registerPendingApproval("proposal-1", "Test approval needed", "system");

		const data = await protocol.getMorningData();
		expect(data.needsApproval.length).toBe(1);
		expect(data.needsApproval[0]!.id).toBe("proposal-1");
		expect(data.needsApproval[0]!.description).toBe("Test approval needed");
	});
});

// ---------------------------------------------------------------------------
// Daytime Protocol — Approvals
// ---------------------------------------------------------------------------

describe("UserProtocol — daytime approvals", () => {
	test("processApproval throws without by", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processApproval("req-1", true, "")).rejects.toThrow("Approver identity (by) is required");
	});

	test("processApproval throws for unknown request", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processApproval("nonexistent", true, "user")).rejects.toThrow("No pending approval found");
	});

	test("processApproval approves and removes pending", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const requestId = protocol.registerPendingApproval("proposal-1", "Test", "system");
		expect(protocol.getPendingApprovals().size).toBe(1);

		await protocol.processApproval(requestId, true, "user");
		expect(protocol.getPendingApprovals().size).toBe(0);
	});

	test("processApproval rejection triggers processRejection", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const requestId = protocol.registerPendingApproval("proposal-1", "Test", "system");

		await protocol.processApproval(requestId, false, "user");
		// Rejection should have been recorded
		expect(protocol.getRejectionRecords().length).toBeGreaterThanOrEqual(1);
		const rejection = protocol.getRejectionRecords().find((r) => r.proposalId === "proposal-1");
		expect(rejection).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Daytime Protocol — Rejections
// ---------------------------------------------------------------------------

describe("UserProtocol — daytime rejections", () => {
	test("processRejection creates a record", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const record = await protocol.processRejection("proposal-1", "user", "Not relevant");

		expect(record).toHaveProperty("id");
		expect(record.proposalId).toBe("proposal-1");
		expect(record.rejectionReason).toBe("Not relevant");
		expect(record.suppressSimilar).toBe(true);
		expect(record.memoryUpdated).toBe(false);
	});

	test("processRejection categorizes by reason", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const duplicate = await protocol.processRejection("p1", "user", "This is a duplicate");
		expect(duplicate.category).toBe("duplicate");

		const policy = await protocol.processRejection("p2", "user", "Policy violation");
		expect(policy.category).toBe("policy");

		const quality = await protocol.processRejection("p3", "user", "Low quality proposal");
		expect(quality.category).toBe("low_quality");

		const other = await protocol.processRejection("p4", "user", "Some other reason");
		expect(other.category).toBe("other");

		const none = await protocol.processRejection("p5", "user");
		expect(none.category).toBe("unspecified");
	});

	test("processRejection throws without proposalId", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processRejection("", "user")).rejects.toThrow("proposalId is required");
	});

	test("processRejection throws without by", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processRejection("p1", "")).rejects.toThrow("Rejector identity (by) is required");
	});
});

// ---------------------------------------------------------------------------
// Daytime Protocol — Memory Corrections
// ---------------------------------------------------------------------------

describe("UserProtocol — memory corrections", () => {
	test("processMemoryCorrection creates a record", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const record = await protocol.processMemoryCorrection("mem-1", "Corrected data", "user");

		expect(record).toHaveProperty("id");
		expect(record.originalMemoryId).toBe("mem-1");
		expect(record.reason).toBe("Corrected data");
		expect(record.action).toBe("corrected");
		expect(record.createdBy).toBe("user");
	});

	test("processMemoryCorrection throws without memoryId", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processMemoryCorrection("", "correction", "user")).rejects.toThrow("memoryId is required");
	});

	test("processMemoryCorrection throws without by", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.processMemoryCorrection("mem-1", "correction", "")).rejects.toThrow(
			"Corrector identity (by) is required",
		);
	});
});

// ---------------------------------------------------------------------------
// Night Protocol
// ---------------------------------------------------------------------------

describe("UserProtocol — night protocol", () => {
	test("configureNightRun creates a session", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const { sessionId } = await protocol.configureNightRun({
			queue: ["plan-1", "plan-2"],
			autonomyLevel: 2,
			stopConditions: ["integration_queue_dirty", "merge_conflict"],
			maxDurationHours: 8,
			generateMorningReport: true,
		});

		expect(sessionId).toBeDefined();
		expect(typeof sessionId).toBe("string");
	});

	test("configureNightRun throws for empty queue", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(
			protocol.configureNightRun({
				queue: [],
				autonomyLevel: 2,
				stopConditions: [],
				maxDurationHours: 8,
				generateMorningReport: true,
			}),
		).rejects.toThrow("Queue must contain at least one plan ID");
	});

	test("configureNightRun throws for invalid autonomy level", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(
			protocol.configureNightRun({
				queue: ["plan-1"],
				autonomyLevel: 5 as 1 | 2 | 3 | 4,
				stopConditions: [],
				maxDurationHours: 8,
				generateMorningReport: true,
			}),
		).rejects.toThrow("Invalid autonomy level");
	});

	test("configureNightRun throws for invalid maxDurationHours", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(
			protocol.configureNightRun({
				queue: ["plan-1"],
				autonomyLevel: 2,
				stopConditions: [],
				maxDurationHours: 0,
				generateMorningReport: true,
			}),
		).rejects.toThrow("maxDurationHours must be between 1 and 24");
	});

	test("startNightRun transitions from configured to running", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const { sessionId } = await protocol.configureNightRun({
			queue: ["plan-1"],
			autonomyLevel: 2,
			stopConditions: [],
			maxDurationHours: 8,
			generateMorningReport: true,
		});

		await protocol.startNightRun(sessionId);

		const status = await protocol.checkNightRunStatus(sessionId);
		expect(status.status).toBe("running");
	});

	test("startNightRun throws for unknown session", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.startNightRun("nonexistent")).rejects.toThrow("Night run session not found");
	});

	test("startNightRun throws for already started session", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const { sessionId } = await protocol.configureNightRun({
			queue: ["plan-1"],
			autonomyLevel: 2,
			stopConditions: [],
			maxDurationHours: 8,
			generateMorningReport: true,
		});

		await protocol.startNightRun(sessionId);
		await expect(protocol.startNightRun(sessionId)).rejects.toThrow('expected "configured"');
	});

	test("checkNightRunStatus returns progress", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const { sessionId } = await protocol.configureNightRun({
			queue: ["plan-1"],
			autonomyLevel: 2,
			stopConditions: [],
			maxDurationHours: 8,
			generateMorningReport: true,
		});

		const status = await protocol.checkNightRunStatus(sessionId);
		expect(status).toHaveProperty("status");
		expect(status).toHaveProperty("progress");
		expect(typeof status.progress).toBe("number");
	});

	test("checkNightRunStatus throws for unknown session", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		await expect(protocol.checkNightRunStatus("nonexistent")).rejects.toThrow("Night run session not found");
	});
});

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

describe("UserProtocol — explain decision", () => {
	test("explainDecision returns explanation with fallback when no classifier", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const explanation = await protocol.explainDecision("plan_execution", { autonomyLevel: 2 });

		expect(explanation).toHaveProperty("action", "plan_execution");
		expect(explanation).toHaveProperty("decision");
		expect(explanation).toHaveProperty("reasoning");
		expect(explanation).toHaveProperty("applicableRules");
		expect(explanation).toHaveProperty("autonomyLevel", 2);
		expect(explanation).toHaveProperty("appealOptions");
		expect(explanation.appealOptions.length).toBeGreaterThan(0);
	});

	test("explainDecision uses classifier when provided", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const classifier = new DecisionClassifier();
		const protocol = new UserProtocol(store, engine, classifier);

		const explanation = await protocol.explainDecision("secret_access", { autonomyLevel: 2 });

		expect(explanation.action).toBe("secret_access");
		expect(explanation.decision.decisionClass).toBe("never_auto_decide");
	});

	test("explainDecision returns appeal options for each class", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const classifier = new DecisionClassifier();
		const protocol = new UserProtocol(store, engine, classifier);

		const forbidden = await protocol.explainDecision("secret_access", { autonomyLevel: 2 });
		expect(forbidden.appealOptions.length).toBeGreaterThanOrEqual(2);

		const approval = await protocol.explainDecision("execute_generated_plan", { autonomyLevel: 2 });
		expect(approval.appealOptions.length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// Rejection Records Accessor
// ---------------------------------------------------------------------------

describe("UserProtocol — rejection records", () => {
	test("getRejectionRecords returns recorded rejections", async () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		expect(protocol.getRejectionRecords()).toBeInstanceOf(Array);
		expect(protocol.getRejectionRecords().length).toBe(0);

		await protocol.processRejection("p1", "user", "Test");
		expect(protocol.getRejectionRecords().length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Pending Approvals
// ---------------------------------------------------------------------------

describe("UserProtocol — pending approvals", () => {
	test("registerPendingApproval creates a request and returns ID", () => {
		const store = new GoalStore();
		const engine = new AutonomyEngine();
		const protocol = new UserProtocol(store, engine);

		const requestId = protocol.registerPendingApproval("proposal-1", "Test approval", "system");
		expect(requestId).toBeDefined();
		expect(typeof requestId).toBe("string");

		const pending = protocol.getPendingApprovals();
		expect(pending.size).toBe(1);
		expect(pending.get(requestId)?.proposalId).toBe("proposal-1");
	});
});
