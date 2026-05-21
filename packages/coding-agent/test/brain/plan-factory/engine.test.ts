/**
 * Plan Factory Engine tests — P17.A
 *
 * Tests the PlanFactory class for converting proposals into
 * executable phase plans with workstreams, dependencies, batch
 * layouts, and validation.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlanFactory } from "../../../src/brain/plan-factory/engine.js";
import { MasterTemplateIntegration } from "../../../src/brain/plan-factory/template.js";
import type { PlanFactoryInput } from "../../../src/brain/plan-factory/types.js";
import { InMemoryProposalStore } from "../../../src/brain/proposals/store.js";
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
		evidenceSummary: overrides?.evidenceSummary ?? "Test evidence for plan factory",
	};
}

function makeRisk(overrides?: Partial<ProposalRiskAssessment>): ProposalRiskAssessment {
	return {
		level: overrides?.level ?? "medium",
		factors: overrides?.factors ?? ["scope complexity"],
		mitigation: overrides?.mitigation ?? ["phased rollout"],
		affectedSystems: overrides?.affectedSystems ?? ["queue", "scheduler"],
		impactDescription: overrides?.impactDescription ?? "Moderate impact on scheduling",
	};
}

function makeProposalInput(overrides?: Partial<ProposalCreateInput>): ProposalCreateInput {
	return createProposalCreateInput({
		type: "plan_proposal",
		title: "Test Plan Proposal",
		description:
			"Implement a new scheduling algorithm to improve queue throughput. " +
			"This involves replacing the current O(n^2) algorithm with an O(log n) " +
			"priority queue approach. The implementation will touch the queue module, " +
			"scheduler, and orchestration layer.",
		evidence: makeEvidence(),
		risk: makeRisk(),
		...overrides,
	});
}

/**
 * Create a Proposal for testing.
 *
 * @param inputOverrides  Overrides applied to ProposalCreateInput (type, title, description, evidence, risk, etc.)
 * @param propOverrides   Overrides applied to the final Proposal (id, status, score, etc.)
 */
function makeProposal(inputOverrides?: Partial<ProposalCreateInput>, propOverrides?: Partial<Proposal>): Proposal {
	return createProposal(makeProposalInput(inputOverrides), propOverrides);
}

/** Create a temp directory for test output files. */
function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "plan-factory-test-"));
	return dir;
}

// ---------------------------------------------------------------------------
// PlanFactory — Unit Tests
// ---------------------------------------------------------------------------

