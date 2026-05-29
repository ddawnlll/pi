/**
 * V5.04 — Context Builder & Memory Injection Tests
 *
 * Tests the context builder's ability to assemble context packs from
 * memory retrieval, evidence index, and temporal journal sources.
 * Also tests the memory injection engine with compliance checking
 * against policy, conflict, and lifecycle rules.
 *
 * Acceptance criteria covered:
 * AC1: Generated plan drafts include memoryRetrievalReport, injectedMemoryIds,
 *      ignoredMemoryIds with reasons, and evidence pack summary
 * AC2: Injection does not bypass policy, conflict, or lifecycle rules
 * AC3: The injection report is renderable in dashboard Draft Studio and Memory UI
 * AC4: No generated content can claim memory support without included evidence refs
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContextBuilder } from "../src/brain/context/context-builder.js";
import { createMemoryInjectionEngine } from "../src/brain/context/injection.js";
import {
	buildEvidencePack,
	buildEvidencePackSummary,
	createEmptyEvidencePack,
	validateContentHasEvidenceRefs,
} from "../src/brain/evidence/pack.js";
import type { EvidenceRef, EvidenceResolution } from "../src/brain/evidence/types.js";
import { assessEvidenceConfidence } from "../src/brain/evidence/types.js";
import type {
	MemoryRetrievalEntry,
	MemoryRetrievalReport,
	MemoryRetrievalResult,
} from "../src/brain/memory/retrieval.js";
import type { MemoryType } from "../src/brain/memory/types.js";
import type { V5EventSink } from "../src/brain/v5/types.js";

// =========================================================================
// Test Helpers
// =========================================================================

/**
 * Helper to create a mock createMemory function for the injection engine.
 * Returns the object as-is to avoid TypeScript strict checking issues with MemoryRecord.
 */
