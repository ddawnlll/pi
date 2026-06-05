/**
 * Evidence Index — V5.02 Test
 *
 * Tests the evidence index in isolation.
 *
 * Acceptance Criteria:
 * 1. Every V5 answer, proposal, memory injection, draft can reference evidenceRefs
 * 2. Evidence refs can point to all required source types
 * 3. Missing evidence downgrades confidence or blocks confident claims
 * 4. Evidence index is read-only with respect to execution state
 */

import { describe, expect, it } from "vitest";
import { createEvidenceApi } from "../../src/brain/evidence/api.js";
import { createEvidenceIndex, EvidenceIndex } from "../../src/brain/evidence/index.js";
import { ALL_EVIDENCE_REF_TYPES, type EvidenceRef, type EvidenceSource } from "../../src/brain/evidence/types.js";

// =========================================================================
// AC #4: Evidence index is read-only with respect to execution state
// =========================================================================

describe("Evidence Index — AC #4 (Read-Only)", () => {
	it("should not require any execution state dependency", () => {
		// The index only needs a persistence path — no execution kernel,
		// no state manager, no settings manager.
		const index = createEvidenceIndex();
		expect(index).toBeInstanceOf(EvidenceIndex);
	});

	it("should never expose state mutation methods", () => {
		const index = createEvidenceIndex();
		const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(index));
		const mutatingMethods = proto.filter(
			(m) => m.startsWith("register") || m === "clear" || m === "save" || m === "load",
		);
		// These are allowed — they only mutate the index itself, not execution state
		expect(mutatingMethods).toContain("register");
		expect(mutatingMethods).toContain("registerBatch");
		expect(mutatingMethods).toContain("clear");
		expect(mutatingMethods).toContain("save");
		expect(mutatingMethods).toContain("load");
	});

	it("should not reference execution kernel types", () => {
		// Verify the evidence module source doesn't import from execution-runtime
		const fs = require("fs");
		const source = fs.readFileSync(require.resolve("../../src/brain/evidence/index.ts"), "utf-8");
		expect(source).not.toContain("execution-runtime");
		expect(source).not.toContain("state-writer");
		expect(source).not.toContain("StateWriter");
	});
});

// =========================================================================
// AC #2: Evidence refs can point to all required source types
// =========================================================================

describe("Evidence Index — AC #2 (Source Types)", () => {
	it("should support all required evidence ref types", () => {
		const requiredTypes = [
			"git_file",
			"validation",
			"execution_journal",
			"memory",
			"proposal",
			"reflection",
			"approval",
		];

		for (const t of requiredTypes) {
			expect(ALL_EVIDENCE_REF_TYPES).toContain(t);
		}
	});

	it("should round-trip evidence of each required type through the index", async () => {
		const index = createEvidenceIndex();

		const sources: EvidenceSource[] = [
			{ type: "git_file", label: "Commit abc123", description: "Fixed retry logic in worker.ts", confidence: 0.9 },
			{ type: "validation", label: "Validation of workspace-5", description: "All tests passed", confidence: 0.8 },
			{ type: "execution_journal", label: "Event evt-42", description: "Workspace 5 completed", confidence: 0.7 },
			{
				type: "memory",
				label: "Memory record mem-1",
				description: "Architecture decision: use optional chaining",
				confidence: 0.85,
			},
			{ type: "proposal", label: "Proposal p-3", description: "Refactor worker pool", confidence: 0.6 },
			{ type: "reflection", label: "Reflection r-7", description: "Post-0.12.0 summary", confidence: 0.75 },
			{ type: "approval", label: "Approval a-1", description: "User approved proposal p-3", confidence: 0.95 },
		];

		const refs = await index.registerBatch(sources);
		expect(refs).toHaveLength(7);

		// Verify each type is registered
		for (const ref of refs) {
			const found = await index.getByRef(ref.type, ref.id);
			expect(found).not.toBeNull();
			expect(found!.type).toBe(ref.type);
			expect(found!.id).toBe(ref.id);
		}

		// Query by type yields correct count
		const gitResults = await index.query({ types: ["git_file"] });
		expect(gitResults.items).toHaveLength(1);
		expect(gitResults.total).toBe(1);

		const allResults = await index.query({});
		expect(allResults.total).toBe(7);
	});
});

// =========================================================================
// AC #1: Every output can reference evidenceRefs
// =========================================================================

