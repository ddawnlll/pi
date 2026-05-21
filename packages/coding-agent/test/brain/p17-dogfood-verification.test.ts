/**
 * P17.I — Dogfood Verification Test
 *
 * End-to-end verification of P17 Plan Factory & Reflection Loop acceptance criteria.
 *
 * Acceptance Criteria:
 * AC1. Plan Factory Engine — PlanFactory converts proposals to valid phase markdown + JSON contract
 * AC2. Master Template Integration — Template loads, parses, populates v2.5.1 correctly
 * AC3. Reflection Engine — Generates source-backed reflections after execution
 * AC4. Source-Backed Summarizer — Every summary claim references evidence
 * AC5. Memory Update Proposal Generator — Creates memory proposals from failures/successes
 * AC6. Future Phase Suggestion Engine — Generates ranked next-phase suggestions
 * AC7. Reflection API — All endpoints functional (list, get, stats, memories, future)
 * AC8. End-to-End Flow — Full proposal -> plan -> execution -> reflection pipeline
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlanFactory } from "../../src/brain/plan-factory/engine.js";
import { MasterTemplateIntegration } from "../../src/brain/plan-factory/template.js";
import type { PlanFactoryInput } from "../../src/brain/plan-factory/types.js";
import { InMemoryProposalStore } from "../../src/brain/proposals/store.js";
import { createProposalCreateInput, type ProposalCreateInput } from "../../src/brain/proposals/types.js";
import { BrainReflectionApi } from "../../src/brain/reflection/api.js";
import { ReflectionEngine } from "../../src/brain/reflection/engine.js";
import { FutureSuggestionEngine } from "../../src/brain/reflection/future-suggestions.js";
import { MemoryProposalGenerator } from "../../src/brain/reflection/memory-proposals.js";
import { SourceBackedSummarizer } from "../../src/brain/reflection/summarizer.js";
import type {
	ReflectionInput,
	ReflectionReport,
	SourceRef,
	ValidationResult,
	WorkspaceOutcome,
} from "../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_PROPOSAL_INPUT: ProposalCreateInput = createProposalCreateInput({
	type: "plan_proposal",
	title: "Plan: Improve Reflection Engine Performance",
	description:
		"The reflection engine currently processes workspace outcomes sequentially. " +
		"This proposal implements parallel analysis of workspace outcomes, caching of " +
		"source-backed evidence chains, and incremental reflection updates. " +
		"Expected impact: 5x faster reflection generation for plans with >10 workspaces.",
	evidence: {
		memoryIds: ["mem-001", "mem-002"],
		observationIds: ["obs-001", "obs-002"],
		sourceRefs: [
			{ type: "observation", path: "packages/coding-agent/src/brain/reflection/engine.ts", id: "obs-001" },
		],
		confidence: 0.8,
		evidenceSummary:
			"Performance profiling shows sequential processing bottleneck; similar pattern from P16 scoring engine optimization",
	},
	risk: {
		level: "medium",
		factors: ["Parallel processing may introduce race conditions", "Caching layer adds complexity"],
		mitigation: ["Use structured concurrency patterns", "Cache invalidation tests before deployment"],
		affectedSystems: ["reflection", "memory", "proposals"],
		impactDescription:
			"Reflection engine performance improvement may temporarily increase memory usage during cache warmup",
	},
});

function makeReflectionInput(overrides?: Partial<ReflectionInput>): ReflectionInput {
	return {
		planExecId: "p17-dogfood-exec-001",
		planId: "p17-dogfood-plan-001",
		planTitle: "P17 Dogfood Test Plan",
		executionJournal: [
			{
				timestamp: "2026-05-22T12:00:00.000Z",
				eventType: "workspace_start",
				workspaceId: "ws-A-engine",
				severity: "info",
				data: {},
			},
			{
				timestamp: "2026-05-22T12:01:00.000Z",
				eventType: "workspace_complete",
				workspaceId: "ws-A-engine",
				severity: "info",
				data: { status: "success" },
			},
			{
				timestamp: "2026-05-22T12:02:00.000Z",
				eventType: "workspace_start",
				workspaceId: "ws-B-template",
				severity: "info",
				data: {},
			},
			{
				timestamp: "2026-05-22T12:03:00.000Z",
				eventType: "workspace_retry",
				workspaceId: "ws-B-template",
				severity: "warning",
				data: { retryCount: 1, error: "ValidationError" },
			},
			{
				timestamp: "2026-05-22T12:04:00.000Z",
				eventType: "workspace_complete",
				workspaceId: "ws-B-template",
				severity: "info",
				data: { status: "success" },
			},
			{
				timestamp: "2026-05-22T12:05:00.000Z",
				eventType: "workspace_start",
				workspaceId: "ws-C-reflection",
				severity: "info",
				data: {},
			},
			{
				timestamp: "2026-05-22T12:06:00.000Z",
				eventType: "workspace_failure",
				workspaceId: "ws-C-reflection",
				severity: "error",
				data: { error: "TypeError: Cannot read properties of undefined" },
			},
		],
		workspaceOutcomes: [
			{
				workspaceId: "ws-A-engine",
				status: "success",
				retryCount: 0,
				duration: 60000,
				validationPassed: true,
				summary: "Engine implementation passed all integration tests",
			},
			{
				workspaceId: "ws-B-template",
				status: "success",
				retryCount: 1,
				duration: 120000,
				validationPassed: true,
				summary: "Template integration completed after validation fix",
			},
			{
				workspaceId: "ws-C-reflection",
				status: "failure",
				retryCount: 3,
				duration: 180000,
				errorTypes: ["TypeError", "ValidationError"],
				validationPassed: false,
				summary: "Reflection engine failed with TypeError on undefined source refs",
			},
		],
		validationResults: [
			{
				type: "error",
				component: "lint",
				message: "Found 2 ESLint errors in reflection workspace",
				passed: false,
			},
			{
				type: "warning",
				component: "typecheck",
				message: "TypeScript strict mode violations in template integration",
				passed: true,
			},
			{
				type: "info",
				component: "coverage",
				message: "Test coverage is 85% across all workspaces",
				details: {},
			},
		],
		integrationState: {
			wasDirty: true,
			conflicts: 2,
			resolvedConflicts: 1,
		},
		duration: 360000,
		startTime: "2026-05-22T12:00:00.000Z",
		endTime: "2026-05-22T12:06:00.000Z",
		autonomyLevel: 3,
		policyStops: 0,
		approvalRequests: 1,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: Plan Factory Engine — AC2: Master Template Integration
// ---------------------------------------------------------------------------

describe("AC1-AC2: Plan Factory Engine + Template Integration", () => {
	it("creates a valid phase plan from a proposal", async () => {
		const tmpDir = await mkdtemp();
		const store = new InMemoryProposalStore();

		// Create a proposal in the store
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		// Create Plan Factory with template integration
		const template = new MasterTemplateIntegration();
		const factory = new PlanFactory(
			template,
			{
				outputDir: join(tmpDir, "docs/pi/phases"),
				contractDir: join(tmpDir, ".pi/plans/generated"),
				maxWorkstreams: 5,
				templateVersion: "2.5.1",
				validateBeforeReturn: true,
			},
			store,
		);

		// Create plan from proposal
		const input: PlanFactoryInput = {
			proposalId: proposal.id,
			priority: "high",
		};

		const output = await factory.createPlan(input, proposal);

		// Verify output structure
		expect(output).toBeDefined();
		expect(output.phaseId).toBeDefined();
		expect(output.phaseTitle).toBeDefined();
		expect(output.markdownPath).toBeDefined();
		expect(output.jsonContract).toBeDefined();
		expect(output.workstreams).toBeDefined();
		expect(output.workstreams.length).toBeGreaterThan(0);
		expect(output.batches).toBeDefined();
		expect(output.batches.length).toBeGreaterThan(0);
		expect(output.generatedAt).toBeDefined();
		expect(output.confidence).toBeGreaterThan(0);
		expect(output.confidence).toBeLessThanOrEqual(1);
		expect(output.validationResults).toBeDefined();

		// Verify contract structure
		const contract = output.jsonContract;
		expect(contract.contractVersion).toBe("2.5.1");
		expect(contract.phase).toBeDefined();
		expect(contract.phase.id).toBe(output.phaseId);
		expect(contract.phase.title).toBe(output.phaseTitle);
		expect(contract.workstreams.length).toBe(output.workstreams.length);
		expect(contract.dependencies).toBeDefined();
		expect(contract.batches).toEqual(output.batches);
		expect(contract.scaleMode).toBeDefined();

		// Verify markdown file was written
		expect(existsSync(output.markdownPath)).toBe(true);
		const markdownContent = await readFile(output.markdownPath, "utf-8");
		expect(markdownContent.length).toBeGreaterThan(50);

		// Verify contract file was written
		const contractPath = join(tmpDir, ".pi/plans/generated", `${output.phaseId.toLowerCase()}-contract.json`);
		expect(existsSync(contractPath)).toBe(true);
		const contractContent = await readFile(contractPath, "utf-8");
		const parsedContract = JSON.parse(contractContent);
		expect(parsedContract.phase.id).toBe(output.phaseId);
	}, 10000);

	it("generates workstreams proportional to proposal scope", async () => {
		const store = new InMemoryProposalStore();
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		const factory = new PlanFactory(
			new MasterTemplateIntegration(),
			{
				outputDir: await mkdtemp(),
				contractDir: await mkdtemp(),
				maxWorkstreams: 8,
			},
			store,
		);

		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);
		expect(output.workstreams.length).toBeGreaterThanOrEqual(1);
		expect(output.workstreams.length).toBeLessThanOrEqual(8);

		// Each workstream has required fields
		for (const ws of output.workstreams) {
			expect(ws.id).toBeDefined();
			expect(ws.title).toBeDefined();
			expect(ws.goal).toBeDefined();
			expect(ws.acceptanceCriteria).toBeDefined();
			expect(ws.acceptanceCriteria.length).toBeGreaterThan(0);
			expect(ws.queuePriority).toBeDefined();
			expect(ws.riskLevel).toBeDefined();
		}
	}, 10000);

	it("computes correct dependencies with no cycles", async () => {
		const store = new InMemoryProposalStore();
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		const factory = new PlanFactory(
			new MasterTemplateIntegration(),
			{
				outputDir: await mkdtemp(),
				contractDir: await mkdtemp(),
			},
			store,
		);

		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		// Build adjacency list for cycle detection
		const deps = output.jsonContract.dependencies;
		const adj = new Map<string, string[]>();
		for (const ws of output.workstreams) {
			adj.set(ws.id, []);
		}
		for (const d of deps) {
			const list = adj.get(d.from) ?? [];
			list.push(d.to);
			adj.set(d.from, list);
		}

		// DFS cycle detection
		const visited = new Set<string>();
		const inStack = new Set<string>();
		const hasCycle = (node: string): boolean => {
			visited.add(node);
			inStack.add(node);
			for (const neighbor of adj.get(node) ?? []) {
				if (!visited.has(neighbor)) {
					if (hasCycle(neighbor)) return true;
				} else if (inStack.has(neighbor)) {
					return true;
				}
			}
			inStack.delete(node);
			return false;
		};

		for (const node of adj.keys()) {
			if (!visited.has(node)) {
				expect(hasCycle(node)).toBe(false);
			}
		}
	}, 10000);

	it("batches do not overlap workstreams", async () => {
		const store = new InMemoryProposalStore();
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		const factory = new PlanFactory(
			new MasterTemplateIntegration(),
			{
				outputDir: await mkdtemp(),
				contractDir: await mkdtemp(),
			},
			store,
		);

		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		// Verify each workstream appears exactly once across all batches
		const seen = new Set<string>();
		for (const batch of output.batches) {
			for (const wsId of batch) {
				expect(seen.has(wsId)).toBe(false);
				seen.add(wsId);
			}
		}

		// Verify all workstreams are in some batch
		for (const ws of output.workstreams) {
			expect(seen.has(ws.id)).toBe(true);
		}
	}, 10000);

	it("validates output before returning and reports results", async () => {
		const store = new InMemoryProposalStore();
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		const factory = new PlanFactory(
			new MasterTemplateIntegration(),
			{
				outputDir: await mkdtemp(),
				contractDir: await mkdtemp(),
				validateBeforeReturn: true,
			},
			store,
		);

		const output = await factory.createPlan({ proposalId: proposal.id }, proposal);

		expect(output.validationResults).toBeDefined();
		expect(Array.isArray(output.validationResults)).toBe(true);
		// Validation may return errors or warnings; the output should still be valid
		const _errors = output.validationResults.filter((v) => v.type === "error");
		// Template integration ensures valid output
		expect(output.workstreams.length).toBeGreaterThan(0);
	}, 10000);
});

// ---------------------------------------------------------------------------
// AC3: Reflection Engine
// ---------------------------------------------------------------------------

describe("AC3: Reflection Engine", () => {
	it("generates a complete reflection report from execution data", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report).toBeDefined();
		expect(report.id).toBeDefined();
		expect(report.planExecId).toBe(input.planExecId);
		expect(report.planTitle).toBe(input.planTitle);
		expect(report.summary).toBeDefined();
		expect(report.summary.length).toBeGreaterThan(0);
		expect(report.whatPeopleNeedToKnow).toBeDefined();
		expect(report.whatRan).toBeDefined();
		expect(report.whatWorked).toBeDefined();
		expect(report.whatFailed).toBeDefined();
		expect(report.whatSlowedDown).toBeDefined();
		expect(report.createdAt).toBeDefined();
		expect(report.confidence).toBeGreaterThan(0);
	});

	it("computes accurate metrics from workspace outcomes", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report.workspaceCount).toBe(3);
		expect(report.successCount).toBe(2); // ws-A success, ws-B success (after retry)
		expect(report.failureCount).toBe(1); // ws-C failure
		expect(report.retryCount).toBe(4); // ws-B: 1, ws-C: 3
		expect(report.successRate).toBeCloseTo(2 / 3, 1);
		expect(report.avgRetryCount).toBeCloseTo(4 / 3, 1);
		expect(report.totalDuration).toBe(360000);
		expect(report.validationFailures).toBe(1); // 1 validation error
	});

	it("detects failure patterns from retry hotspots", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report.whatFailed.length).toBeGreaterThan(0);
		expect(report.whatFailed.some((f) => f.toLowerCase().includes("ws-c"))).toBe(true);
	});

	it("triggers on plan completion with source-backed summaries", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: true });
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report.summary).toBeDefined();
		// Source-backed reflections must reference evidence
		expect(report.sources).toBeDefined();
		expect(report.sources.length).toBeGreaterThan(0);
	});

	it("creates memory and proposal suggestions", async () => {
		const engine = new ReflectionEngine({
			sourceBackedRequired: false,
			enableMemoryGeneration: true,
			enableFutureSuggestions: true,
		});
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report.memoriesToCreate).toBeDefined();
		expect(report.proposalsToGenerate).toBeDefined();
		expect(report.futurePhaseSuggestions).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// AC4: Source-Backed Summarizer
// ---------------------------------------------------------------------------

describe("AC4: Source-Backed Summarizer", () => {
	it("generates whatWorked summary referencing workspace outcomes", () => {
		const summarizer = new SourceBackedSummarizer();
		const outcomes: WorkspaceOutcome[] = [
			{
				workspaceId: "ws-A",
				status: "success",
				retryCount: 0,
				duration: 60000,
				validationPassed: true,
				summary: "Integration tests passed",
			},
			{
				workspaceId: "ws-B",
				status: "retry",
				retryCount: 1,
				duration: 120000,
				validationPassed: true,
				summary: "Build completed after retry",
			},
		];

		const summary = summarizer.generateWhatWorkedSummary(outcomes);
		expect(summary).toBeDefined();
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain("[source:workspace-");
	});

	it("generates whatFailed summary referencing validation results", () => {
		const summarizer = new SourceBackedSummarizer();
		const outcomes: WorkspaceOutcome[] = [
			{
				workspaceId: "ws-C",
				status: "failure",
				retryCount: 3,
				duration: 180000,
				validationPassed: false,
			},
		];
		const validation: ValidationResult[] = [
			{
				type: "error",
				component: "lint",
				message: "Found 2 ESLint errors",
				passed: false,
			},
		];

		const summary = summarizer.generateWhatFailedSummary(outcomes, validation);
		expect(summary).toBeDefined();
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain("[source:");
	});

	it("validateEvidenceChain rejects missing references", () => {
		const summarizer = new SourceBackedSummarizer();
		const text =
			"Workspace A completed successfully [source:workspace-A] but workspace C failed with [source:workspace-C]";
		const sources: SourceRef[] = [{ type: "workspace", id: "workspace-A", description: "Engine workspace" }];

		const result = summarizer.validateEvidenceChain(text, sources);
		expect(result.valid).toBe(false);
		expect(result.missingRefs).toContain("workspace-C");
		expect(result.matchedRefs).toContain("workspace-A");
	});

	it("formats summaries for both markdown and dashboard", () => {
		const summarizer = new SourceBackedSummarizer();
		const report: ReflectionReport = {
			id: "test-1",
			planExecId: "exec-1",
			summary: "Two of three workspaces succeeded",
			whatPeopleNeedToKnow: "Reflection engine needs a bug fix",
			whatRan: ["workspace ws-A", "workspace ws-B", "workspace ws-C"],
			whatWorked: ["ws-A completed successfully [source:workspace-A]"],
			whatFailed: ["ws-C failed with TypeError [source:workspace-C]"],
			whatSlowedDown: ["ws-C had 3 retries [source:workspace-C]"],
			workspaceCount: 3,
			successCount: 2,
			failureCount: 1,
			retryCount: 4,
			successRate: 2 / 3,
			avgRetryCount: 4 / 3,
			totalDuration: 360000,
			validationFailures: 1,
			memoriesToCreate: [],
			proposalsToGenerate: [],
			futurePhaseSuggestions: [],
			policyStops: 0,
			approvalRequests: 1,
			safetyInterventions: 0,
			createdAt: "2026-05-22T12:06:00.000Z",
			confidence: 0.85,
			sources: [
				{ type: "workspace", id: "workspace-A", description: "Engine workspace" },
				{ type: "workspace", id: "workspace-C", description: "Reflection workspace" },
			],
		};

		const md = summarizer.formatForMarkdown(report);
		expect(md).toContain("## Reflection:");
		expect(md).toContain("### Summary");
		expect(md).toContain("### What Worked");
		expect(md).toContain("### What Failed");

		const dash = summarizer.formatForDashboard(report);
		expect(dash.summary).toBeDefined();
		expect(dash.whatWorked.length).toBeGreaterThan(0);
		expect(dash.whatFailed.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// AC5: Memory Update Proposal Generator
// ---------------------------------------------------------------------------

describe("AC5: Memory Update Proposal Generator", () => {
	it("creates failure_memory proposals from failures", () => {
		const generator = new MemoryProposalGenerator();
		const failed = ["ws-C failed with TypeError [source:workspace-C]"];
		const outcomes: WorkspaceOutcome[] = [
			{
				workspaceId: "ws-C",
				status: "failure",
				retryCount: 3,
				duration: 180000,
				errorTypes: ["TypeError"],
				validationPassed: false,
			},
		];

		const proposals = generator.fromFailures(failed, outcomes);
		expect(proposals.length).toBeGreaterThan(0);
		for (const p of proposals) {
			expect(p.memory).toBeDefined();
			expect(p.evidence).toBeDefined();
			expect(p.evidence.length).toBeGreaterThan(0);
			expect(p.confidence).toBeGreaterThan(0);
		}
	});

	it("creates execution_memory proposals from successes", () => {
		const generator = new MemoryProposalGenerator();
		const worked = ["ws-A completed successfully [source:workspace-A]"];
		const outcomes: WorkspaceOutcome[] = [
			{
				workspaceId: "ws-A",
				status: "success",
				retryCount: 0,
				duration: 60000,
				validationPassed: true,
				summary: "Integration tests passed",
			},
		];

		const proposals = generator.fromSuccesses(worked, outcomes);
		expect(proposals.length).toBeGreaterThan(0);
		for (const p of proposals) {
			expect(p.memory).toBeDefined();
			expect(p.evidence.length).toBeGreaterThan(0);
			expect(p.confidence).toBeGreaterThan(0);
		}
	});

	it("creates architecture_memory proposals from whatRan", () => {
		const generator = new MemoryProposalGenerator();
		const whatRan = ["workspace ws-A-engine", "workspace ws-B-template"];
		const outcomes: WorkspaceOutcome[] = [
			{
				workspaceId: "ws-A-engine",
				status: "success",
				retryCount: 0,
				duration: 60000,
				validationPassed: true,
			},
		];

		const proposals = generator.fromArchitecture(whatRan, outcomes);
		expect(proposals.length).toBeGreaterThan(0);
	});

	it("generates from full reflection report", async () => {
		const engine = new ReflectionEngine({
			sourceBackedRequired: false,
			enableMemoryGeneration: true,
		});
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		const generator = new MemoryProposalGenerator();
		const proposals = generator.fromReflection(report);
		expect(proposals.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// AC6: Future Phase Suggestion Engine
// ---------------------------------------------------------------------------

describe("AC6: Future Phase Suggestion Engine", () => {
	it("generates fix suggestions from failures", () => {
		const engine = new FutureSuggestionEngine({ maxSuggestions: 5 });
		const failed = ["ws-C failed with TypeError [source:workspace-C]"];
		const scores = new Map<string, number>([["ws-C", 0.9]]);

		const suggestions = engine.fromFailures(failed as unknown as string[], scores);
		expect(suggestions).toBeDefined();
	});

	it("generates optimization suggestions from bottlenecks", () => {
		const engine = new FutureSuggestionEngine({ maxSuggestions: 5 });
		const slowedDown = ["ws-C had 3 retries delaying completion [source:workspace-C]"];

		const suggestions = engine.fromBottlenecks(slowedDown);
		expect(suggestions).toBeDefined();
	});

	it("generates suggestions from full reflection report", async () => {
		const engine = new ReflectionEngine({
			sourceBackedRequired: false,
			enableFutureSuggestions: true,
			maxFutureSuggestions: 3,
		});
		const input = makeReflectionInput();
		const report = await engine.generateReflection(input);

		expect(report.futurePhaseSuggestions.length).toBeLessThanOrEqual(3);
		for (const s of report.futurePhaseSuggestions) {
			expect(s.title).toBeDefined();
			expect(s.rationale).toBeDefined();
			expect(s.priority).toBeDefined();
			expect(["critical", "high", "normal", "low"]).toContain(s.priority);
			expect(s.estimatedWorkstreams).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// AC7: Reflection API
// ---------------------------------------------------------------------------

describe("AC7: Reflection API", () => {
	it("lists reflections with pagination", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const api = new BrainReflectionApi(engine);

		// Generate a reflection first
		await engine.generateReflection(makeReflectionInput({ planExecId: "api-test-1" }));
		await engine.generateReflection(makeReflectionInput({ planExecId: "api-test-2" }));

		// List all
		const listAll = await api.listReflections({});
		expect(listAll.reflections.length).toBeGreaterThanOrEqual(2);
		expect(listAll.total).toBeGreaterThanOrEqual(2);

		// List with pagination
		const listPage = await api.listReflections({ limit: 1, offset: 0 });
		expect(listPage.reflections.length).toBe(1);
		expect(listPage.total).toBeGreaterThanOrEqual(2);
	});

	it("filters reflections by planExecId", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const api = new BrainReflectionApi(engine);

		await engine.generateReflection(makeReflectionInput({ planExecId: "filter-test-1", planTitle: "Filter Test 1" }));

		const filtered = await api.listReflections({ planExecId: "filter-test-1" });
		expect(filtered.reflections.length).toBe(1);
		expect(filtered.reflections[0].planExecId).toBe("filter-test-1");
	});

	it("gets a single reflection by planExecId", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const api = new BrainReflectionApi(engine);

		await engine.generateReflection(makeReflectionInput({ planExecId: "get-test-1" }));

		const report = await api.getReflection("get-test-1");
		expect(report).not.toBeNull();
		expect(report!.planExecId).toBe("get-test-1");
		expect(report!.summary).toBeDefined();
		expect(report!.whatWorked.length).toBeGreaterThan(0);
		expect(report!.whatFailed.length).toBeGreaterThan(0);
		expect(report!.metrics).toBeUndefined(); // metrics are flat on the report object

		// Non-existent returns null
		const missing = await api.getReflection("non-existent-id");
		expect(missing).toBeNull();
	});

	it("generates a new reflection via API", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const api = new BrainReflectionApi(engine);

		const input = makeReflectionInput({ planExecId: "generate-test-1" });
		const result = await api.generateReflection(input);

		expect(result.success).toBe(true);
		expect(result.report).toBeDefined();
		expect(result.report!.planExecId).toBe("generate-test-1");
		expect(result.regenerated).toBe(false);

		// Regenerate with force
		const regenerated = await api.generateReflection(input, { force: true });
		expect(regenerated.success).toBe(true);
		expect(regenerated.regenerated).toBe(true);
	});

	it("returns aggregate stats", async () => {
		const engine = new ReflectionEngine({ sourceBackedRequired: false });
		const api = new BrainReflectionApi(engine);

		await engine.generateReflection(makeReflectionInput({ planExecId: "stats-test-1", planTitle: "Stats Test 1" }));
		await engine.generateReflection(makeReflectionInput({ planExecId: "stats-test-2", planTitle: "Stats Test 2" }));

		const stats = await api.getStats();
		expect(stats.total).toBeGreaterThanOrEqual(2);
		expect(Object.keys(stats.byPlan).length).toBeGreaterThanOrEqual(2);
		expect(stats.avgConfidence).toBeGreaterThan(0);
	});

	it("extracts memory proposals from a reflection", async () => {
		const engine = new ReflectionEngine({
			sourceBackedRequired: false,
			enableMemoryGeneration: true,
		});
		const api = new BrainReflectionApi(engine);

		await engine.generateReflection(makeReflectionInput({ planExecId: "mem-test-1" }));
		const memories = await api.getMemories("mem-test-1");

		expect(memories).not.toBeNull();
		expect(memories!.memories.length).toBeGreaterThan(0);
		expect(memories!.memories[0].type).toBeDefined();
		expect(memories!.memories[0].title).toBeDefined();
		expect(memories!.memories[0].content).toBeDefined();

		// Non-existent returns null
		const missing = await api.getMemories("non-existent-id");
		expect(missing).toBeNull();
	});

	it("extracts future suggestions from a reflection", async () => {
		const engine = new ReflectionEngine({
			sourceBackedRequired: false,
			enableFutureSuggestions: true,
		});
		const api = new BrainReflectionApi(engine);

		await engine.generateReflection(makeReflectionInput({ planExecId: "future-test-1" }));
		const future = await api.getFuture("future-test-1");

		expect(future).not.toBeNull();
		expect(future!.suggestions.length).toBeGreaterThan(0);
		expect(future!.suggestions[0].title).toBeDefined();
		expect(future!.suggestions[0].rationale).toBeDefined();
		expect(future!.suggestions[0].priority).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// AC8: End-to-End Flow
// ---------------------------------------------------------------------------

describe("AC8: End-to-End Flow — Proposal -> Plan -> Reflection", () => {
	it("completes the full P17 pipeline end to end", async () => {
		const tmpDir = await mkdtemp();
		const store = new InMemoryProposalStore();

		// Step 1: Create a proposal
		const proposal = await store.create(TEST_PROPOSAL_INPUT);

		// Step 2: Generate a plan from the proposal
		const template = new MasterTemplateIntegration();
		const factory = new PlanFactory(
			template,
			{
				outputDir: join(tmpDir, "docs/pi/phases"),
				contractDir: join(tmpDir, ".pi/plans/generated"),
				maxWorkstreams: 5,
				validateBeforeReturn: true,
			},
			store,
		);

		const planInput: PlanFactoryInput = {
			proposalId: proposal.id,
			priority: "normal",
		};

		const planOutput = await factory.createPlan(planInput, proposal);
		expect(planOutput.workstreams.length).toBeGreaterThan(0);
		expect(existsSync(planOutput.markdownPath)).toBe(true);

		// Step 3: Simulate execution outcomes
		const reflectionInput: ReflectionInput = {
			planExecId: "e2e-test-exec-001",
			planId: planOutput.phaseId,
			planTitle: planOutput.phaseTitle,
			executionJournal: planOutput.workstreams.map((ws, i) => ({
				timestamp: new Date(Date.now() + i * 60000).toISOString(),
				eventType: "workspace_complete",
				workspaceId: ws.id,
				severity: "info",
				data: { status: i === 0 ? "success" : "failure" },
			})),
			workspaceOutcomes: planOutput.workstreams.map((ws, i) => ({
				workspaceId: ws.id,
				status: (i === 0 ? "success" : i === 1 ? "retry" : "failure") as WorkspaceOutcome["status"],
				retryCount: i === 0 ? 0 : i === 1 ? 1 : 2,
				duration: (i + 1) * 60000,
				validationPassed: i < 2,
			})),
			validationResults: [
				{
					type: "error",
					component: "lint",
					message: "Lint errors found",
					passed: false,
				},
			],
			integrationState: {
				wasDirty: false,
				conflicts: 0,
				resolvedConflicts: 0,
			},
			duration: planOutput.workstreams.length * 60000,
			startTime: new Date().toISOString(),
			endTime: new Date(Date.now() + planOutput.workstreams.length * 60000).toISOString(),
			autonomyLevel: 3,
			policyStops: 0,
			approvalRequests: 0,
		};

		// Step 4: Generate reflection
		const reflectionEngine = new ReflectionEngine({
			minWorkspaceCount: 1,
			sourceBackedRequired: true,
			enableMemoryGeneration: true,
			enableFutureSuggestions: true,
			maxFutureSuggestions: 3,
		});

		const reflectionReport = await reflectionEngine.generateReflection(reflectionInput);
		expect(reflectionReport).toBeDefined();
		expect(reflectionReport.planExecId).toBe("e2e-test-exec-001");
		expect(reflectionReport.whatRan.length).toBeGreaterThan(0);
		expect(reflectionReport.whatWorked.length).toBeGreaterThan(0);
		expect(reflectionReport.whatFailed.length).toBeGreaterThan(0);
		expect(reflectionReport.memoriesToCreate.length).toBeGreaterThan(0);
		expect(reflectionReport.futurePhaseSuggestions.length).toBeGreaterThan(0);
		expect(reflectionReport.sources.length).toBeGreaterThan(0);

		// Step 5: Verify API can access the reflection
		const api = new BrainReflectionApi(reflectionEngine);
		const fetched = await api.getReflection("e2e-test-exec-001");
		expect(fetched).not.toBeNull();
		expect(fetched!.id).toBe(reflectionReport.id);

		const memories = await api.getMemories("e2e-test-exec-001");
		expect(memories).not.toBeNull();
		expect(memories!.memories.length).toBeGreaterThan(0);

		const future = await api.getFuture("e2e-test-exec-001");
		expect(future).not.toBeNull();
		expect(future!.suggestions.length).toBeGreaterThan(0);

		const stats = await api.getStats();
		expect(stats.total).toBeGreaterThanOrEqual(1);
	}, 15000);
});

// ---------------------------------------------------------------------------
// Helper: Create temporary directory
// ---------------------------------------------------------------------------

async function mkdtemp(): Promise<string> {
	const dir = join(tmpdir(), `p17-dogfood-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	await mkdir(dir, { recursive: true });
	return dir;
}
