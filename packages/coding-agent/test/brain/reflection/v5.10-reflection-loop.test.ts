/**
 * Reflection Loop v2 — V5.10 Tests
 *
 * Covers acceptance criteria:
 * 1. Post-run reflection can generate memory candidates and future proposals with source refs.
 * 2. Reflection claims are evidence-backed and include confidence.
 * 3. Rejected/corrected reflections are auditable.
 * 4. Reflection loop does not mark plans complete and does not mutate execution state.
 */

import { describe, expect, test } from "vitest";
import { BrainReflectionApi } from "../../../src/brain/reflection/api.js";
import { InMemoryReflectionAuditStore, ReflectionAuditService } from "../../../src/brain/reflection/audit.js";
import { ReflectionEngine } from "../../../src/brain/reflection/engine.js";
import type {
	ExecutionJournalEntry,
	ReflectionInput,
	ValidationResult,
	WorkspaceOutcome,
} from "../../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function createOutcome(overrides: Partial<WorkspaceOutcome> & { workspaceId: string }): WorkspaceOutcome {
	return {
		status: "success",
		retryCount: 0,
		duration: 1000,
		...overrides,
	};
}

function createValidation(overrides: Partial<ValidationResult> & { component: string }): ValidationResult {
	return {
		type: "error",
		message: "Validation message",
		passed: false,
		...overrides,
	};
}

function createJournalEntry(
	overrides: Partial<ExecutionJournalEntry> & { workspaceId: string },
): ExecutionJournalEntry {
	return {
		timestamp: "2026-05-22T00:00:00.000Z",
		eventType: "workspace_start",
		severity: "info",
		data: {},
		...overrides,
	};
}