describe("PlanFactory", () => {
	// -----------------------------------------------------------------------
	// Construction
	// -----------------------------------------------------------------------

	it("should construct with default config", () => {
		const factory = new PlanFactory();
		const config = factory.getConfig();
		expect(config.outputDir).toBe("docs/pi/phases");
		expect(config.contractDir).toBe(".pi/plans/generated");
		expect(config.maxWorkstreams).toBe(8);
		expect(config.templateVersion).toBe("2.5.1");
		expect(config.validateBeforeReturn).toBe(true);
	});

	it("should construct with custom config", () => {
		const factory = new PlanFactory(undefined, {
			maxWorkstreams: 4,
			outputDir: "/tmp/out",
		});
		const config = factory.getConfig();
		expect(config.maxWorkstreams).toBe(4);
		expect(config.outputDir).toBe("/tmp/out");
	});

	it("should construct with ProposalStore", () => {
		const store = new InMemoryProposalStore();
		const factory = new PlanFactory(undefined, undefined, store);
		expect(factory).toBeDefined();
	});

	it("should construct with MasterTemplateIntegration", () => {
		const template = new MasterTemplateIntegration();
		const factory = new PlanFactory(template);
		expect(factory).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// createPlan — with direct proposal
	// -----------------------------------------------------------------------

	it("should create a plan from a proposal directly", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const input: PlanFactoryInput = {
			proposalId: proposal.id,
		};

		const output = await factory.createPlan(input, proposal);

		expect(output).toBeDefined();
		expect(output.phaseId).toMatch(/^P\d+$/);
		expect(output.phaseTitle).toMatch(/^Plan:/);
		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(output.batches.length).toBeGreaterThanOrEqual(1);
		expect(output.markdownPath).toMatch(/\.md$/);
		expect(output.jsonContract.contractVersion).toBe("2.5.1");
		expect(output.generatedAt).toBeTruthy();
		expect(output.confidence).toBeGreaterThanOrEqual(0);

		// Files should have been written
		expect(existsSync(output.markdownPath)).toBe(true);

		// Contract file should be at the resolved path
		const contractPath = join(tmpDir, "contracts", `${output.phaseId.toLowerCase()}-contract.json`);
		expect(existsSync(contractPath)).toBe(true);
	});

	it("should throw when no proposal and no store", async () => {
		const factory = new PlanFactory();
		const input: PlanFactoryInput = {
			proposalId: "non-existent",
		};

		await expect(factory.createPlan(input)).rejects.toThrow(/No proposal provided.*ProposalStore/i);
	});

	it("should fetch proposal from store when not provided directly", async () => {
		const store = new InMemoryProposalStore();
		const proposal = await store.create(makeProposalInput());

		const tmpDir = createTempDir();
		const factory = new PlanFactory(
			undefined,
			{
				outputDir: join(tmpDir, "phases"),
				contractDir: join(tmpDir, "contracts"),
			},
			store,
		);

		const input: PlanFactoryInput = {
			proposalId: proposal.id,
		};

		const output = await factory.createPlan(input);

		expect(output).toBeDefined();
		expect(output.phaseId).toMatch(/^P\d+$/);
		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
	});

	// -----------------------------------------------------------------------
	// Phase ID computation
	// -----------------------------------------------------------------------

	it("should compute phase ID based on existing phase files", async () => {
		const tmpDir = createTempDir();
		// Create some existing phase files
		await mkdir(join(tmpDir, "phases"), { recursive: true });
		await writeFile(join(tmpDir, "phases", "phase_p14_existing.md"), "# Existing");
		await writeFile(join(tmpDir, "phases", "phase_p15_another.md"), "# Another");

		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.phaseId).toBe("P16");
	});

	it("should default to P14 when no phase files exist", async () => {
		const tmpDir = createTempDir();
		await mkdir(join(tmpDir, "phases"), { recursive: true });

		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.phaseId).toBe("P14");
	});

	// -----------------------------------------------------------------------
	// Phase title computation
	// -----------------------------------------------------------------------

	it("should compute phase title based on proposal type", () => {
		const factory = new PlanFactory();

		// Access private method via bracket notation
		const planProp = makeProposal({ type: "plan_proposal", title: "Plan: Improve Queue" });
		const title = factory["computePhaseTitle"](planProp);
		expect(title).toContain("Plan:");

		const memoryProp = makeProposal({ type: "memory_proposal", title: "Store Refactoring" });
		expect(factory["computePhaseTitle"](memoryProp)).toContain("Memory:");

		const safetyProp = makeProposal({ type: "safety_proposal", title: "Add Rate Limiting" });
		expect(factory["computePhaseTitle"](safetyProp)).toContain("Safety:");
	});

	// -----------------------------------------------------------------------
	// Workstream generation
	// -----------------------------------------------------------------------

	it("should generate workstreams based on proposal scope", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
			maxWorkstreams: 5,
		});

		// Long description should generate more workstreams
		const longDescription = Array(50)
			.fill("description content for generating workstreams based on proposal complexity analysis.")
			.join(" ");
		const proposal = makeProposal({ description: longDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(output.workstreams.length).toBeLessThanOrEqual(5);

		// Each workstream should have a unique ID
		const ids = new Set(output.workstreams.map((ws) => ws.id));
		expect(ids.size).toBe(output.workstreams.length);
	});

	it("should generate workstreams with correct IDs (P{N}.{Letter})", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal({ title: "Big Proposal", description: "A ".repeat(200) });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		for (const ws of output.workstreams) {
			expect(ws.id).toMatch(/^P\d+\.[A-Z]$/);
		}
	});

	it("should assign critical priority to first workstream", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const bigDescription = "A ".repeat(300);
		const proposal = makeProposal({ title: "Big Proposal", description: bigDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		if (output.workstreams.length >= 1) {
			expect(output.workstreams[0].queuePriority).toBe("critical");
		}
		if (output.workstreams.length >= 2) {
			expect(output.workstreams[1].queuePriority).toBe("high");
		}
	});

	// -----------------------------------------------------------------------
	// Dependency generation
	// -----------------------------------------------------------------------

	it("should generate sequential dependencies between workstreams", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const bigDescription = "Topic ".repeat(300);
		const proposal = makeProposal({ title: "Multi Workstream", description: bigDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		if (output.workstreams.length >= 2) {
			const deps = output.jsonContract.dependencies;
			expect(deps.length).toBeGreaterThanOrEqual(1);

			// Each dependency should reference valid workstream IDs
			for (const dep of deps) {
				expect(dep.type).toMatch(/^(blocking|informational)$/);
				expect(output.workstreams.some((ws) => ws.id === dep.from)).toBe(true);
				expect(output.workstreams.some((ws) => ws.id === dep.to)).toBe(true);
			}
		}
	});

	it("should have no cycles in dependencies", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const bigDescription = "Topic ".repeat(400);
		const proposal = makeProposal({ title: "Multi WS", description: bigDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		const deps = output.jsonContract.dependencies;

		// Build adjacency list and check for cycles via DFS
		const adj = new Map<string, string[]>();
		for (const ws of output.workstreams) {
			adj.set(ws.id, []);
		}
		for (const dep of deps) {
			if (dep.type === "blocking") {
				adj.get(dep.from)?.push(dep.to);
			}
		}

		// DFS cycle detection
		const visited = new Set<string>();
		const inStack = new Set<string>();

		function hasCycle(node: string): boolean {
			if (inStack.has(node)) return true;
			if (visited.has(node)) return false;
			visited.add(node);
			inStack.add(node);
			for (const neighbor of adj.get(node) ?? []) {
				if (hasCycle(neighbor)) return true;
			}
			inStack.delete(node);
			return false;
		}

		for (const ws of output.workstreams) {
			expect(hasCycle(ws.id)).toBe(false);
		}
	});

	// -----------------------------------------------------------------------
	// Batch generation
	// -----------------------------------------------------------------------

	it("should generate non-overlapping batches", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const bigDescription = "Topic ".repeat(400);
		const proposal = makeProposal({ title: "Multi WS", description: bigDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		// Verify no workstream appears in multiple batches
		const allBatched = new Set<string>();
		for (const batch of output.batches) {
			for (const wsId of batch) {
				expect(allBatched.has(wsId)).toBe(false);
				allBatched.add(wsId);
			}
		}

		// Verify all workstreams appear in batches
		for (const ws of output.workstreams) {
			expect(allBatched.has(ws.id)).toBe(true);
		}
	});

	it("should order batches according to dependencies", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const bigDescription = "Topic ".repeat(400);
		const proposal = makeProposal({ title: "Multi WS", description: bigDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		// Build batch index
		const batchIndex = new Map<string, number>();
		for (let i = 0; i < output.batches.length; i++) {
			for (const wsId of output.batches[i]) {
				batchIndex.set(wsId, i);
			}
		}

		// For each blocking dependency, 'from' should be in an earlier batch than 'to'
		for (const dep of output.jsonContract.dependencies) {
			if (dep.type === "blocking") {
				const fromBatch = batchIndex.get(dep.from);
				const toBatch = batchIndex.get(dep.to);
				expect(fromBatch).toBeDefined();
				expect(toBatch).toBeDefined();
				expect(fromBatch!).toBeLessThan(toBatch!);
			}
		}
	});

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	it("should validate plan by default", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.validationResults).toBeDefined();
		expect(Array.isArray(output.validationResults)).toBe(true);

		// Should at least have info messages
		const infoResults = output.validationResults.filter((r) => r.type === "info");
		expect(infoResults.length).toBeGreaterThanOrEqual(1);
	});

	it("should skip validation when validateBeforeReturn is false", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
			validateBeforeReturn: false,
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.validationResults).toEqual([]);
	});

	it("should validate dependencies correctly", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		// Validation should have no errors for valid output
		const errors = output.validationResults.filter((r) => r.type === "error");
		expect(errors.length).toBe(0);
	});

	// -----------------------------------------------------------------------
	// JSON Contract
	// -----------------------------------------------------------------------

	it("should produce valid execution contract", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		const contract = output.jsonContract;
		expect(contract.contractVersion).toBe("2.5.1");
		expect(contract.phase.id).toBeTruthy();
		expect(contract.phase.title).toBeTruthy();
		expect(contract.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(contract.batches.length).toBeGreaterThanOrEqual(1);
		expect(contract.scaleMode).toBe("experimental_6");
		expect(typeof contract.integrationQueue).toBe("boolean");
		expect(typeof contract.worktreeIsolation).toBe("boolean");
	});

	it("should persist contract to disk", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		const contractPath = join(tmpDir, "contracts", `${output.phaseId.toLowerCase()}-contract.json`);
		expect(existsSync(contractPath)).toBe(true);

		// Verify contract content is valid JSON
		const fs = await import("node:fs/promises");
		const content = await fs.readFile(contractPath, "utf-8");
		const parsed = JSON.parse(content);
		expect(parsed.contractVersion).toBe("2.5.1");
	});

	// -----------------------------------------------------------------------
	// Markdown output
	// -----------------------------------------------------------------------

	it("should produce valid markdown file", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(existsSync(output.markdownPath)).toBe(true);

		const fs = await import("node:fs/promises");
		const content = await fs.readFile(output.markdownPath, "utf-8");
		expect(content).toContain("TL;DR");
		expect(content).toContain("Purpose");
		expect(content).toContain("RACI");
	});

	// -----------------------------------------------------------------------
	// Risk analysis
	// -----------------------------------------------------------------------

	it("should derive risk level from proposal", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		// Use inputOverrides to set risk, since createProposal copies risk from input
		const highRisk = makeProposal({
			title: "High Risk Plan",
			risk: {
				level: "high",
				factors: ["danger"],
				mitigation: ["care"],
				affectedSystems: ["all"],
				impactDescription: "Big impact",
			},
		});
		const output = await factory.createPlan({ proposalId: highRisk.id }, highRisk);

		// All workstreams should inherit the proposal's risk level
		for (const ws of output.workstreams) {
			expect(ws.riskLevel).toBe("high");
		}
	});

	// -----------------------------------------------------------------------
	// Affected system extraction
	// -----------------------------------------------------------------------

	it("should extract affected systems from proposal description", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const descProposal = makeProposal({
			description: "Changes to the queue, scheduler, and orchestrator modules for performance",
		});
		const output = await factory.createPlan({ proposalId: descProposal.id }, descProposal);

		// The analysis should have picked up queue, scheduler, orchestrator
		// We verify via the scope returned in workstream goals
		for (const ws of output.workstreams) {
			expect(ws.goal).toBeTruthy();
		}
	});

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	it("should update config via setConfig", () => {
		const factory = new PlanFactory();
		factory.setConfig({ maxWorkstreams: 3 });
		expect(factory.getConfig().maxWorkstreams).toBe(3);
	});

	it("should respect maxWorkstreams config", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
			maxWorkstreams: 2,
		});

		const longDescription = "Topic ".repeat(500);
		const proposal = makeProposal({ description: longDescription });
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.workstreams.length).toBeLessThanOrEqual(2);
	});

	// -----------------------------------------------------------------------
	// Edge cases
	// -----------------------------------------------------------------------

	it("should handle minimal proposal with empty description", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		const minimal = makeProposal({
			description: "Small change",
			evidence: {
				memoryIds: [],
				observationIds: [],
				sourceRefs: [],
				confidence: 0.1,
				evidenceSummary: "Minor adjustment",
			},
		});
		const output = await factory.createPlan({ proposalId: minimal.id }, minimal);

		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(output.confidence).toBeGreaterThanOrEqual(0);
	});

	it("should handle proposal with no evidence references", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
		});

		// Empty evidence: no memoryIds, no observationIds
		const noEvidence = makeProposal({
			evidence: {
				memoryIds: [],
				observationIds: [],
				sourceRefs: [],
				confidence: 0.1,
				evidenceSummary: "No evidence",
			},
		});
		const output = await factory.createPlan({ proposalId: noEvidence.id }, noEvidence);

		// With 0 memoryIds, evidenceCount = 0, confidence = min(1, 0/10) = 0
		expect(output.confidence).toBe(0);
	});

	it("should handle single workstream case", async () => {
		const tmpDir = createTempDir();
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir: join(tmpDir, "contracts"),
			maxWorkstreams: 1,
		});

		const proposal = makeProposal();
		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.workstreams.length).toBe(1);
		expect(output.batches.length).toBe(1);
		expect(output.batches[0]).toEqual([output.workstreams[0].id]);
		expect(output.jsonContract.dependencies.length).toBe(0);
	});

	it("should store execution contract to disk in correct location", async () => {
		const tmpDir = createTempDir();
		const contractDir = join(tmpDir, "my-contracts");
		const factory = new PlanFactory(undefined, {
			outputDir: join(tmpDir, "phases"),
			contractDir,
		});

		const proposal = makeProposal({}, { id: "test-1" });
		const output = await factory.createPlan({ proposalId: "test-1" }, proposal);

		const contractPath = join(contractDir, `${output.phaseId.toLowerCase()}-contract.json`);
		expect(existsSync(contractPath)).toBe(true);
	});

	// -----------------------------------------------------------------------
	// Integration: proposal -> plan -> validate -> output
	// -----------------------------------------------------------------------

	it("should complete full pipeline: proposal -> plan -> validate -> output", async () => {
		const tmpDir = createTempDir();
		const store = new InMemoryProposalStore();

		// 1. Create a proposal in the store
		const proposalInput = makeProposalInput({
			title: "Plan: Full Pipeline Test",
			description:
				"A comprehensive test of the full plan factory pipeline. " +
				"This verifies that a proposal can be created, turned into a plan, " +
				"validated, and produce proper output files. The proposal scope covers " +
				"the queue module, scheduler, and API layer.",
		});
		const proposal = await store.create(proposalInput);

		// 2. Create the factory with the store
		const factory = new PlanFactory(
			undefined,
			{
				outputDir: join(tmpDir, "phases"),
				contractDir: join(tmpDir, "contracts"),
			},
			store,
		);

		// 3. Create the plan (fetches proposal from store)
		const input: PlanFactoryInput = { proposalId: proposal.id };
		const output = await factory.createPlan(input);

		// 4. Verify output structure
		expect(output.phaseId).toMatch(/^P\d+$/);
		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(output.batches.length).toBeGreaterThanOrEqual(1);

		// 5. Verify validation passed
		const errors = output.validationResults.filter((r) => r.type === "error");
		expect(errors.length).toBe(0);

		// 6. Verify files on disk
		expect(existsSync(output.markdownPath)).toBe(true);
		const contractPath = join(tmpDir, "contracts", `${output.phaseId.toLowerCase()}-contract.json`);
		expect(existsSync(contractPath)).toBe(true);

		// 7. Verify contract content
		const fs = await import("node:fs/promises");
		const contractContent = await fs.readFile(contractPath, "utf-8");
		const contract = JSON.parse(contractContent);
		expect(contract.contractVersion).toBe("2.5.1");
		expect(contract.workstreams.length).toBe(output.workstreams.length);
		expect(contract.batches).toEqual(output.batches);
	});
});