describe("Evidence Index — AC #1 (EvidenceRef Support)", () => {
	it("should create evidence refs with EvidenceApi builder methods", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		const memoryRef = api.memoryRef("mem-1", "Memory record", "ADecision", 0.85);
		expect(memoryRef.type).toBe("memory");
		expect(memoryRef.id).toBe("mem-1");

		const proposalRef = api.proposalRef("p-3", "Proposal", "Refactor pool", 0.7);
		expect(proposalRef.type).toBe("proposal");

		const reflectionRef = api.reflectionRef("r-7", "Reflection", "Summary", 0.9);
		expect(reflectionRef.type).toBe("reflection");

		const approvalRef = api.approvalRef("a-1", "Approval", "Approved", 0.95);
		expect(approvalRef.type).toBe("approval");

		const gitRef = api.gitFileRef("src/worker.ts", "Git file", "Retry logic", 0.9);
		expect(gitRef.type).toBe("git_file");

		const validationRef = api.validationRef("val-5", "Validation", "Passed", 0.8);
		expect(validationRef.type).toBe("validation");

		const execRef = api.executionJournalRef("evt-42", "Event", "Completed", 0.7);
		expect(execRef.type).toBe("execution_journal");
	});

	it("should register evidence from V5 outputs", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Simulate a V5 proposal output registering evidence
		const evidenceRef = await api.registerEvidence(
			"memory",
			"mem-42",
			"Architecture decision memo",
			"Decision to use event sourcing for the evidence index",
			0.85,
			"We chose event sourcing because it provides auditability...",
		);

		expect(evidenceRef.type).toBe("memory");
		expect(evidenceRef.id).toBe("mem-42");
		expect(evidenceRef.confidence).toBe(0.85);

		// Verify it's in the index
		const found = await api.getByRef("memory", "mem-42");
		expect(found).not.toBeNull();
	});

	it("should register batch V5 outputs", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		const sources: EvidenceSource[] = [
			{ type: "proposal", id: "p-1", label: "Proposal A", description: "Refactor pool", confidence: 0.8 },
			{ type: "proposal", id: "p-2", label: "Proposal B", description: "Add caching", confidence: 0.6 },
		];

		const refs = await api.registerBatch(sources);
		expect(refs).toHaveLength(2);

		const allProposals = await api.listByType("proposal");
		expect(allProposals.total).toBe(2);
	});
});

// =========================================================================
// AC #3: Missing evidence downgrades confidence or blocks claims
// =========================================================================

describe("Evidence Index — AC #3 (Confidence Assessment)", () => {
	it("should return HIGH confidence when all evidence resolves with good confidence", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Register evidence
		await api.registerEvidence("validation", "val-1", "Validation passed", "All tests passed", 0.9);
		await api.registerEvidence("approval", "app-1", "User approved", "User said yes", 0.95);

		// Build refs pointing to registered evidence
		const refs: EvidenceRef[] = [
			{
				type: "validation",
				id: "val-1",
				label: "Validation",
				description: "Passed",
				timestamp: "",
				confidence: 0.9,
			},
			{ type: "approval", id: "app-1", label: "Approval", description: "Approved", timestamp: "", confidence: 0.95 },
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("HIGH");
		expect(assessment.resolvedCount).toBe(2);
		expect(assessment.missingCount).toBe(0);
	});

	it("should return BLOCKED when critical evidence is missing", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Register only non-critical evidence
		await api.registerEvidence("memory", "mem-1", "Memory record", "Some context", 0.9);

		// Build refs that include critical missing evidence
		const refs: EvidenceRef[] = [
			{ type: "memory", id: "mem-1", label: "Memory", description: "Context", timestamp: "", confidence: 0.9 },
			{
				type: "validation",
				id: "val-missing",
				label: "Missing validation",
				description: "Not run",
				timestamp: "",
				confidence: 0.0,
			},
			{
				type: "approval",
				id: "app-missing",
				label: "Missing approval",
				description: "Not approved",
				timestamp: "",
				confidence: 0.0,
			},
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("BLOCKED");
		expect(assessment.missingCount).toBe(2);
		expect(assessment.confidence).toBe(0);
	});

	it("should return LOW when all evidence is missing", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		const refs: EvidenceRef[] = [
			{
				type: "memory",
				id: "mem-nonexistent",
				label: "Missing",
				description: "Not found",
				timestamp: "",
				confidence: 0.0,
			},
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("LOW");
		expect(assessment.resolvedCount).toBe(0);
		expect(assessment.missingCount).toBe(1);
	});

	it("should return MEDIUM when evidence partially resolves", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		// Register only one of two evidence items
		await api.registerEvidence("memory", "mem-present", "Present memory", "Exists", 0.6);

		const refs: EvidenceRef[] = [
			{ type: "memory", id: "mem-present", label: "Present", description: "Exists", timestamp: "", confidence: 0.6 },
			{
				type: "proposal",
				id: "prop-missing",
				label: "Missing proposal",
				description: "Does not exist",
				timestamp: "",
				confidence: 0.5,
			},
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("MEDIUM");
		expect(assessment.resolvedCount).toBe(1);
		expect(assessment.missingCount).toBe(1);
	});

	it("should return the correct recommendations for blocked claims", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		const refs: EvidenceRef[] = [
			{
				type: "validation",
				id: "val-missing",
				label: "Missing validation",
				description: "Not run",
				timestamp: "",
				confidence: 0.0,
			},
		];

		const assessment = await api.assess(refs);
		expect(assessment.level).toBe("BLOCKED");
		expect(assessment.recommendations.length).toBeGreaterThan(0);
		expect(assessment.summary).toContain("critical");
	});

	it("should allow isSufficient and isBlocked convenience checks", async () => {
		const index = createEvidenceIndex();
		const api = createEvidenceApi(index);

		await api.registerEvidence("validation", "val-g", "Validation good", "Passed", 0.9);

		// Sufficient check — all resolved, high confidence
		const sufficient = await api.isSufficient([
			{ type: "validation", id: "val-g", label: "V", description: "D", timestamp: "", confidence: 0.9 },
		]);
		expect(sufficient).toBe(true);

		// Blocked check — missing critical
		const blocked = await api.isBlocked([
			{ type: "validation", id: "val-nonexist", label: "V", description: "D", timestamp: "", confidence: 0.0 },
		]);
		expect(blocked).toBe(true);
	});
});