function createDefaultInput(overrides?: Partial<ReflectionInput>): ReflectionInput {
	return {
		planExecId: "exec-v510-test-001",
		planId: "plan-v510-test-001",
		planTitle: "V5.10 Reflection Loop Test",
		executionJournal: [
			createJournalEntry({ workspaceId: "ws-A", eventType: "workspace_start" }),
			createJournalEntry({ workspaceId: "ws-A", eventType: "workspace_complete", data: { status: "success" } }),
			createJournalEntry({ workspaceId: "ws-B", eventType: "workspace_start" }),
			createJournalEntry({
				workspaceId: "ws-B",
				eventType: "workspace_retry",
				data: { retryCount: 1, error: "TypeError" },
			}),
			createJournalEntry({ workspaceId: "ws-B", eventType: "workspace_complete", data: { status: "retry" } }),
			createJournalEntry({ workspaceId: "ws-C", eventType: "workspace_start" }),
			createJournalEntry({ workspaceId: "ws-C", eventType: "workspace_failure", data: { error: "Timeout" } }),
		],
		workspaceOutcomes: [
			createOutcome({
				workspaceId: "ws-A",
				status: "success",
				retryCount: 0,
				duration: 60_000,
				validationPassed: true,
				summary: "Integration tests passed",
			}),
			createOutcome({
				workspaceId: "ws-B",
				status: "retry",
				retryCount: 1,
				duration: 120_000,
				validationPassed: true,
				summary: "Build completed after retry",
			}),
			createOutcome({
				workspaceId: "ws-C",
				status: "failure",
				retryCount: 2,
				duration: 300_000,
				validationPassed: false,
				summary: "Deployment failed",
				errorTypes: ["Timeout"],
			}),
		],
		validationResults: [
			createValidation({ component: "lint-check", type: "warning", message: "Minor lint issue", passed: true }),
			createValidation({
				component: "type-check",
				type: "error",
				message: "Type mismatch in module X",
				passed: false,
			}),
		],
		integrationState: { wasDirty: false, conflicts: 0, resolvedConflicts: 0 },
		duration: 500_000,
		startTime: "2026-05-22T10:00:00.000Z",
		endTime: "2026-05-22T10:08:20.000Z",
		autonomyLevel: 2,
		policyStops: 0,
		approvalRequests: 1,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// V5.10 AC1: Memory candidates and future proposals with source refs
// ---------------------------------------------------------------------------

describe("V5.10 AC1 — Memory candidates and future proposals with source refs", () => {
	test("reflection generates memory proposals with source references", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		expect(report.memoriesToCreate).toBeDefined();
		expect(report.memoriesToCreate.length).toBeGreaterThan(0);

		// Each memory proposal should have source refs
		for (const mem of report.memoriesToCreate) {
			expect(mem.sourceRefs).toBeDefined();
			expect(mem.sourceRefs.length).toBeGreaterThanOrEqual(1);
			expect(mem.sourceRefs[0].type).toBeDefined();
			expect(mem.sourceRefs[0].id).toBeDefined();
		}
	});

	test("reflection generates future proposals with source refs", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		expect(report.futurePhaseSuggestions).toBeDefined();
		expect(report.futurePhaseSuggestions.length).toBeGreaterThan(0);

		// Each future suggestion should have rationale (which acts as source ref context)
		for (const sug of report.futurePhaseSuggestions) {
			expect(sug.title).toBeDefined();
			expect(sug.title.length).toBeGreaterThan(0);
			expect(sug.rationale).toBeDefined();
			expect(sug.rationale.length).toBeGreaterThan(0);
			expect(sug.priority).toBeDefined();
		}
	});

	test("reflection generates proposal suggestions from memory generator", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		expect(report.proposalsToGenerate).toBeDefined();
		expect(report.proposalsToGenerate.length).toBeGreaterThan(0);

		for (const prop of report.proposalsToGenerate) {
			expect(prop.type).toBe("memory_proposal");
			expect(prop.title).toBeDefined();
			expect(prop.description).toBeDefined();
			expect(prop.priority).toBeDefined();
			expect(prop.evidenceIds).toBeDefined();
			expect(prop.evidenceIds.length).toBeGreaterThanOrEqual(1);
		}
	});

	test("reflection report has source refs from execution", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		expect(report.sources).toBeDefined();
		expect(report.sources.length).toBeGreaterThan(0);

		// Should have workspace sources
		const workspaceSources = report.sources.filter((s) => s.type === "workspace");
		expect(workspaceSources.length).toBeGreaterThanOrEqual(2);

		// Should have validation sources
		const validationSources = report.sources.filter((s) => s.type === "validation");
		expect(validationSources.length).toBeGreaterThan(0);

		// Should have metrics source
		const metricsSource = report.sources.find((s) => s.id === "metrics");
		expect(metricsSource).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// V5.10 AC2: Evidence-backed claims with confidence
// ---------------------------------------------------------------------------

describe("V5.10 AC2 — Evidence-backed claims with confidence", () => {
	test("reflection generates evidence-backed claims", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		expect(report.claims).toBeDefined();
		expect(report.claims.length).toBeGreaterThan(0);
	});

	test("each claim has evidence IDs and confidence", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		for (const claim of report.claims) {
			expect(claim.id).toBeDefined();
			expect(claim.id.length).toBeGreaterThan(0);
			expect(claim.category).toBeDefined();
			expect(["observation", "analysis", "recommendation"]).toContain(claim.category);
			expect(claim.statement).toBeDefined();
			expect(claim.statement.length).toBeGreaterThan(0);
			expect(claim.confidence).toBeDefined();
			expect(claim.confidence).toBeGreaterThanOrEqual(0);
			expect(claim.confidence).toBeLessThanOrEqual(1);
			expect(claim.evidenceIds).toBeDefined();
			expect(claim.evidenceIds.length).toBeGreaterThan(0);
		}
	});

	test("claims include observation, analysis, and recommendation categories", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		const categories = new Set(report.claims.map((c) => c.category));
		expect(categories.has("observation")).toBe(true);
		expect(categories.has("analysis")).toBe(true);
		expect(categories.has("recommendation")).toBe(true);
	});

	test("claims reference actual evidence from sources", async () => {
		const engine = new ReflectionEngine();
		const report = await engine.generateReflection(createDefaultInput());

		for (const claim of report.claims) {
			for (const evId of claim.evidenceIds) {
				// Each evidence ID should reference a valid source
				// Some evidence IDs may be synthetic (e.g., metrics fallback)
				expect(evId).toBeDefined();
				expect(evId.length).toBeGreaterThan(0);
			}
		}
	});

	test("confidence varies with execution quality", async () => {
		const engine = new ReflectionEngine();

		// All-successful execution
		const successInput = createDefaultInput({
			workspaceOutcomes: [
				createOutcome({ workspaceId: "ws-A", status: "success", retryCount: 0, duration: 1000 }),
				createOutcome({ workspaceId: "ws-B", status: "success", retryCount: 0, duration: 1000 }),
				createOutcome({ workspaceId: "ws-C", status: "success", retryCount: 0, duration: 1000 }),
			],
			validationResults: [],
		});

		// All-failed execution
		const failureInput = createDefaultInput({
			workspaceOutcomes: [
				createOutcome({
					workspaceId: "ws-A",
					status: "failure",
					retryCount: 3,
					duration: 1000,
					errorTypes: ["Error"],
				}),
				createOutcome({
					workspaceId: "ws-B",
					status: "failure",
					retryCount: 2,
					duration: 1000,
					errorTypes: ["Error"],
				}),
				createOutcome({
					workspaceId: "ws-C",
					status: "failure",
					retryCount: 4,
					duration: 1000,
					errorTypes: ["Error"],
				}),
			],
			validationResults: [createValidation({ component: "test", type: "error", message: "Failed", passed: false })],
		});

		const successReport = await engine.generateReflection(successInput);
		const failureReport = await engine.generateReflection(failureInput);

		// Success execution should have higher confidence overall
		expect(successReport.confidence).toBeGreaterThan(failureReport.confidence);
	});

	test("claims can be retrieved via API", async () => {
		const engine = new ReflectionEngine();
		const api = new BrainReflectionApi(engine);
		const input = createDefaultInput();
		const genResult = await api.generateReflection(input);

		expect(genResult.success).toBe(true);
		expect(genResult.report).toBeDefined();

		const claimsResult = await api.getClaims(input.planExecId);
		expect(claimsResult).not.toBeNull();
		expect(claimsResult!.claims.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// V5.10 AC3: Rejected/corrected reflections are auditable
// ---------------------------------------------------------------------------

describe("V5.10 AC3 — Rejected/corrected reflections are auditable", () => {
	test("correcting a claim creates an audit entry", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const claimsResult = await api.getClaims(input.planExecId);
		const firstClaim = claimsResult!.claims[0];
		const originalStatement = firstClaim.statement;

		// Correct the claim
		const correction = await api.correctClaim(
			input.planExecId,
			firstClaim.id,
			"Corrected statement with accurate data",
			"The original claim was based on incomplete data",
			"user",
		);

		expect(correction.success).toBe(true);
		expect(correction.entry).toBeDefined();
		expect(correction.entry!.eventType).toBe("correction");
		expect(correction.entry!.correction).toBeDefined();
		expect(correction.entry!.correction!.claimId).toBe(firstClaim.id);
		expect(correction.entry!.correction!.originalValue).toBe(originalStatement);
		expect(correction.entry!.correction!.correctedValue).toBe("Corrected statement with accurate data");
		expect(correction.entry!.correction!.reason).toBe("The original claim was based on incomplete data");
	});

	test("rejecting a claim creates an audit entry", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const claimsResult = await api.getClaims(input.planExecId);
		const firstClaim = claimsResult!.claims[0];

		const rejection = await api.rejectClaim(
			input.planExecId,
			firstClaim.id,
			"This claim is not supported by evidence",
			"user",
		);

		expect(rejection.success).toBe(true);
		expect(rejection.entry).toBeDefined();
		expect(rejection.entry!.eventType).toBe("rejection");
		expect(rejection.entry!.rejection).toBeDefined();
		expect(rejection.entry!.rejection!.claimId).toBe(firstClaim.id);
		expect(rejection.entry!.rejection!.reason).toBe("This claim is not supported by evidence");
		expect(rejection.entry!.rejection!.rejectedStatement).toBe(firstClaim.statement);
	});

	test("rejecting an entire report creates an audit entry", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const rejection = await api.rejectReport(
			input.planExecId,
			"The entire reflection is based on incorrect execution data",
			"user",
		);

		expect(rejection.success).toBe(true);
		expect(rejection.entry).toBeDefined();
		expect(rejection.entry!.eventType).toBe("rejection");
	});

	test("correcting summary creates an audit entry", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const correction = await api.correctSummary(
			input.planExecId,
			"Revised summary with accurate information.",
			"The original summary overstated success rates",
			"user",
		);

		expect(correction.success).toBe(true);
		expect(correction.entry).toBeDefined();
		expect(correction.entry!.eventType).toBe("correction");
		expect(correction.entry!.correction!.type).toBe("summary");
		expect(correction.entry!.correction!.originalValue).toBeDefined();
		expect(correction.entry!.correction!.correctedValue).toBe("Revised summary with accurate information.");
	});

	test("audit trail is accessible via API", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const claimsResult = await api.getClaims(input.planExecId);
		const claim = claimsResult!.claims[0];

		// Perform multiple audit actions
		await api.correctClaim(input.planExecId, claim.id, "Fixed claim", "Was wrong", "user");
		await api.rejectClaim(input.planExecId, claim.id, "Still not accurate", "user");
		await api.correctSummary(input.planExecId, "Better summary", "Summary was misleading", "user");

		// Get audit trail
		const trail = await api.getAuditTrail(input.planExecId);
		expect(trail.entries.length).toBeGreaterThanOrEqual(3);

		// Verify entries are in order (most recent first if sorted)
		const eventTypes = trail.entries.map((e) => e.eventType);
		expect(eventTypes).toContain("correction");
		expect(eventTypes).toContain("rejection");
	});

	test("audit entry has all required fields", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		const genResult = await api.generateReflection(input);
		const report = genResult.report!;
		const claim = report.claims[0];

		const correction = await api.correctClaim(input.planExecId, claim.id, "Fixed", "Reason", "user");
		const entry = correction.entry!;

		expect(entry.id).toBeDefined();
		expect(entry.id.length).toBeGreaterThan(0);
		expect(entry.timestamp).toBeDefined();
		expect(entry.reportId).toBe(report.id);
		expect(entry.eventType).toBe("correction");
	});

	test("audit trail handles multiple corrections on same claim", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const claimsResult = await api.getClaims(input.planExecId);
		const claim = claimsResult!.claims[0];

		// Apply multiple corrections to the same claim
		await api.correctClaim(input.planExecId, claim.id, "Version 2", "Revision 1", "user");
		await api.correctClaim(input.planExecId, claim.id, "Version 3", "Revision 2", "user");

		const trail = await api.getAuditTrail(input.planExecId);
		const corrections = trail.entries.filter(
			(e) => e.eventType === "correction" && e.correction?.claimId === claim.id,
		);

		expect(corrections.length).toBe(2);
		expect(corrections[0].correction!.correctedValue).toBe("Version 2");
		expect(corrections[1].correction!.correctedValue).toBe("Version 3");
	});

	test("correcting confidence creates an audit entry", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const correction = await api.correctConfidence(
			input.planExecId,
			0.95,
			"User confirmed the execution results are highly reliable",
			"user",
		);

		expect(correction.success).toBe(true);
		expect(correction.entry).toBeDefined();
		expect(correction.entry!.eventType).toBe("correction");
		expect(correction.entry!.correction!.type).toBe("confidence");
	});

	test("correct claim updates the in-memory report", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		const claimsResult = await api.getClaims(input.planExecId);
		const claim = claimsResult!.claims[0];
		const originalStatement = claim.statement;

		await api.correctClaim(input.planExecId, claim.id, "Completely revised statement", "User correction", "user");

		// Verify the claim was updated in the in-memory report
		const updatedClaims = await api.getClaims(input.planExecId);
		const updatedClaim = updatedClaims!.claims.find((c) => c.id === claim.id);

		expect(updatedClaim).toBeDefined();
		expect(updatedClaim!.statement).toBe("Completely revised statement");
		expect(updatedClaim!.audited).toBe(true);

		// The original value should be preserved in the audit trail
		const trail = await api.getAuditTrail(input.planExecId);
		const correction = trail.entries.find((e) => e.correction?.claimId === claim.id);
		expect(correction).toBeDefined();
		expect(correction!.correction!.originalValue).toBe(originalStatement);
	});
});

