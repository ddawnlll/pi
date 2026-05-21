/**
 * Proposal Deduplication & Cooldown — P16.D tests.
 *
 * Covers:
 * - Configuration defaults and merging
 * - Content hashing (deterministic, same input = same hash)
 * - Exact duplicate detection via hash
 * - Similarity calculation and threshold-based dedup
 * - Cooldown checks per proposal type
 * - Evidence-different override (bypasses cooldown)
 * - Combined shouldSuppress logic
 * - Suppression logging
 * - History management
 * - Generator interface compatibility
 * - Edge cases (disabled, no cooldown types, empty inputs)
 */

import { describe, expect, test } from "vitest";
import { DEFAULT_COOLDOWNS, ProposalDeduplication } from "../../../src/brain/proposals/dedup.js";
import {
	createProposal,
	createProposalCreateInput,
	type Proposal,
	type ProposalCreateInput,
	type ProposalEvidence,
	type ProposalRiskAssessment,
} from "../../../src/brain/proposals/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(overrides?: Partial<ProposalEvidence>): ProposalEvidence {
	return {
		memoryIds: overrides?.memoryIds ?? ["mem-001"],
		observationIds: overrides?.observationIds ?? [],
		sourceRefs: overrides?.sourceRefs ?? [],
		confidence: overrides?.confidence ?? 0.8,
		evidenceSummary: overrides?.evidenceSummary ?? "Test evidence summary",
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: overrides?.level ?? "low",
		factors: overrides?.factors ?? ["factor-1"],
		mitigation: overrides?.mitigation ?? ["mitigation-1"],
		affectedSystems: overrides?.affectedSystems ?? ["system-a"],
		impactDescription: overrides?.impactDescription ?? "Low impact",
	};
}

function makeCreateInput(overrides?: Partial<ProposalCreateInput>): ProposalCreateInput {
	return createProposalCreateInput({
		type: overrides?.type ?? "memory_proposal",
		title: overrides?.title ?? "Test proposal",
		description: overrides?.description ?? "A test proposal for unit testing",
		evidence: overrides?.evidence ?? makeEvidence(),
		risk: overrides?.risk ?? makeRisk(),
		relatedGoalIds: overrides?.relatedGoalIds,
		tags: overrides?.tags,
		metadata: overrides?.metadata,
	});
}

function makeExistingProposal(
	overrides?: Partial<ProposalCreateInput> & { createdAt?: string; id?: string },
): Proposal {
	const input = makeCreateInput(overrides);
	const createdAt = overrides?.createdAt ?? new Date().toISOString();
	return createProposal(input, {
		id: overrides?.id,
		createdAt,
		status: "pending_approval",
	});
}

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("ProposalDeduplication config defaults", () => {
	test("constructor without config uses defaults", () => {
		const dedup = new ProposalDeduplication();
		const config = dedup.getConfig();
		expect(config.enabled).toBe(true);
		expect(config.similarityThreshold).toBe(0.8);
		expect(config.hashAlgorithm).toBe("sha256");
		expect(config.cooldowns).toEqual(DEFAULT_COOLDOWNS);
	});

	test("constructor with partial config merges correctly", () => {
		const dedup = new ProposalDeduplication({
			similarityThreshold: 0.9,
			enabled: false,
		});
		const config = dedup.getConfig();
		expect(config.similarityThreshold).toBe(0.9);
		expect(config.enabled).toBe(false);
		expect(config.hashAlgorithm).toBe("sha256"); // default
		expect(config.cooldowns.memory_proposal).toBe(12); // default
	});

	test("constructor with cooldown overrides", () => {
		const dedup = new ProposalDeduplication({
			cooldowns: { memory_proposal: 6, plan_proposal: 48 },
		});
		const config = dedup.getConfig();
		expect(config.cooldowns.memory_proposal).toBe(6);
		expect(config.cooldowns.plan_proposal).toBe(48);
		expect(config.cooldowns.goal_revision_proposal).toBe(24); // unchanged
	});

	test("setConfig updates only provided fields", () => {
		const dedup = new ProposalDeduplication();
		dedup.setConfig({ similarityThreshold: 0.5 });
		expect(dedup.getConfig().similarityThreshold).toBe(0.5);
		expect(dedup.getConfig().enabled).toBe(true); // unchanged
	});

	test("setConfig with cooldown overrides merges correctly", () => {
		const dedup = new ProposalDeduplication();
		dedup.setConfig({ cooldowns: { safety_proposal: 6 } });
		expect(dedup.getConfig().cooldowns.safety_proposal).toBe(6);
		expect(dedup.getConfig().cooldowns.memory_proposal).toBe(12); // unchanged
	});

	test("getConfig returns immutable snapshot", () => {
		const dedup = new ProposalDeduplication();
		const config = dedup.getConfig();
		config.enabled = false;
		config.cooldowns.memory_proposal = 99;
		// Original should be unchanged
		expect(dedup.getConfig().enabled).toBe(true);
		expect(dedup.getConfig().cooldowns.memory_proposal).toBe(12);
	});
});

