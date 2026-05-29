/**
 * Memory Proposal Generator — P17.E — Tests
 *
 * Tests the MemoryProposalGenerator class which creates memory update
 * proposals from reflection results.
 */

import { describe, expect, it } from "vitest";
import { MemoryProposalGenerator } from "../../../src/brain/reflection/memory-proposals.js";
import type { ReflectionReport, WorkspaceOutcome } from "../../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createWorkspaceOutcome(overrides: Partial<WorkspaceOutcome> & { workspaceId: string }): WorkspaceOutcome {
	return {
		status: "success",
		retryCount: 0,
		duration: 1000,
		...overrides,
	};
}

function createDefaultReport(overrides?: Partial<ReflectionReport>): ReflectionReport {
	return {
		id: "test-report-1",
		planExecId: "plan-exec-1",
		planTitle: "Test Plan",
		summary: "A test reflection report",
		whatPeopleNeedToKnow: "Nothing special",
		whatRan: ["ws-A", "ws-B", "ws-C"],
		whatWorked: ["ws-A", "ws-B"],
		whatFailed: ["ws-C"],
		whatSlowedDown: [],
		workspaceCount: 3,
		successCount: 2,
		failureCount: 1,
		retryCount: 0,
		successRate: 0.67,
		avgRetryCount: 0,
		totalDuration: 5000,
		validationFailures: 0,
		memoriesToCreate: [],
		proposalsToGenerate: [],
		futurePhaseSuggestions: [],
		policyStops: 0,
		approvalRequests: 0,
		safetyInterventions: 0,
		createdAt: "2026-05-22T00:00:00.000Z",
		confidence: 0.8,
		sources: [
			{
				type: "workspace",
				id: "workspace-ws-A",
				description: "Workspace A completed successfully",
			},
			{
				type: "workspace",
				id: "workspace-ws-B",
				description: "Workspace B completed successfully",
			},
			{
				type: "workspace",
				id: "workspace-ws-C",
				description: "Workspace C failed",
			},
		],
		claims: [],
		...overrides,
	};
}