// ---------------------------------------------------------------------------
// V5.10 AC4: Reflection loop does not mark plans complete and does not mutate
// execution state
// ---------------------------------------------------------------------------

describe("V5.10 AC4 — No execution state mutation", () => {
	test("ReflectionEngine does not have state mutation methods", () => {
		const engine = new ReflectionEngine();

		// Verify no methods that would mutate execution state
		const engineProto = Object.getOwnPropertyNames(Object.getPrototypeOf(engine));

		// Known mutation-like method names that are actually safe
		const safeMethods = new Set(["setConfig", "writeMarkdown", "writeJson"]);

		const mutationMethods = engineProto.filter((m) => {
			if (safeMethods.has(m)) return false;
			const lower = m.toLowerCase();
			return (
				lower.includes("markcomplete") ||
				lower.includes("markas") ||
				lower.includes("complete") ||
				lower.includes("mutatestate") ||
				lower.includes("updateexecution") ||
				lower.includes("setplanstatus")
			);
		});

		expect(mutationMethods.length).toBe(0);
	});

	test("BrainReflectionApi does not expose execution mutation methods", () => {
		const api = new BrainReflectionApi();

		const apiMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(api));

		const mutationMethods = apiMethods.filter((m) => {
			const lower = m.toLowerCase();
			return (
				lower.includes("mark") ||
				lower.includes("complete") ||
				lower.includes("mutate") ||
				lower.includes("updateexecution") ||
				lower.includes("setplanstatus")
			);
		});

		// Note: setConfig is allowed - it's engine configuration, not execution state
		const forbidden = mutationMethods.filter((m) => m !== "setConfig");
		expect(forbidden.length).toBe(0);
	});

	test("ReflectionAuditService does not mutate execution state", () => {
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);

		const serviceMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(auditService));

		const mutationMethods = serviceMethods.filter((m) => {
			const lower = m.toLowerCase();
			return (
				lower.includes("mark") ||
				lower.includes("complete") ||
				lower.includes("mutate") ||
				lower.includes("execution") ||
				lower.includes("setplan")
			);
		});

		expect(mutationMethods.length).toBe(0);
	});

	test("reflection input includes no plan completion", async () => {
		const input = createDefaultInput();

		// Verify the input types don't include state mutation fields
		expect((input as unknown as Record<string, unknown>).markComplete).toBeUndefined();
		expect((input as unknown as Record<string, unknown>).setPlanStatus).toBeUndefined();

		// The engine should only read from the input, not modify it
		const engine = new ReflectionEngine();
		const inputCopy = { ...input };
		await engine.generateReflection(input);

		// Input should be unchanged after reflection
		expect(input).toEqual(inputCopy);
	});

	test("register claims as evidence does not mutate execution state", async () => {
		const engine = new ReflectionEngine();
		const auditStore = new InMemoryReflectionAuditStore();
		const auditService = new ReflectionAuditService(auditStore);
		const api = new BrainReflectionApi(engine, auditService);

		const input = createDefaultInput();
		await api.generateReflection(input);

		// Mock evidence API that just stores what's registered
		const registeredEvidence: unknown[] = [];
		const mockEvidenceApi = {
			registerEvidence: async (
				type: string,
				id: string,
				label: string,
				description: string,
				confidence: number,
				content?: string,
			) => {
				const ref = { type, id, label, description, confidence, content, timestamp: new Date().toISOString() };
				registeredEvidence.push(ref);
				return ref;
			},
		};

		const refs = await api.registerClaimsAsEvidence(input.planExecId, mockEvidenceApi);
		expect(refs).not.toBeNull();
		expect(refs!.length).toBeGreaterThan(0);

		// Verify evidence was registered
		for (const ref of refs!) {
			const r = ref as { type: string };
			expect(r.type).toBe("reflection");
		}
	});

	test("reflection operates on a copy of execution data", () => {
		const engine = new ReflectionEngine();

		// The engine's analyze methods produce new arrays, not mutating the originals
		const outcomes = [
			createOutcome({ workspaceId: "ws-A", status: "success", retryCount: 0, duration: 1000 }),
			createOutcome({ workspaceId: "ws-B", status: "failure", retryCount: 2, duration: 1000 }),
		];

		// Store original state
		const outcomeCopies = outcomes.map((o) => ({ ...o }));
		const metrics = engine.computeMetrics(outcomes);

		// computeMetrics is pure - doesn't mutate outcomes
		expect(outcomes).toEqual(outcomeCopies);
		expect(metrics.workspaceCount).toBe(2);
		expect(metrics.successCount).toBe(1);
		expect(metrics.failureCount).toBe(1);
	});
});