// ---------------------------------------------------------------------------
// getCooldownForType
// ---------------------------------------------------------------------------

describe("getCooldownForType", () => {
	test("returns correct cooldown for all proposal types", () => {
		const dedup = new ProposalDeduplication();
		expect(dedup.getCooldownForType("memory_proposal")).toBe(12);
		expect(dedup.getCooldownForType("plan_proposal")).toBe(24);
		expect(dedup.getCooldownForType("goal_revision_proposal")).toBe(24);
		expect(dedup.getCooldownForType("autonomy_adjustment_proposal")).toBe(48);
		expect(dedup.getCooldownForType("reflection_proposal")).toBe(12);
		expect(dedup.getCooldownForType("safety_proposal")).toBe(0);
	});

	test("returns default 24 for unknown type", () => {
		const dedup = new ProposalDeduplication();
		expect(dedup.getCooldownForType("unknown_type" as never)).toBe(24);
	});
});

// ---------------------------------------------------------------------------
// Content Hashing
// ---------------------------------------------------------------------------

describe("hashProposal", () => {
	test("produces deterministic hash for same input", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash1 = dedup.hashProposal(input);
		const hash2 = dedup.hashProposal(input);
		expect(hash1).toBe(hash2);
	});

	test("different titles produce different hashes", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({ title: "Proposal A" });
		const b = makeCreateInput({ title: "Proposal B" });
		expect(dedup.hashProposal(a)).not.toBe(dedup.hashProposal(b));
	});

	test("different types produce different hashes", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({ type: "memory_proposal", title: "Same title" });
		const b = makeCreateInput({ type: "plan_proposal", title: "Same title" });
		expect(dedup.hashProposal(a)).not.toBe(dedup.hashProposal(b));
	});

	test("same content regardless of evidence order produces same hash", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({
			evidence: makeEvidence({ memoryIds: ["mem-003", "mem-001", "mem-002"] }),
		});
		const b = makeCreateInput({
			evidence: makeEvidence({ memoryIds: ["mem-001", "mem-002", "mem-003"] }),
		});
		expect(dedup.hashProposal(a)).toBe(dedup.hashProposal(b));
	});

	test("hash is case-insensitive for title and description", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({ title: "UPPERCASE Title" });
		const b = makeCreateInput({ title: "uppercase title" });
		expect(dedup.hashProposal(a)).toBe(dedup.hashProposal(b));
	});
});

// ---------------------------------------------------------------------------
// Similarity Calculation
// ---------------------------------------------------------------------------

