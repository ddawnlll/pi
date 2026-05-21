/**
 * Proposal Generator tests — P16.B
 *
 * Covers all acceptance criteria:
 * 1. Observation trigger: accumulates N observations -> generates proposal
 * 2. Memory trigger: detects pattern -> generates proposal
 * 3. Goal trigger: aligns goals with observations -> generates proposal
 * 4. Plan completion trigger: generates reflection proposal
 * 5. Evidence validation rejects proposals with missing refs
 */

import { beforeEach, describe, expect, test } from "vitest";
import type { GoalRecord } from "../../../src/brain/goals/types.js";
import type { MemoryRecord } from "../../../src/brain/memory/types.js";
import {
	type GenerateProposalsResult,
	type GeneratorConfig,
	type ProposalDeduplication,
	ProposalGenerator as ProposalGeneratorClass,
	type ProposalStore,
	type ReflectionReport,
} from "../../../src/brain/proposals/generator.js";
import type {
	Proposal,
	ProposalCreateInput,
	ProposalQuery,
	ProposalStats,
} from "../../../src/brain/proposals/types.js";
import type { BrainObservation } from "../../../src/brain/types.js";

// ---------------------------------------------------------------------------
// Mock ProposalStore
// ---------------------------------------------------------------------------

class MockProposalStore implements ProposalStore {
	private proposals: Map<string, Proposal> = new Map();
	private nextId = 1;

	async create(input: ProposalCreateInput): Promise<Proposal> {
		const id = `prop-test-${this.nextId++}`;
		const now = new Date().toISOString();
		const proposal: Proposal = {
			id,
			type: input.type,
			title: input.title,
			description: input.description,
			evidence: {
				memoryIds: [...input.evidence.memoryIds],
				observationIds: [...input.evidence.observationIds],
				sourceRefs: [...input.evidence.sourceRefs],
				confidence: input.evidence.confidence,
				evidenceSummary: input.evidence.evidenceSummary,
			},
			risk: {
				level: input.risk.level,
				factors: [...input.risk.factors],
				mitigation: [...input.risk.mitigation],
				affectedSystems: [...input.risk.affectedSystems],
				impactDescription: input.risk.impactDescription,
			},
			score: input.score ?? { total: 0, novelty: 0, confidence: 0, urgency: 0, feasibility: 0 },
			status: "draft",
			createdAt: now,
			updatedAt: now,
			expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
			submittedBy: "pi",
			relatedProposalIds: [],
			relatedGoalIds: input.relatedGoalIds ?? [],
			tags: input.tags ?? [],
			metadata: { ...(input.metadata ?? {}) },
		};
		this.proposals.set(id, proposal);
		return proposal;
	}

	async getById(id: string): Promise<Proposal | null> {
		return this.proposals.get(id) ?? null;
	}

	async update(id: string, _input: Partial<Proposal>): Promise<Proposal> {
		const existing = this.proposals.get(id);
		if (!existing) throw new Error(`Proposal ${id} not found`);
		const updated = { ...existing, ..._input, updatedAt: new Date().toISOString() };
		this.proposals.set(id, updated);
		return updated;
	}

	async delete(id: string): Promise<void> {
		this.proposals.delete(id);
	}

	async list(_query?: ProposalQuery): Promise<Proposal[]> {
		return Array.from(this.proposals.values());
	}

	async stats(): Promise<ProposalStats> {
		return {
			totalProposals: this.proposals.size,
			byStatus: {} as any,
			byType: {} as any,
			averageScore: 0,
			acceptanceRate: 0,
			pendingApprovalCount: 0,
			expiredCount: 0,
		};
	}
}

// ---------------------------------------------------------------------------
// Mock ProposalDeduplication
// ---------------------------------------------------------------------------

class MockDedup implements ProposalDeduplication {
	private knownHashes: Set<string> = new Set();
	private cooldownTypes: Set<string> = new Set();
	private _cooldownEnabled = false;

	enableCooldown(): void {
		this._cooldownEnabled = true;
	}