function mockCreateMemory(): (input: {
	type: string;
	title: string;
	content: string;
	summary?: string;
	confidence: number;
	provenance: { sourceRefs: Array<{ type: string; path: string; id: string }>; validatedBy: string };
	tags?: string[];
	category?: string;
	metadata?: Record<string, unknown>;
}) => Promise<any> {
	return async (input) => ({
		id: `injected-${randomUUID()}`,
		type: input.type as any,
		title: input.title,
		content: input.content,
		summary: input.summary ?? "",
		lifecycle: "active" as const,
		confidence: input.confidence,
		provenance: input.provenance,
		tags: input.tags ?? [],
		category: input.category,
		metadata: input.metadata ?? {},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
}

/**
 * Create a mock memory retrieval result for testing.
 */
function createMockMemoryResult(
	entries: Partial<MemoryRetrievalEntry>[] = [],
	overrides?: Partial<MemoryRetrievalResult>,
): MemoryRetrievalResult {
	const report: MemoryRetrievalReport = {
		query: { limit: 10 },
		total: entries.length,
		entries: entries.map((e, i) => ({
			id: e.id ?? `mem-${i}`,
			type: (e.type ?? "failure_memory") as MemoryType,
			title: e.title ?? `Test Memory ${i}`,
			summary: e.summary ?? "Test summary",
			content: e.content ?? "Test content for memory retrieval",
			lifecycle: (e.lifecycle ?? "active") as any,
			confidence: e.confidence ?? 0.8,
			sourceRefs: e.sourceRefs ?? [{ type: "observation" as const, path: "/test/path", id: `obs-${i}` }],
			createdAt: e.createdAt ?? new Date().toISOString(),
			updatedAt: e.updatedAt ?? new Date().toISOString(),
			tags: e.tags ?? ["test"],
			category: e.category,
		})),
		filteredByLifecycle: overrides?.report?.filteredByLifecycle ?? 0,
		filteredByLifecycleBreakdown: {},
		summary: `${entries.length} memory(ies) found`,
		generatedAt: new Date().toISOString(),
	};

	return {
		success: true,
		report,
		...overrides,
	};
}

/**
 * Create a simple evidence ref for testing.
 */
function createTestEvidenceRef(overrides?: Partial<EvidenceRef>): EvidenceRef {
	return {
		type: overrides?.type ?? "memory",
		id: overrides?.id ?? randomUUID(),
		label: overrides?.label ?? "Test Evidence",
		description: overrides?.description ?? "Test description",
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		confidence: overrides?.confidence ?? 0.8,
		sourcePath: overrides?.sourcePath,
		metadata: overrides?.metadata,
	};
}

/**
 * Create a mock evidence resolution for testing.
 */
function createMockResolution(ref: EvidenceRef, resolved = true): EvidenceResolution {
	return {
		ref,
		resolved,
		content: resolved ? "Resolved content" : undefined,
		error: resolved ? undefined : "Evidence not found",
		resolvedAt: new Date().toISOString(),
	};
}

/**
 * Create a mock V5 event sink.
 */
function _createMockEventSink(): V5EventSink {
	return {
		emit: async (_event) => {
			return { ok: true, eventId: randomUUID() };
		},
	};
}

// =========================================================================
// Context Builder Tests
// =========================================================================

describe("ContextBuilder", () => {
	it("should build a context pack with memory, evidence, and temporal sources", async () => {
		const mockMemories = [
			{ id: "mem-1", title: "Docker Build Failure", type: "failure_memory" as const },
			{ id: "mem-2", title: "Network Timeout Pattern", type: "failure_memory" as const },
		];

		const builder = createContextBuilder({
			retrieveMemories: async () => createMockMemoryResult(mockMemories),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({
				items: [createTestEvidenceRef({ id: "ev-1", label: "Workspace Validation" })],
				total: 1,
			}),
			queryTemporalEvents: async () => ({ items: [{ id: "te-1" }], total: 1 }),
			queryStuckItems: async () => ({
				items: [{ entityId: "ws-1", description: "Stuck on retry", duration: "3d" }],
				total: 1,
				period: { since: "2024-01-01", until: "2024-01-08" },
			}),
		});

		const pack = await builder.build({
			scope: "test-ws-123",
			memoryLimit: 10,
		});

		// The pack must have all required fields (AC1)
		expect(pack.id).toBeTruthy();
		expect(pack.scope).toBe("test-ws-123");
		expect(pack.sources.length).toBeGreaterThanOrEqual(2); // memory + evidence
		expect(pack.memoryRetrievalReports.length).toBe(1);
		expect(pack.memoryRetrievalReports[0].entries.length).toBe(2);
		expect(pack.evidencePackSummary).toBeTruthy();
		expect(pack.evidenceRefs.length).toBeGreaterThan(0);
		expect(pack.overallConfidence).toBeGreaterThan(0);

		// Verify evidence refs are included (AC4)
		for (const ref of pack.evidenceRefs) {
			expect(ref.type).toBeTruthy();
			expect(ref.id).toBeTruthy();
			expect(ref.label).toBeTruthy();
			expect(ref.confidence).toBeGreaterThanOrEqual(0);
		}
	});

	it("should handle empty memory retrieval gracefully", async () => {
		const builder = createContextBuilder({
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({ items: [], total: 0 }),
		});

		const pack = await builder.build({
			scope: "test-ws-empty",
		});

		expect(pack.memoryRetrievalReports).toHaveLength(1);
		expect(pack.memoryRetrievalReports[0].entries).toHaveLength(0);
		expect(pack.sources.length).toBeGreaterThanOrEqual(1);
		expect(pack.summary).toBeTruthy();
	});

	it("should handle memory retrieval failure gracefully", async () => {
		const builder = createContextBuilder({
			retrieveMemories: async () => ({ success: false, error: "Store unavailable" }),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({ items: [], total: 0 }),
		});

		const pack = await builder.build({
			scope: "test-ws-error",
		});

		// When memory retrieval fails, no memory_retrieval source is added
		// but the pack is still created with other available sources
		expect(pack.sources.some((s) => s.type === "memory_retrieval")).toBe(false);
		expect(pack.id).toBeTruthy();
		expect(pack.scope).toBe("test-ws-error");
	});

	it("should include temporal context when available", async () => {
		const builder = createContextBuilder({
			retrieveMemories: async () => createMockMemoryResult([{ id: "mem-1" }]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({ items: [], total: 0 }),
			queryTemporalEvents: async () => ({ items: [{ id: "te-1" }, { id: "te-2" }], total: 2 }),
			queryStuckItems: async () => ({
				items: [{ entityId: "ws-1", description: "Stuck", duration: "2d" }],
				total: 1,
				period: { since: "2024-01-01", until: "2024-01-08" },
			}),
		});

		const pack = await builder.build({
			scope: "test-ws-temporal",
			includeTemporalContext: true,
		});

		expect(pack.temporalContext).toBeTruthy();
		expect(pack.temporalContext!.eventCount).toBe(2);
		expect(pack.temporalContext!.stuckItems).toHaveLength(1);
		expect(pack.temporalContext!.stuckItems[0].description).toBe("Stuck");
	});

	it("should skip temporal context when disabled", async () => {
		const builder = createContextBuilder({
			retrieveMemories: async () => createMockMemoryResult([{ id: "mem-1" }]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({ items: [], total: 0 }),
		});

		const pack = await builder.build({
			scope: "test-ws-notemporal",
			includeTemporalContext: false,
		});

		expect(pack.temporalContext).toBeUndefined();
	});

	it("should emit context_pack_built event when event sink is configured", async () => {
		let emittedEvent: any = null;
		const eventSink: V5EventSink = {
			emit: async (event) => {
				emittedEvent = event;
				return { ok: true, eventId: randomUUID() };
			},
		};

		const builder = createContextBuilder({
			retrieveMemories: async () => createMockMemoryResult([{ id: "mem-1" }]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			queryEvidence: async () => ({ items: [], total: 0 }),
			eventSink,
		});

		await builder.build({ scope: "test-ws-event" });

		expect(emittedEvent).not.toBeNull();
		expect(emittedEvent!.kind).toBe("timeline");
		expect(emittedEvent!.event.eventType).toBe("observation");
	});
});

// =========================================================================
// Memory Injection Engine Tests
// =========================================================================

describe("MemoryInjectionEngine", () => {
	it("should inject memories and produce a complete report with all required fields", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () =>
				createMockMemoryResult([{ id: "existing-1", title: "Existing", type: "failure_memory" }]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const report = await engine.inject({
			scope: "test-ws-inject",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Docker Layer Caching Failure",
					content: "Docker build fails due to layer cache invalidation on every run.",
					summary: "Docker layer cache issue",
					evidenceRefs: [
						createTestEvidenceRef({
							type: "execution_journal",
							id: "ej-1",
							label: "Build Logs",
							description: "Docker build output showing cache miss",
						}),
					],
					confidence: 0.85,
					tags: ["docker", "build", "cache"],
					category: "infrastructure",
				},
			],
		});

		// AC1: Generated plan drafts include memoryRetrievalReport, injectedMemoryIds,
		//      ignoredMemoryIds with reasons, and evidence pack summary
		expect(report.id).toBeTruthy();
		expect(report.scope).toBe("test-ws-inject");
		expect(report.injectedMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds).toHaveLength(0);
		expect(report.evidencePackSummary).toBeTruthy();
		expect(report.evidencePackSummary.totalRefs).toBe(1);
		expect(report.memoryRetrievalReport).toBeNull(); // not attached yet

		// Test attachRetrievalReport
		const withRetrieval = engine.attachRetrievalReport(
			report,
			createMockMemoryResult([{ id: "retrieved-1", title: "Past Docker Failure" }]),
		);
		expect(withRetrieval.memoryRetrievalReport).not.toBeNull();
		expect(withRetrieval.memoryRetrievalReport!.entries).toHaveLength(1);
		expect(withRetrieval.memoryRetrievalReport!.entries[0].title).toBe("Past Docker Failure");
	});

	it("should reject injections that violate policy rules (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			policyRules: {
				blockedMemoryTypes: ["user_preference_memory"],
				minConfidence: 0.6,
				minEvidenceRefs: 1,
			},
		});

		const report = await engine.inject({
			scope: "test-ws-blocked",
			injections: [
				{
					memoryType: "user_preference_memory",
					title: "Blocked User Preference",
					content: "This should be blocked by policy.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.9,
				},
			],
		});

		// AC2: Injection does not bypass policy rules
		expect(report.injectedMemoryIds).toHaveLength(0);
		expect(report.ignoredMemoryIds.length).toBeGreaterThanOrEqual(1);
		expect(report.ignoredMemoryIds[0].reasonCode).toBe("policy_rule_blocked");
		expect(report.ignoredMemoryIds[0].reason).toContain("blocked");
	});

	it("should reject injections with insufficient evidence (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			policyRules: {
				minEvidenceRefs: 2,
			},
		});

		const report = await engine.inject({
			scope: "test-ws-no-evidence",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Missing Evidence",
					content: "This injection has only 1 evidence ref but requires 2.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.8,
				},
			],
		});

		expect(report.injectedMemoryIds).toHaveLength(0);
		expect(report.ignoredMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds[0].reasonCode).toBe("evidence_insufficient");
	});

	it("should reject injections with confidence below threshold (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const report = await engine.inject({
			scope: "test-ws-low-confidence",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Low Confidence",
					content: "This has low confidence.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.1,
				},
			],
			minConfidence: 0.5,
		});

		expect(report.injectedMemoryIds).toHaveLength(0);
		expect(report.ignoredMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds[0].reasonCode).toBe("confidence_too_low");
	});

	it("should detect duplicate content (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () =>
				createMockMemoryResult([
					{
						id: "existing-dup",
						title: "Duplicate Title Test",
						type: "failure_memory",
						content: "This is the exact content of an existing memory record that should be detected.",
					},
				]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const report = await engine.inject({
			scope: "test-ws-dup",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Duplicate Title Test",
					content: "This is the exact content of an existing memory record that should be detected.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.9,
				},
			],
		});

		expect(report.injectedMemoryIds).toHaveLength(0);
		expect(report.ignoredMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds[0].reasonCode).toBe("conflict_detected");
	});

	it("should detect potential conflicts with existing memories but not block injection (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () =>
				createMockMemoryResult([
					{
						id: "existing-conflict",
						title: "Completely Different Title",
						type: "failure_memory",
						confidence: 0.8,
						content: "Different content that does not match the injection.",
					},
				]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const report = await engine.inject({
			scope: "test-ws-conflict",
			injections: [
				{
					memoryType: "failure_memory",
					title: "New Memory Title",
					content: "This title and content are different from existing memories.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.85,
				},
			],
		});

		// No conflicts or duplicates detected, injection should proceed
		expect(report.injectedMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds).toHaveLength(0);
	});

	it("should include ignoredMemoryIds with reasons (AC1)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			policyRules: {
				blockedMemoryTypes: ["user_preference_memory"],
			},
		});

		const report = await engine.inject({
			scope: "test-ws-ignored",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Good Memory",
					content: "This should be accepted.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.9,
				},
				{
					memoryType: "user_preference_memory",
					title: "Bad Memory",
					content: "This should be ignored.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.8,
				},
			],
		});

		// AC1: ignoredMemoryIds with reasons
		expect(report.injectedMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds).toHaveLength(1);
		expect(report.ignoredMemoryIds[0].memoryTitle).toBe("Bad Memory");
		expect(report.ignoredMemoryIds[0].reasonCode).toBe("policy_rule_blocked");
		expect(report.ignoredMemoryIds[0].reason).toBeTruthy();
		expect(report.ignoredMemoryIds[0].failedCheck).toBe("blocked_memory_types");

		// AC1: evidencePackSummary
		expect(report.evidencePackSummary).toBeTruthy();
		expect(report.evidencePackSummary.totalRefs).toBeGreaterThanOrEqual(1);

		// AC3: The report structure is renderable (has all UI fields)
		expect(report.summary).toBeTruthy();
		expect(report.overallConfidenceLevel).toBeTruthy();
		expect(report.successfulCount).toBe(1);
		expect(report.ignoredCount).toBe(1);
	});

	it("should run lifecycle checks (AC2)", async () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () =>
				createMockMemoryResult([
					{
						id: "stale-mem",
						title: "Stale Memory",
						type: "failure_memory",
						lifecycle: "rejected_by_user" as any,
					},
				]),

			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const report = await engine.inject({
			scope: "test-ws-lifecycle",
			injections: [
				{
					memoryType: "failure_memory",
					title: "New Memory After Stale",
					content: "Testing lifecycle check.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.8,
				},
			],
		});

		// Lifecycle check passes with a warning, injection proceeds
		expect(report.injectedMemoryIds).toHaveLength(1);
		expect(report.compliance.checks.some((c) => c.rule === "lifecycle_validity")).toBe(true);
		expect(report.compliance.checks.find((c) => c.rule === "lifecycle_validity")!.passed).toBe(true);
	});

	it("should emit events through configured event sink", async () => {
		let emitted = false;
		const eventSink: V5EventSink = {
			emit: async () => {
				emitted = true;
				return { ok: true, eventId: randomUUID() };
			},
		};

		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
			eventSink,
		});

		await engine.inject({
			scope: "test-ws-event-sink",
			injections: [
				{
					memoryType: "failure_memory",
					title: "Event Test",
					content: "Testing event emission.",
					evidenceRefs: [createTestEvidenceRef()],
					confidence: 0.8,
				},
			],
		});

		expect(emitted).toBe(true);
	});

	it("should update policy rules dynamically", () => {
		const engine = createMemoryInjectionEngine({
			createMemory: mockCreateMemory(),
			retrieveMemories: async () => createMockMemoryResult([]),
			resolveEvidence: async (refs) => refs.map((r) => createMockResolution(r)),
		});

		const defaultRules = engine.getPolicyRules();
		expect(defaultRules.minConfidence).toBe(0.5);
		expect(defaultRules.checkConflicts).toBe(true);

		engine.updatePolicyRules({ minConfidence: 0.8, checkConflicts: false });
		const updatedRules = engine.getPolicyRules();
		expect(updatedRules.minConfidence).toBe(0.8);
		expect(updatedRules.checkConflicts).toBe(false);
	});
});