describe("calculateSimilarity", () => {
	test("identical proposals score 1.0", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput();
		const b = makeCreateInput();
		expect(dedup.calculateSimilarity(a, b)).toBeCloseTo(1.0, 2);
	});

	test("completely different proposals score low", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({
			type: "memory_proposal",
			title: "Memory cleanup",
			description: "Clean up stale memory records from the store",
			evidence: makeEvidence({ memoryIds: ["mem-001"] }),
		});
		const b = makeCreateInput({
			type: "plan_proposal",
			title: "New architecture plan",
			description: "Rewrite the authentication module using OAuth2",
			evidence: makeEvidence({ memoryIds: ["mem-999"] }),
		});
		const similarity = dedup.calculateSimilarity(a, b);
		expect(similarity).toBeLessThan(0.5);
	});

	test("same type with similar title gets moderate similarity", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({
			type: "memory_proposal",
			title: "Update memory record for workspace X",
			description: "Description A",
		});
		const b = makeCreateInput({
			type: "memory_proposal",
			title: "Update memory record for workspace Y",
			description: "Description B",
		});
		const similarity = dedup.calculateSimilarity(a, b);
		expect(similarity).toBeGreaterThan(0.3);
		expect(similarity).toBeLessThan(0.9);
	});

	test("different types but same title/desc gets moderate similarity", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({ type: "memory_proposal", title: "Same title", description: "Same description" });
		const b = makeCreateInput({ type: "plan_proposal", title: "Same title", description: "Same description" });
		const similarity = dedup.calculateSimilarity(a, b);
		// Type mismatch loses 0.2, but title/desc match gives 0.7 → ~0.7
		expect(similarity).toBeGreaterThan(0.6);
	});

	test("same evidence IDs increase similarity", () => {
		const dedup = new ProposalDeduplication();
		const evidence = makeEvidence({ memoryIds: ["mem-001", "mem-002"], observationIds: ["obs-001"] });
		const a = makeCreateInput({ evidence, title: "Title A" });
		const b = makeCreateInput({ evidence, title: "Title B" });
		const noOverlap = makeCreateInput({
			evidence: makeEvidence({ memoryIds: ["mem-999"], observationIds: [] }),
			title: "Title B",
		});
		const simSameEvidence = dedup.calculateSimilarity(a, b);
		const simDiffEvidence = dedup.calculateSimilarity(a, noOverlap);
		expect(simSameEvidence).toBeGreaterThan(simDiffEvidence);
	});
});

// ---------------------------------------------------------------------------
// isDuplicate (generator interface, string-based)
// ---------------------------------------------------------------------------