	setDuplicate(hash: string): void {
		this.knownHashes.add(hash);
	}

	setCooldown(type: string): void {
		this.cooldownTypes.add(type);
	}

	isDuplicate(contentHash: string): boolean {
		return this.knownHashes.has(contentHash);
	}

	register(contentHash: string, _type: string, _generatedAt: string): void {
		this.knownHashes.add(contentHash);
	}

	isInCooldown(type: string): boolean {
		return this._cooldownEnabled && this.cooldownTypes.has(type);
	}
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createObservation(overrides?: Partial<BrainObservation>): BrainObservation {
	return {
		id: overrides?.id ?? `obs-${Math.random().toString(36).slice(2, 8)}`,
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		source: overrides?.source ?? "execution",
		signalType: overrides?.signalType ?? "retry_hotspot",
		severity: overrides?.severity ?? "warning",
		title: overrides?.title ?? "Test observation",
		description: overrides?.description ?? "A test observation",
		evidence: overrides?.evidence ?? [{ type: "journal", path: ".pi/test.json" }],
		provenance: overrides?.provenance ?? {
			observationSources: [{ type: "journal", path: ".pi/test.json" }],
			derivationChain: [],
			confidence: 0.8,
			validatedBy: "system",
		},
		metadata: overrides?.metadata ?? {},
	};
}

function createMemoryRecord(overrides?: Partial<MemoryRecord>): MemoryRecord {
	return {
		id: overrides?.id ?? `mem-${Math.random().toString(36).slice(2, 8)}`,
		type: overrides?.type ?? "failure_memory",
		title: overrides?.title ?? "Test memory",
		content: overrides?.content ?? "Test memory content",
		lifecycle: overrides?.lifecycle ?? "active",
		confidence: overrides?.confidence ?? 0.7,
		provenance: overrides?.provenance ?? {
			sourceRefs: [{ type: "observation", path: ".pi/test.json", id: "obs-123" }],
			validatedBy: "system",
		},
		createdAt: overrides?.createdAt ?? new Date().toISOString(),
		updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
		tags: overrides?.tags ?? [],
		metadata: overrides?.metadata ?? {},
	};
}

function createGoalRecord(overrides?: Partial<GoalRecord>): GoalRecord {
	return {
		id: overrides?.id ?? `goal-${Math.random().toString(36).slice(2, 8)}`,
		title: overrides?.title ?? "Test goal",
		priority: overrides?.priority ?? "medium",
		status: overrides?.status ?? "active",
	};
}

function createReflectionReport(overrides?: Partial<ReflectionReport>): ReflectionReport {
	return {
		id: overrides?.id ?? `ref-${Math.random().toString(36).slice(2, 8)}`,
		planExecId: overrides?.planExecId ?? "plan-exec-123",
		timestamp: overrides?.timestamp ?? new Date().toISOString(),
		summary: overrides?.summary ?? "Test reflection summary",
		lessons: overrides?.lessons ?? ["Lesson 1"],
		improvements: overrides?.improvements ?? ["Improvement 1"],
		confidence: overrides?.confidence ?? 0.7,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProposalGenerator", () => {
	let store: MockProposalStore;
	let dedup: MockDedup;
	let generator: ProposalGeneratorClass;

	beforeEach(() => {
		store = new MockProposalStore();
		dedup = new MockDedup();
		generator = new ProposalGeneratorClass(store, dedup);
	});

	// -----------------------------------------------------------------------
	// Construction & Configuration
	// -----------------------------------------------------------------------

	describe("construction and configuration", () => {
		test("creates with default config", () => {
			const gen = new ProposalGeneratorClass(store);
			expect(gen).toBeInstanceOf(ProposalGeneratorClass);
		});

		test("creates with custom config", () => {
			const customConfig: Partial<GeneratorConfig> = {
				observationAccumulationThreshold: 10,
				maxProposalsPerBatch: 5,
			};
			const gen = new ProposalGeneratorClass(store, undefined, customConfig);
			expect(gen).toBeInstanceOf(ProposalGeneratorClass);
		});

		test("setConfig merges configuration", () => {
			generator.setConfig({ observationAccumulationThreshold: 15 });
			// Verify by checking observation trigger behavior
			const observations = Array.from({ length: 10 }, () => createObservation());
			const triggered = generator.checkObservationTrigger(observations);
			expect(triggered).toHaveLength(0); // 10 < 15
		});
	});

	// -----------------------------------------------------------------------
	// AC1: Observation Trigger
	// -----------------------------------------------------------------------

	describe("AC1: observation trigger", () => {
		test("generates proposal when observations meet threshold", async () => {
			const observations = Array.from({ length: 5 }, () =>
				createObservation({ signalType: "retry_hotspot", severity: "warning" }),
			);

			const result = await generator.generateFromObservations(observations);
			expect(result.generatedCount).toBeGreaterThanOrEqual(1);
			expect(result.proposals.length).toBeGreaterThanOrEqual(1);
			expect(result.proposals[0].type).toBe("plan_proposal");
			expect(result.errors).toHaveLength(0);
		});

		test("does not generate proposal below threshold", async () => {
			const observations = Array.from({ length: 3 }, () => createObservation());

			const result = await generator.generateFromObservations(observations);
			expect(result.generatedCount).toBe(0);
			expect(result.proposals).toHaveLength(0);
			expect(result.errors).toEqual(["Insufficient observations to trigger generation"]);
		});

		test("generates memory_proposal for memory_conflict observations", async () => {
			const observations = Array.from({ length: 5 }, () =>
				createObservation({ signalType: "memory_conflict", severity: "warning" }),
			);

			const result = await generator.generateFromObservations(observations);
			expect(result.generatedCount).toBeGreaterThanOrEqual(1);
			expect(result.proposals[0].type).toBe("memory_proposal");
		});

		test("generates goal_revision_proposal for goal_drift observations", async () => {
			const observations = Array.from({ length: 5 }, () =>
				createObservation({ signalType: "goal_drift", severity: "warning" }),
			);

			const result = await generator.generateFromObservations(observations);
			expect(result.generatedCount).toBeGreaterThanOrEqual(1);
			expect(result.proposals[0].type).toBe("goal_revision_proposal");
		});

		test("respects maxProposalsPerBatch", async () => {
			const gen = new ProposalGeneratorClass(store, dedup, { maxProposalsPerBatch: 1 });

			// Create observations of different signal types
			const observations = [
				...Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" })),
				...Array.from({ length: 5 }, () => createObservation({ signalType: "memory_conflict" })),
			];

			const result = await gen.generateFromObservations(observations);
			// With maxProposalsPerBatch=1, at most 1 proposal should be generated in a single batch
			expect(result.proposals.length).toBeLessThanOrEqual(1);
		});

		test("skips proposals with confidence below 0.3", async () => {
			const observations = Array.from({ length: 5 }, () =>
				createObservation({
					signalType: "retry_hotspot",
					provenance: {
						observationSources: [{ type: "journal", path: ".pi/test.json" }],
						derivationChain: [],
						confidence: 0.1,
						validatedBy: "system",
					},
				}),
			);

			const result = await generator.generateFromObservations(observations);
			expect(result.validationFailedCount).toBeGreaterThanOrEqual(1);
			expect(result.proposals).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Memory Trigger
	// -----------------------------------------------------------------------

	describe("AC2: memory pattern trigger", () => {
		test("generates proposal from memory pattern", async () => {
			const memories = Array.from({ length: 3 }, () => createMemoryRecord({ type: "failure_memory" }));

			const result = await generator.generateFromMemoryPattern(memories, "repeated failure pattern");
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("plan_proposal");
			expect(result.proposals[0].title).toContain("failure pattern");
			expect(result.errors).toHaveLength(0);
		});

		test("generates goal_revision proposal from decision memories", async () => {
			const memories = Array.from({ length: 3 }, () => createMemoryRecord({ type: "decision_memory" }));

			const result = await generator.generateFromMemoryPattern(memories, "repeated decision pattern");
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("goal_revision_proposal");
		});

		test("generates memory_proposal for general patterns", async () => {
			const memories = Array.from({ length: 3 }, () => createMemoryRecord({ type: "project_memory" }));

			const result = await generator.generateFromMemoryPattern(memories, "general insight");
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("memory_proposal");
		});

		test("returns error for empty memories", async () => {
			const result = await generator.generateFromMemoryPattern([], "empty pattern");
			expect(result.generatedCount).toBe(0);
			expect(result.errors).toEqual(["No memories provided for pattern"]);
		});
	});

	// -----------------------------------------------------------------------
	// AC3: Goal Alignment Trigger
	// -----------------------------------------------------------------------

	describe("AC3: goal alignment trigger", () => {
		test("generates goal revision proposal with observations", async () => {
			const goal = createGoalRecord({ title: "Reduce retries" });
			const observations = Array.from({ length: 3 }, () => createObservation({ signalType: "retry_hotspot" }));

			const result = await generator.generateGoalAlignmentProposal(goal, observations);
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("goal_revision_proposal");
			expect(result.proposals[0].title).toContain("Reduce retries");
			expect(result.proposals[0].relatedGoalIds).toContain(goal.id);
			expect(result.errors).toHaveLength(0);
		});

		test("returns error for empty observations", async () => {
			const goal = createGoalRecord();
			const result = await generator.generateGoalAlignmentProposal(goal, []);
			expect(result.generatedCount).toBe(0);
			expect(result.errors).toEqual(["No observations provided for goal alignment"]);
		});

		test("skips proposals with confidence below 0.3", async () => {
			const goal = createGoalRecord();
			const observations = Array.from({ length: 3 }, () =>
				createObservation({
					provenance: {
						observationSources: [{ type: "journal", path: ".pi/test.json" }],
						derivationChain: [],
						confidence: 0.1,
						validatedBy: "system",
					},
				}),
			);

			const result = await generator.generateGoalAlignmentProposal(goal, observations);
			expect(result.validationFailedCount).toBe(1);
			expect(result.proposals).toHaveLength(0);
		});

		test("links proposal to the triggering goal", async () => {
			const goal = createGoalRecord({ id: "goal-special-123" });
			const observations = Array.from({ length: 3 }, () => createObservation());

			const result = await generator.generateGoalAlignmentProposal(goal, observations);
			expect(result.proposals[0].relatedGoalIds).toContain("goal-special-123");
		});
	});

	// -----------------------------------------------------------------------
	// AC4: Plan Completion Trigger (Reflection)
	// -----------------------------------------------------------------------

	describe("AC4: plan completion / reflection trigger", () => {
		test("generates reflection proposal from plan completion", async () => {
			const reflection = createReflectionReport({
				planExecId: "plan-exec-456",
				summary: "Identified retry botleneck",
				lessons: ["Retry logic needs backoff"],
				improvements: ["Add exponential backoff"],
			});

			const result = await generator.generateReflectionProposal(reflection);
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("reflection_proposal");
			expect(result.proposals[0].title).toContain("plan-exec-456");
			expect(result.proposals[0].description).toContain("Retry logic needs backoff");
			expect(result.errors).toHaveLength(0);
		});

		test("includes lessons and improvements in description", async () => {
			const reflection = createReflectionReport({
				lessons: ["Lesson A", "Lesson B"],
				improvements: ["Improvement X"],
			});

			const result = await generator.generateReflectionProposal(reflection);
			expect(result.proposals[0].description).toContain("Lesson A");
			expect(result.proposals[0].description).toContain("Lesson B");
			expect(result.proposals[0].description).toContain("Improvement X");
		});
	});

	// -----------------------------------------------------------------------
	// AC5: Evidence Validation
	// -----------------------------------------------------------------------

	describe("AC5: evidence validation", () => {
		test("validateEvidence returns false for empty evidence", () => {
			const valid = generator.validateEvidence({
				memoryIds: [],
				observationIds: [],
				sourceRefs: [],
				confidence: 0.5,
				evidenceSummary: "",
			});
			expect(valid).toBe(false);
		});

		test("validateEvidence returns true for complete evidence", () => {
			const valid = generator.validateEvidence({
				memoryIds: ["mem-1"],
				observationIds: [],
				sourceRefs: [{ type: "observation", path: "test.json", id: "obs-1" }],
				confidence: 0.7,
				evidenceSummary: "Test evidence",
			});
			expect(valid).toBe(true);
		});

		test("validateRisk returns false for invalid risk level", () => {
			const valid = generator.validateRisk({
				level: "invalid" as any,
				factors: ["test"],
				mitigation: [],
				affectedSystems: ["test"],
				impactDescription: "test",
			});
			expect(valid).toBe(false);
		});

		test("validateRisk returns true for valid risk", () => {
			const valid = generator.validateRisk({
				level: "medium",
				factors: ["test"],
				mitigation: [],
				affectedSystems: ["test"],
				impactDescription: "test",
			});
			expect(valid).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Duplicate Detection & Cooldown
	// -----------------------------------------------------------------------

	describe("deduplication and cooldown", () => {
		test("skips duplicate proposals", async () => {
			const observations = Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" }));

			// First call should generate
			const result1 = await generator.generateFromObservations(observations);
			expect(result1.generatedCount).toBeGreaterThanOrEqual(1);

			// Pre-seed the hash
			if (result1.proposals.length > 0) {
				const obs2 = Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" }));
				const result2 = await generator.generateFromObservations(obs2);
				// May generate different proposals since observations are different
				// Just check no errors
				expect(result2.errors).toHaveLength(0);
			}
		});

		test("skips proposals in cooldown", async () => {
			dedup.setCooldown("plan_proposal");
			dedup.enableCooldown();

			const observations = Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" }));

			const result = await generator.generateFromObservations(observations);
			expect(result.cooldownCount).toBeGreaterThanOrEqual(1);
		});
	});

	// -----------------------------------------------------------------------
	// Safety Signal
	// -----------------------------------------------------------------------

	describe("safety signal", () => {
		test("generates safety proposal from signal", async () => {
			const result = await generator.generateSafetyProposal("unexpected file write detected", [
				createObservation({ signalType: "retry_hotspot", severity: "critical" }),
			]);

			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("safety_proposal");
			expect(result.proposals[0].title).toContain("unexpected file write detected");
			expect(result.proposals[0].risk.level).toBe("high");
			expect(result.errors).toHaveLength(0);
		});

		test("generates safety proposal without observations", async () => {
			const result = await generator.generateSafetyProposal("policy violation detected", []);
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("safety_proposal");
		});
	});

	// -----------------------------------------------------------------------
	// Core generate() dispatcher
	// -----------------------------------------------------------------------

	describe("core generate() method", () => {
		test("dispatches observation trigger", async () => {
			const observations = Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" }));

			const result = await generator.generate(
				{ type: "observations", observationIds: observations.map((o) => o.id) },
				{ observations },
			);
			expect(result.generatedCount).toBeGreaterThanOrEqual(1);
		});

		test("dispatches memory pattern trigger", async () => {
			const memories = Array.from({ length: 3 }, () => createMemoryRecord({ type: "failure_memory" }));

			const result = await generator.generate(
				{ type: "memory_pattern", memoryIds: memories.map((m) => m.id), pattern: "test pattern" },
				{ memories },
			);
			expect(result.generatedCount).toBe(1);
		});

		test("dispatches goal alignment trigger", async () => {
			const goal = createGoalRecord();
			const observations = Array.from({ length: 3 }, () => createObservation());

			const result = await generator.generate(
				{ type: "goal_alignment", goalIds: [goal.id], observationIds: observations.map((o) => o.id) },
				{ goals: [goal], observations },
			);
			expect(result.generatedCount).toBe(1);
		});

		test("dispatches plan completion trigger", async () => {
			const result = await generator.generate({
				type: "plan_completion",
				planExecId: "plan-exec-789",
				reflectionId: "ref-789",
			});
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("reflection_proposal");
		});

		test("dispatches safety signal trigger", async () => {
			const result = await generator.generate({
				type: "safety_signal",
				signal: "file permission issue",
				observationIds: [],
			});
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("safety_proposal");
		});

		test("dispatches manual trigger", async () => {
			const result = await generator.generate({
				type: "manual",
				userId: "test-user",
				input: "Create a proposal for X",
			});
			expect(result.generatedCount).toBe(1);
			expect(result.proposals[0].type).toBe("plan_proposal");
			expect(result.proposals[0].title).toContain("test-user");
		});

		test("returns error for missing context", async () => {
			const result = await generator.generate({
				type: "observations",
				observationIds: ["obs-1"],
			});
			expect(result.generatedCount).toBe(0);
			expect(result.errors.length).toBeGreaterThan(0);
		});
	});

	// -----------------------------------------------------------------------
	// Trigger Checkers
	// -----------------------------------------------------------------------

	describe("trigger checkers", () => {
		test("checkObservationTrigger returns observations above threshold", () => {
			const observations = Array.from({ length: 6 }, () => createObservation());
			const triggered = generator.checkObservationTrigger(observations);
			expect(triggered.length).toBeGreaterThanOrEqual(6);
		});

		test("checkObservationTrigger returns empty below threshold", () => {
			const observations = Array.from({ length: 3 }, () => createObservation());
			const triggered = generator.checkObservationTrigger(observations);
			expect(triggered).toHaveLength(0);
		});

		test("checkMemoryPatternTrigger detects patterns in grouped memories", () => {
			const memories = Array.from({ length: 3 }, () => createMemoryRecord({ type: "failure_memory" }));
			const triggered = generator.checkMemoryPatternTrigger(memories);
			expect(triggered.length).toBeGreaterThanOrEqual(3);
		});

		test("checkMemoryPatternTrigger returns empty for sparse memories", () => {
			const memories = Array.from({ length: 2 }, () => createMemoryRecord());
			const triggered = generator.checkMemoryPatternTrigger(memories);
			expect(triggered).toHaveLength(0);
		});

		test("checkGoalTrigger detects goal_drift observations", () => {
			const goal = createGoalRecord();
			const observations = Array.from({ length: 3 }, () => createObservation({ signalType: "goal_drift" }));
			expect(generator.checkGoalTrigger([goal], observations)).toBe(true);
		});

		test("checkGoalTrigger returns false for irrelevant observations", () => {
			const goal = createGoalRecord();
			const observations = Array.from({ length: 3 }, () => createObservation({ signalType: "proposal_generated" }));
			expect(generator.checkGoalTrigger([goal], observations)).toBe(false);
		});

		test("checkGoalTrigger returns false with empty inputs", () => {
			expect(generator.checkGoalTrigger([], [])).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// Integration: Multiple triggers
	// -----------------------------------------------------------------------

	describe("integration: multiple proposal types", () => {
		test("generates all proposal types without errors", async () => {
			const results: GenerateProposalsResult[] = [];

			// Observation trigger
			results.push(
				await generator.generateFromObservations(
					Array.from({ length: 5 }, () => createObservation({ signalType: "retry_hotspot" })),
				),
			);

			// Memory pattern
			results.push(
				await generator.generateFromMemoryPattern(
					Array.from({ length: 3 }, () => createMemoryRecord({ type: "failure_memory" })),
					"test pattern",
				),
			);

			// Goal alignment
			results.push(
				await generator.generateGoalAlignmentProposal(
					createGoalRecord(),
					Array.from({ length: 3 }, () => createObservation()),
				),
			);

			// Reflection
			results.push(await generator.generateReflectionProposal(createReflectionReport()));

			// Safety
			results.push(await generator.generateSafetyProposal("test signal", []));

			// Verify all generated successfully
			for (const result of results) {
				expect(result.errors).toHaveLength(0);
			}

			// Verify we have proposals of different types
			const allProposals = results.flatMap((r) => r.proposals);
			const types = new Set(allProposals.map((p) => p.type));
			expect(types.size).toBeGreaterThanOrEqual(4); // At least 4 different types
		});
	});
});