function createDefaultOutcomes(): WorkspaceOutcome[] {
	return [
		createWorkspaceOutcome({
			workspaceId: "ws-A",
			status: "success",
			retryCount: 0,
			duration: 1000,
			summary: "Successfully completed task A",
		}),
		createWorkspaceOutcome({
			workspaceId: "ws-B",
			status: "success",
			retryCount: 1,
			duration: 2000,
			summary: "Completed task B after retry",
		}),
		createWorkspaceOutcome({
			workspaceId: "ws-C",
			status: "failure",
			retryCount: 2,
			duration: 3000,
			errorTypes: ["type_error", "runtime_exception"],
			summary: "Failed to complete task C",
		}),
	];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MemoryProposalGenerator", () => {
	const generator = new MemoryProposalGenerator();

	// -----------------------------------------------------------------------
	// AC1: Failures generate failure_memory proposals
	// -----------------------------------------------------------------------

	describe("fromFailures", () => {
		it("should generate failure_memory proposals from failed workspaces", () => {
			const failed = ["ws-C"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromFailures(failed, outcomes);

			expect(proposals.length).toBeGreaterThan(0);
			for (const prop of proposals) {
				expect(prop.memory.type).toBe("failure_memory");
				expect(prop.memory.lifecycle).toBe("candidate");
				expect(prop.evidence.length).toBeGreaterThanOrEqual(1);
				expect(prop.confidence).toBeGreaterThan(0);
				expect(prop.confidence).toBeLessThanOrEqual(1);
			}
		});

		it("should handle multiple failed workspaces", () => {
			const failed = ["ws-C", "ws-D"];
			const outcomes = [
				...createDefaultOutcomes(),
				createWorkspaceOutcome({
					workspaceId: "ws-D",
					status: "failure",
					retryCount: 1,
					duration: 1500,
					errorTypes: ["connection_error"],
				}),
			];
			const proposals = generator.fromFailures(failed, outcomes);

			expect(proposals.length).toBeGreaterThanOrEqual(1);
			for (const prop of proposals) {
				expect(prop.memory.type).toBe("failure_memory");
			}
		});

		it("should return empty array when no failures exist", () => {
			const proposals = generator.fromFailures([], []);
			expect(proposals).toEqual([]);
		});

		it("should include evidence sources in each proposal", () => {
			const failed = ["ws-C"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromFailures(failed, outcomes);

			for (const prop of proposals) {
				expect(prop.evidence.length).toBeGreaterThan(0);
				expect(prop.evidence[0].type).toBe("workspace");
				expect(prop.evidence[0].id).toBeTruthy();
				expect(prop.evidence[0].description).toBeTruthy();
			}
		});
	});

	// -----------------------------------------------------------------------
	// AC2: Successes generate execution_memory proposals
	// -----------------------------------------------------------------------

	describe("fromSuccesses", () => {
		it("should generate execution_memory proposals from successful workspaces", () => {
			const worked = ["ws-A", "ws-B"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromSuccesses(worked, outcomes);

			expect(proposals.length).toBeGreaterThan(0);
			for (const prop of proposals) {
				expect(prop.memory.type).toBe("execution_memory");
				expect(prop.memory.lifecycle).toBe("candidate");
				expect(prop.evidence.length).toBeGreaterThanOrEqual(1);
				expect(prop.confidence).toBeGreaterThan(0);
			}
		});

		it("should return empty array when no successes exist", () => {
			const proposals = generator.fromSuccesses([], []);
			expect(proposals).toEqual([]);
		});

		it("should reference reflection evidence", () => {
			const worked = ["ws-A"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromSuccesses(worked, outcomes);

			for (const prop of proposals) {
				const sourceRefs = prop.memory.provenance?.sourceRefs ?? [];
				expect(sourceRefs.length).toBeGreaterThan(0);
				expect(sourceRefs[0].type).toBe("reflection");
			}
		});
	});

	// -----------------------------------------------------------------------
	// AC3: Architecture changes generate architecture_memory proposals
	// -----------------------------------------------------------------------

	describe("fromArchitecture", () => {
		it("should generate architecture_memory proposals from what ran", () => {
			const whatRan = ["ws-A", "ws-B", "ws-C"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromArchitecture(whatRan, outcomes);

			expect(proposals.length).toBeGreaterThan(0);
			for (const prop of proposals) {
				expect(prop.memory.type).toBe("architecture_memory");
				expect(prop.memory.lifecycle).toBe("candidate");
				expect(prop.evidence.length).toBeGreaterThanOrEqual(1);
			}
		});

		it("should return empty array when nothing ran", () => {
			const proposals = generator.fromArchitecture([], []);
			expect(proposals).toEqual([]);
		});

		it("should include topology information in content", () => {
			const whatRan = ["ws-A", "ws-B"];
			const outcomes = createDefaultOutcomes();
			const proposals = generator.fromArchitecture(whatRan, outcomes);

			expect(proposals.length).toBe(1);
			expect(proposals[0].memory.content).toContain("ws-A");
			expect(proposals[0].memory.content).toContain("ws-B");
			expect(proposals[0].memory.content).toContain("2 workspace(s)");
		});
	});

	// -----------------------------------------------------------------------
	// AC4: Each proposal references reflection evidence
	// -----------------------------------------------------------------------

	describe("evidence references", () => {
		it("should include evidence from fromReflection entry point", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				expect(prop.evidence.length).toBeGreaterThan(0);
				for (const ev of prop.evidence) {
					expect(ev.type).toBeTruthy();
					expect(ev.id).toBeTruthy();
					expect(ev.description).toBeTruthy();
				}
			}
		});

		it("should carry evidence through to MemorySourceRef in provenance", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				const sourceRefs = prop.memory.provenance?.sourceRefs ?? [];
				expect(sourceRefs.length).toBeGreaterThan(0);
				for (const sr of sourceRefs) {
					expect(sr.type).toBe("reflection");
					expect(sr.id).toBeTruthy();
					expect(sr.path).toMatch(/^reflection:/);
				}
			}
		});
	});

	// -----------------------------------------------------------------------
	// AC5: Proposals formatted for P14 MemoryRecord
	// -----------------------------------------------------------------------

	describe("MemoryRecord format", () => {
		it("should produce proposals compatible with MemoryRecord structure", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				// Required MemoryRecord fields
				expect(prop.memory.type).toBeTruthy();
				expect(prop.memory.title).toBeTruthy();
				expect(prop.memory.content).toBeTruthy();
				expect(prop.memory.lifecycle).toBe("candidate");
				expect(prop.memory.provenance).toBeTruthy();
				expect(typeof prop.memory.confidence).toBe("number");
				expect(Array.isArray(prop.memory.tags)).toBe(true);

				// Provenance must have source refs
				expect(prop.memory.provenance!.sourceRefs.length).toBeGreaterThan(0);
				expect(prop.memory.provenance!.validatedBy).toBe("system");
			}
		});

		it("should produce proposals that can be passed to createMemoryRecord", () => {
			// We just verify the shape matches what createMemoryRecord expects
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				// These fields are required by createMemoryRecord
				expect(prop.memory.type).toBeTruthy();
				expect(prop.memory.title).toBeTruthy();
				expect(typeof prop.memory.title).toBe("string");
				expect(prop.memory.content).toBeTruthy();
				expect(typeof prop.memory.content).toBe("string");
				expect(prop.memory.provenance).toBeTruthy();
				expect(prop.memory.provenance!.sourceRefs).toBeInstanceOf(Array);

				// Optional fields with defaults
				expect(prop.memory.lifecycle).toBe("candidate");
				expect(prop.memory.tags).toBeInstanceOf(Array);
			}
		});

		it("should produce proposals with proper metadata", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				expect(prop.memory.metadata).toBeTruthy();
				expect(prop.memory.metadata!.generatedBy).toBe("MemoryProposalGenerator");
				expect(typeof prop.memory.metadata!.sourceCount).toBe("number");
			}
		});
	});

	// -----------------------------------------------------------------------
	// AC6: Confidence reflects evidence quality
	// -----------------------------------------------------------------------

	describe("confidence calculation", () => {
		it("should compute higher confidence with more evidence sources", () => {
			const confidence1 = generator.computeConfidence(1, 0, 1);
			const confidence2 = generator.computeConfidence(5, 0, 1);

			expect(confidence2).toBeGreaterThan(confidence1);
		});

		it("should reduce confidence with more retries", () => {
			const confidenceNoRetries = generator.computeConfidence(1, 0, 1);
			const confidenceWithRetries = generator.computeConfidence(1, 3, 1);

			expect(confidenceWithRetries).toBeLessThan(confidenceNoRetries);
		});

		it("should boost confidence with multiple corroborating outcomes", () => {
			const confidence1 = generator.computeConfidence(1, 0, 1);
			const confidence2 = generator.computeConfidence(1, 0, 3);

			expect(confidence2).toBeGreaterThan(confidence1);
		});

		it("should keep confidence within 0-1 bounds", () => {
			const veryLow = generator.computeConfidence(0, 100, 0);
			expect(veryLow).toBeGreaterThanOrEqual(0.1);

			const veryHigh = generator.computeConfidence(100, 0, 100);
			expect(veryHigh).toBeLessThanOrEqual(0.95);
		});

		it("should return consistent results for same inputs", () => {
			const c1 = generator.computeConfidence(3, 1, 2);
			const c2 = generator.computeConfidence(3, 1, 2);

			expect(c1).toBe(c2);
		});
	});

	// -----------------------------------------------------------------------
	// fromReflection integration
	// -----------------------------------------------------------------------

	describe("fromReflection", () => {
		it("should produce all three proposal types from a full report", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			const types = new Set(proposals.map((p) => p.memory.type));
			expect(types.has("failure_memory")).toBe(true);
			expect(types.has("execution_memory")).toBe(true);
			expect(types.has("architecture_memory")).toBe(true);
		});

		it("should skip empty categories", () => {
			const report = createDefaultReport({
				whatFailed: [],
				whatWorked: [],
			});
			const proposals = generator.fromReflection(report);

			// Should still produce architecture proposals from whatRan
			expect(proposals.length).toBeGreaterThan(0);
			for (const prop of proposals) {
				expect(prop.memory.type).toBe("architecture_memory");
			}
		});

		it("should return empty array for empty report", () => {
			const report = createDefaultReport({
				whatRan: [],
				whatWorked: [],
				whatFailed: [],
			});
			const proposals = generator.fromReflection(report);

			expect(proposals).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// formatAsProposal
	// -----------------------------------------------------------------------

	describe("formatAsProposal", () => {
		it("should produce a valid partial Proposal", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				const proposal = generator.formatAsProposal(prop);

				expect(proposal.type).toBe("memory_proposal");
				expect(proposal.title).toBeTruthy();
				expect(proposal.description).toBeTruthy();
				expect(proposal.status).toBe("draft");
				expect(proposal.submittedBy).toBe("pi");
				expect(proposal.evidence).toBeTruthy();
				expect(proposal.evidence!.confidence).toBe(prop.confidence);
			}
		});

		it("should carry source refs into the proposal evidence", () => {
			const report = createDefaultReport();
			const proposals = generator.fromReflection(report);

			for (const prop of proposals) {
				const proposal = generator.formatAsProposal(prop);
				expect(proposal.evidence!.sourceRefs.length).toBeGreaterThan(0);
			}
		});
	});
});