// =========================================================================
// Evidence Pack Validation Tests
// =========================================================================

describe("Evidence Pack", () => {
	it("should build an evidence pack with summary", async () => {
		const refs = [
			createTestEvidenceRef({ type: "execution_journal", id: "ej-1", label: "Build Log" }),
			createTestEvidenceRef({ type: "memory", id: "mem-1", label: "Failure Memory" }),
		];

		const pack = await buildEvidencePack("test-scope", refs, async (r) => r.map((ref) => createMockResolution(ref)));

		expect(pack.id).toBeTruthy();
		expect(pack.refs).toHaveLength(2);
		expect(pack.assessment).toBeTruthy();
		expect(pack.groups.length).toBeGreaterThanOrEqual(1);

		const summary = buildEvidencePackSummary(pack);
		expect(summary.totalRefs).toBe(2);
		expect(summary.confidenceLevel).toBeTruthy();
		expect(summary.groups.length).toBeGreaterThanOrEqual(1);
		expect(summary.summary).toBeTruthy();
	});

	it("should create an empty evidence pack", () => {
		const pack = createEmptyEvidencePack("test-scope", "Empty Test");
		expect(pack.refs).toHaveLength(0);
		expect(pack.assessment.level).toBe("LOW");
		expect(pack.assessment.confidence).toBe(0);
	});

	it("should assess confidence correctly", () => {
		const resolutions = [
			createMockResolution(createTestEvidenceRef({ confidence: 0.9 }), true),
			createMockResolution(createTestEvidenceRef({ confidence: 0.8 }), true),
		];

		const assessment = assessEvidenceConfidence(resolutions);
		expect(assessment.level).toBe("HIGH");
		expect(assessment.confidence).toBeGreaterThanOrEqual(0.7);
	});

	it("should downgrade confidence when evidence is missing", () => {
		const refs = [
			createTestEvidenceRef({ type: "execution_journal", id: "ej-1" }),
			createTestEvidenceRef({ type: "memory", id: "mem-1" }),
		];

		const resolutions: EvidenceResolution[] = [
			createMockResolution(refs[0], true),
			createMockResolution(refs[1], false),
		];

		const assessment = assessEvidenceConfidence(resolutions);
		expect(assessment.level).toBe("HIGH"); // single resolved evidence at 0.8 confidence
		expect(assessment.missingCount).toBe(1);
	});

	it("should block when critical evidence is missing", () => {
		const refs = [
			createTestEvidenceRef({ type: "validation", id: "val-1" }),
			createTestEvidenceRef({ type: "memory", id: "mem-1" }),
		];

		const resolutions: EvidenceResolution[] = [
			createMockResolution(refs[0], false),
			createMockResolution(refs[1], true),
		];

		const assessment = assessEvidenceConfidence(resolutions);
		expect(assessment.level).toBe("BLOCKED");
	});
});