describe("isDuplicate (generator interface)", () => {
	test("returns false for unregistered hash", () => {
		const dedup = new ProposalDeduplication();
		expect(dedup.isDuplicate("nonexistent-hash")).toBe(false);
	});

	test("returns true for registered hash", () => {
		const dedup = new ProposalDeduplication();
		dedup.register("test-hash", "memory_proposal", new Date().toISOString());
		expect(dedup.isDuplicate("test-hash")).toBe(true);
	});

	test("returns false after clearHistory removes the hash", () => {
		const dedup = new ProposalDeduplication();
		const hash = dedup.hashProposal(makeCreateInput());
		// Register with an old timestamp so it's clearly before the cutoff
		const oldDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
		dedup.register(hash, "memory_proposal", oldDate);
		expect(dedup.isDuplicate(hash)).toBe(true);
		// Clear everything older than 30 minutes ago (so the 1-hour-old entry is removed)
		const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		dedup.clearHistory(cutoff);
		expect(dedup.isDuplicate(hash)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// register (generator interface)
// ---------------------------------------------------------------------------

describe("register (generator interface)", () => {
	test("registers hash and type for future checks", () => {
		const dedup = new ProposalDeduplication();
		// Use a recent timestamp so cooldown is active
		const now = new Date().toISOString();
		dedup.register("hash-1", "memory_proposal", now);
		expect(dedup.isDuplicate("hash-1")).toBe(true);
		expect(dedup.isInCooldown("memory_proposal")).toBe(true);
	});

	test("multiple registrations of same hash are idempotent", () => {
		const dedup = new ProposalDeduplication();
		const ts = new Date().toISOString();
		dedup.register("hash-1", "memory_proposal", ts);
		dedup.register("hash-1", "memory_proposal", ts);
		expect(dedup.isDuplicate("hash-1")).toBe(true);
	});

	test("register with safety type should not trigger cooldown", () => {
		const dedup = new ProposalDeduplication();
		dedup.register("hash-safety", "safety_proposal", new Date().toISOString());
		// safety_proposal has cooldown 0, so should never be in cooldown
		expect(dedup.isInCooldown("safety_proposal")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isInCooldown (generator interface, string-based)
// ---------------------------------------------------------------------------

describe("isInCooldown (generator interface)", () => {
	test("returns false for type with no history", () => {
		const dedup = new ProposalDeduplication();
		expect(dedup.isInCooldown("memory_proposal")).toBe(false);
	});

	test("returns true for type recently registered", () => {
		const dedup = new ProposalDeduplication();
		dedup.register("hash-1", "memory_proposal", new Date().toISOString());
		expect(dedup.isInCooldown("memory_proposal")).toBe(true);
	});

	test("returns false for safety_proposal (cooldown 0)", () => {
		const dedup = new ProposalDeduplication();
		dedup.register("hash-safe", "safety_proposal", new Date().toISOString());
		expect(dedup.isInCooldown("safety_proposal")).toBe(false);
	});

	test("returns false for expired cooldown", () => {
		const dedup = new ProposalDeduplication();
		const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
		dedup.register("hash-old", "memory_proposal", oldDate);
		// memory_proposal cooldown is 12h, so 48h ago is well past
		expect(dedup.isInCooldown("memory_proposal")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkDuplicate (rich API)
// ---------------------------------------------------------------------------

describe("checkDuplicate", () => {
	test("exact duplicate detected by content hash", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());

		const result = dedup.checkDuplicate(input, []);
		expect(result.isDuplicate).toBe(true);
		expect(result.matchReason).toContain("Exact content hash match");
	});

	test("non-duplicate returns false", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ title: "Unique proposal" });
		const existing = [makeExistingProposal({ title: "A completely different proposal" })];

		const result = dedup.checkDuplicate(input, existing);
		expect(result.isDuplicate).toBe(false);
	});

	test("disabled dedup always returns not duplicate", () => {
		const dedup = new ProposalDeduplication({ enabled: false });
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());

		const result = dedup.checkDuplicate(input, []);
		expect(result.isDuplicate).toBe(false);
	});

	test("similarity algorithm detects similar proposals", () => {
		const dedup = new ProposalDeduplication({
			hashAlgorithm: "similarity",
			similarityThreshold: 0.7,
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			title: "Clean up workspace memory",
			description: "Remove stale memory records from the workspace store",
		});
		const existing = [
			makeExistingProposal({
				type: "memory_proposal",
				title: "Clean up workspace memory records",
				description: "Remove stale records from the workspace memory store",
			}),
		];

		const result = dedup.checkDuplicate(input, existing);
		expect(result.isDuplicate).toBe(true);
		expect(result.matchReason).toContain("Similarity");
	});

	test("similarity algorithm does not match below threshold", () => {
		const dedup = new ProposalDeduplication({
			hashAlgorithm: "similarity",
			similarityThreshold: 0.95, // very strict
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			title: "Clean up workspace memory",
			description: "Remove stale memory records",
		});
		const existing = [
			makeExistingProposal({
				type: "memory_proposal",
				title: "Update configuration settings",
				description: "Change the default timeout value",
			}),
		];

		const result = dedup.checkDuplicate(input, existing);
		expect(result.isDuplicate).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// checkCooldown (rich API)
// ---------------------------------------------------------------------------

describe("checkCooldown", () => {
	test("returns not in cooldown when no recent same-type proposals", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "memory_proposal" });
		const result = dedup.checkCooldown(input, []);
		expect(result.isInCooldown).toBe(false);
	});

	test("returns in cooldown when recent same-type proposal exists", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "memory_proposal" });
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date().toISOString(), // just now
			}),
		];
		// Register the recent proposal
		const recentHash = dedup.hashProposal(makeCreateInput({ type: "memory_proposal" }));
		dedup.register(recentHash, "memory_proposal", new Date().toISOString());

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(true);
		expect(result.remainingHours).toBeGreaterThan(0);
	});

	test("returns not in cooldown for safety_proposal (cooldown 0)", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "safety_proposal" });
		const recent = [
			makeExistingProposal({
				type: "safety_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(false);
	});

	test("returns not in cooldown for old proposals", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "memory_proposal" });
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h ago
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(false);
	});

	test("returns remaining hours correctly", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "plan_proposal" }); // cooldown 24h
		// Create a proposal from 2 hours ago
		const recent = [
			makeExistingProposal({
				type: "plan_proposal",
				createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(true);
		expect(result.remainingHours).toBeGreaterThan(20);
		expect(result.remainingHours).toBeLessThanOrEqual(22);
	});
});

// ---------------------------------------------------------------------------
// Evidence-different overrides cooldown
// ---------------------------------------------------------------------------

describe("different evidence bypasses cooldown", () => {
	test("different memory IDs bypass cooldown", () => {
		const dedup = new ProposalDeduplication();
		const differentEvidence = makeEvidence({
			memoryIds: ["mem-999"], // different from the existing proposal
			observationIds: [],
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			evidence: differentEvidence,
		});
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		// Should not be in cooldown because evidence is different
		expect(result.isInCooldown).toBe(false);
	});

	test("different observation IDs bypass cooldown", () => {
		const dedup = new ProposalDeduplication();
		const differentEvidence = makeEvidence({
			memoryIds: [],
			observationIds: ["obs-999"],
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			evidence: differentEvidence,
		});
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(false);
	});

	test("different evidence summary bypasses cooldown", () => {
		const dedup = new ProposalDeduplication();
		const differentEvidence = makeEvidence({
			evidenceSummary: "Completely new evidence from different observations",
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			evidence: differentEvidence,
		});
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(false);
	});

	test("same evidence does NOT bypass cooldown", () => {
		const dedup = new ProposalDeduplication();
		const evidence = makeEvidence({
			memoryIds: ["mem-001", "mem-002"],
			observationIds: ["obs-001"],
		});
		const input = makeCreateInput({
			type: "memory_proposal",
			evidence,
			title: "Same title content",
			description: "Same description content",
		});
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				evidence,
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.checkCooldown(input, recent);
		expect(result.isInCooldown).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// shouldSuppress (combined)
// ---------------------------------------------------------------------------

describe("shouldSuppress", () => {
	test("suppresses exact duplicate", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());

		const result = dedup.shouldSuppress(input, []);
		expect(result.suppress).toBe(true);
		expect(result.reason).toBeDefined();
	});

	test("suppresses proposal in cooldown", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "memory_proposal" });
		const recent = [
			makeExistingProposal({
				type: "memory_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const result = dedup.shouldSuppress(input, recent);
		expect(result.suppress).toBe(true);
		expect(result.reason).toContain("cooldown");
	});

	test("does not suppress when enabled is false", () => {
		const dedup = new ProposalDeduplication({ enabled: false });
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());

		const result = dedup.shouldSuppress(input, []);
		expect(result.suppress).toBe(false);
	});

	test("does not suppress unique proposal not in cooldown", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "memory_proposal" });
		const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
		const recent = [
			makeExistingProposal({
				type: "plan_proposal", // different type
				createdAt: oldDate,
			}),
		];

		const result = dedup.shouldSuppress(input, recent);
		expect(result.suppress).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suppression Log
// ---------------------------------------------------------------------------

describe("suppression log", () => {
	test("logs suppress = true decisions", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());
		dedup.shouldSuppress(input, []);

		const log = dedup.getSuppressionLog();
		expect(log.length).toBe(1);
		expect(log[0].type).toBe("memory_proposal");
		expect(log[0].reason).toBeDefined();
	});

	test("does not log suppress = false decisions", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ title: "New unique proposal" });
		dedup.shouldSuppress(input, []);

		const log = dedup.getSuppressionLog();
		expect(log.length).toBe(0);
	});

	test("clearSuppressionLog empties the log", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.register(hash, input.type, new Date().toISOString());
		dedup.shouldSuppress(input, []);
		expect(dedup.getSuppressionLog().length).toBe(1);

		dedup.clearSuppressionLog();
		expect(dedup.getSuppressionLog().length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// History Management
// ---------------------------------------------------------------------------

describe("history management", () => {
	test("recordHistory adds to registered hashes", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput();
		const hash = dedup.hashProposal(input);
		dedup.recordHistory(input);
		expect(dedup.isDuplicate(hash)).toBe(true);
	});

	test("getHistory returns all entries", () => {
		const dedup = new ProposalDeduplication();
		dedup.register("hash-a", "memory_proposal", new Date().toISOString());
		dedup.register("hash-b", "plan_proposal", new Date().toISOString());
		const history = dedup.getHistory();
		expect(history.size).toBe(2);
	});

	test("getHistory filtered by type", () => {
		const dedup = new ProposalDeduplication();
		const now = new Date().toISOString();
		dedup.register("hash-a", "memory_proposal", now);
		dedup.register("hash-b", "plan_proposal", now);
		const memoryHistory = dedup.getHistory("memory_proposal");
		expect(memoryHistory.size).toBe(1);
		const entry = memoryHistory.get("hash-a");
		expect(entry).toBeDefined();
		expect(entry![0].type).toBe("memory_proposal");
	});

	test("clearHistory removes old entries", () => {
		const dedup = new ProposalDeduplication();
		const oldTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString(); // 1 minute ago
		dedup.register("hash-old", "memory_proposal", oldTimestamp);
		dedup.register("hash-recent", "memory_proposal", recentTimestamp);

		// Clear everything older than 30 minutes ago
		const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		dedup.clearHistory(cutoff);

		expect(dedup.isDuplicate("hash-old")).toBe(false);
		expect(dedup.isDuplicate("hash-recent")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("empty proposals hash deterministically", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({
			evidence: makeEvidence({ memoryIds: [], observationIds: [] }),
		});
		const hash1 = dedup.hashProposal(input);
		const hash2 = dedup.hashProposal(input);
		expect(hash1).toBe(hash2);
	});

	test("safety_proposal is never suppressed by cooldown", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ type: "safety_proposal" });
		const recent = [
			makeExistingProposal({
				type: "safety_proposal",
				createdAt: new Date().toISOString(),
			}),
		];

		const cd = dedup.checkCooldown(input, recent);
		expect(cd.isInCooldown).toBe(false);

		const sup = dedup.shouldSuppress(input, recent);
		expect(sup.suppress).toBe(false);
	});

	test("similarity of completely empty strings gives 1.0", () => {
		const dedup = new ProposalDeduplication();
		const a = makeCreateInput({ title: "", description: "" });
		const b = makeCreateInput({ title: "", description: "" });
		expect(dedup.calculateSimilarity(a, b)).toBeCloseTo(1.0, 2);
	});

	test("proposal with very long title is hashed correctly", () => {
		const dedup = new ProposalDeduplication();
		const longTitle = "A".repeat(10000);
		const input = makeCreateInput({ title: longTitle });
		const hash = dedup.hashProposal(input);
		expect(hash).toBeDefined();
		expect(hash.length).toBe(64); // SHA-256 hex length
	});

	test("multiple different types can be tracked simultaneously", () => {
		const dedup = new ProposalDeduplication();
		const now = new Date().toISOString();

		dedup.register("h1", "memory_proposal", now);
		dedup.register("h2", "plan_proposal", now);
		dedup.register("h3", "goal_revision_proposal", now);

		expect(dedup.isInCooldown("memory_proposal")).toBe(true);
		expect(dedup.isInCooldown("plan_proposal")).toBe(true);
		expect(dedup.isInCooldown("goal_revision_proposal")).toBe(true);
	});

	test("isDuplicate check works without recent proposals", () => {
		const dedup = new ProposalDeduplication();
		const input = makeCreateInput({ title: "Standalone check" });
		// Register first
		dedup.recordHistory(input);
		// Check duplicate (should find the hash we just registered)
		const result = dedup.checkDuplicate(input, []);
		expect(result.isDuplicate).toBe(true);
	});
});