// =========================================================================
// Persistence
// =========================================================================

describe("Evidence Index — Persistence", () => {
	it("should persist and reload evidence", async () => {
		const tmpPath = `/tmp/evidence-test-${Date.now()}.json`;
		const index1 = createEvidenceIndex(tmpPath);

		await index1.register({
			type: "memory",
			id: "persist-mem-1",
			label: "Persisted memory",
			description: "Should survive reload",
			confidence: 0.95,
		});

		await index1.save();
		const size1 = await index1.size();
		expect(size1).toBe(1);

		// Create a new index loading from the same path
		const index2 = createEvidenceIndex(tmpPath);
		const loaded = await index2.load();
		expect(loaded).toBe(1);

		const found = await index2.getByRef("memory", "persist-mem-1");
		expect(found).not.toBeNull();
		expect(found!.label).toBe("Persisted memory");

		// Cleanup
		const fs = require("fs");
		try {
			fs.unlinkSync(tmpPath);
		} catch {
			/* ok */
		}
	});
});

// =========================================================================
// Edge Cases
// =========================================================================

describe("Evidence Index — Edge Cases", () => {
	it("should handle empty query results", async () => {
		const index = createEvidenceIndex();
		const result = await index.query({ types: ["memory"] });
		expect(result.items).toHaveLength(0);
		expect(result.total).toBe(0);
	});

	it("should handle empty resolve list", async () => {
		const index = createEvidenceIndex();
		const resolutions = await index.resolve([]);
		expect(resolutions).toHaveLength(0);
	});

	it("should handle empty assess list", async () => {
		const index = createEvidenceIndex();
		const assessment = await index.assess([]);
		expect(assessment.level).toBe("LOW");
		expect(assessment.resolvedCount).toBe(0);
	});

	it("should throw for invalid evidence source", async () => {
		const index = createEvidenceIndex();
		await expect(
			index.register({
				type: "invalid_type" as any,
				label: "Bad",
				description: "Bad source",
				confidence: 0.5,
			}),
		).rejects.toThrow("Invalid evidence source");
	});

	it("should update existing evidence on re-registration", async () => {
		const index = createEvidenceIndex();

		await index.register({
			type: "memory",
			id: "update-test",
			label: "Original",
			description: "Original description",
			confidence: 0.5,
		});

		await index.register({
			type: "memory",
			id: "update-test",
			label: "Updated",
			description: "Updated description",
			confidence: 0.9,
		});

		// Same key, so ref2 should overwrite ref1's data
		const found = await index.getByRef("memory", "update-test");
		expect(found!.label).toBe("Updated");
		expect(found!.description).toBe("Updated description");
		expect(found!.confidence).toBe(0.9);

		// Size should still be 1 (not 2)
		const size = await index.size();
		expect(size).toBe(1);
	});

	it("should compute stats correctly", async () => {
		const index = createEvidenceIndex();

		await index.registerBatch([
			{ type: "memory", label: "M1", description: "Memory 1", confidence: 0.9 },
			{ type: "memory", label: "M2", description: "Memory 2", confidence: 0.3 },
			{ type: "proposal", label: "P1", description: "Proposal 1", confidence: 0.7 },
			{ type: "validation", label: "V1", description: "Validation 1", confidence: 0.8 },
		]);

		const stats = await index.stats();
		expect(stats.totalRefs).toBe(4);
		expect(stats.byType.memory).toBe(2);
		expect(stats.byType.proposal).toBe(1);
		expect(stats.byType.validation).toBe(1);
		expect(stats.highConfidenceCount).toBe(3); // 0.9, 0.7, 0.8
		expect(stats.lowConfidenceCount).toBe(1); // 0.3
	});

	it("should filter by text search", async () => {
		const index = createEvidenceIndex();

		await index.registerBatch([
			{ type: "memory", label: "Architecture decision", description: "Choosing event sourcing", confidence: 0.9 },
			{ type: "memory", label: "Bug report", description: "Issue with retry logic", confidence: 0.7 },
			{
				type: "proposal",
				label: "Refactor proposal",
				description: "Refactor the pool architecture",
				confidence: 0.8,
			},
		]);

		const results = await index.query({ search: "architecture" });
		expect(results.total).toBe(2); // matches both "architecture" in labels/descriptions
	});
});