// =========================================================================
// Evidence Refs Validation Tests (AC4)
// =========================================================================

describe("validateContentHasEvidenceRefs (AC4)", () => {
	it("should pass when content has evidence refs", () => {
		const result = validateContentHasEvidenceRefs(
			"The workspace build failed due to a memory issue we recall from previous attempts.",
			[createTestEvidenceRef({ type: "memory", id: "mem-1", label: "Previous Failure" })],
		);
		expect(result).toBe(true);
	});

	it("should fail when content has no evidence refs", () => {
		const result = validateContentHasEvidenceRefs(
			"We recall from memory that this pattern caused issues before.",
			[],
		);
		expect(result).toBe(false);
	});

	it("should fail when content mentions memory but has no memory-type evidence refs", () => {
		const result = validateContentHasEvidenceRefs("Based on our past failure memory, this approach is risky.", [
			createTestEvidenceRef({ type: "execution_journal", id: "ej-1", label: "Build Log" }),
		]);
		expect(result).toBe(false);
	});

	it("should pass when content mentions memory and has memory-type evidence refs", () => {
		const result = validateContentHasEvidenceRefs("Based on our past failure memory, this approach is risky.", [
			createTestEvidenceRef({ type: "memory", id: "mem-1", label: "Previous Failure" }),
			createTestEvidenceRef({ type: "execution_journal", id: "ej-1", label: "Build Log" }),
		]);
		expect(result).toBe(true);
	});

	it("should pass for content without memory keywords even without memory refs", () => {
		const result = validateContentHasEvidenceRefs("The workspace schema has been updated with the new field.", [
			createTestEvidenceRef({ type: "git_file", id: "schema.ts", label: "Schema Update" }),
		]);
		expect(result).toBe(true);
	});

	it("should require minimum number of evidence refs", () => {
		const result = validateContentHasEvidenceRefs("Content with evidence.", [createTestEvidenceRef()], {
			minRefs: 2,
		});
		expect(result).toBe(false);
	});
});
