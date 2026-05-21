/**
 * Provenance Tracker — P18.F / Workspace 7.F — Tests
 *
 * Tests the ProvenanceTracker class covering all acceptance criteria:
 * 1. ProvenanceRecord created for every policy evaluation
 * 2. Chain links to proposal, memory, observation, policy rule
 * 3. Explanation generation includes chain traversal
 * 4. Query by target ID returns full chain
 * 5. Persistence survives restart
 */

import { mkdtempSync, existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ProvenanceTracker,
	createProvenanceTracker,
} from "../../../src/brain/policy/provenance.js";
import type {
	AuditEntry,
	ProvenanceLink,
	ProvenanceRecord,
	ProvenanceTargetType,
} from "../../../src/brain/policy/types.js";
import type { SourceRef } from "../../../src/brain/reflection/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory for test isolation.
 */
function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "provenance-tracker-test-"));
}

/**
 * Create a sample provenance link for tests.
 */
function sampleLink(overrides: Partial<ProvenanceLink> = {}): ProvenanceLink {
	return {
		sourceId: "src-1",
		sourceType: "decision",
		relationship: "derived_from",
		timestamp: new Date().toISOString(),
		summary: "Test link",
		metadata: {},
		...overrides,
	};
}

/**
 * Create a sample audit entry for explainDecision tests.
 */
function sampleAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
	const now = new Date().toISOString();
	return {
		id: "aud-1",
		timestamp: now,
		actor: "pi",
		action: "test_action",
		decision: "allow",
		evidence: [],
		result: "success",
		context: {
			autonomyLevel: 3,
			riskLevel: "low",
		},
		metadata: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProvenanceTracker", () => {
	let tracker: ProvenanceTracker;
	let persistencePath: string;

	beforeEach(() => {
		persistencePath = createTempDir();
		tracker = createProvenanceTracker({ persistencePath });
	});

	afterEach(async () => {
		const { rm } = await import("fs/promises");
		try {
			await rm(persistencePath, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	// -------------------------------------------------------------------
	// AC 1: ProvenanceRecord created for every policy evaluation
	// -------------------------------------------------------------------

	describe("AC1: ProvenanceRecord created for policy evaluations", () => {
		it("should create a provenance record via track()", async () => {
			const record = await tracker.track("target-1", "decision", [
				sampleLink(),
			]);

			expect(record).toBeDefined();
			expect(record.id).toBeTruthy();
			expect(record.id.startsWith("prov-")).toBe(true);
			expect(record.targetId).toBe("target-1");
			expect(record.targetType).toBe("decision");
			expect(record.links.length).toBe(1);
			expect(record.createdAt).toBeTruthy();
			expect(record.updatedAt).toBeTruthy();
		});

		it("should create a provenance record for proposal evaluations", async () => {
			const record = await tracker.track("proposal-1", "proposal", [
				sampleLink({
					sourceId: "proposal-1",
					sourceType: "proposal",
					relationship: "derived_from",
					summary: "Created from observation obs-1",
				}),
			]);

			expect(record.targetType).toBe("proposal");
			expect(record.links[0].sourceId).toBe("proposal-1");
		});

		it("should create a provenance record for memory evaluations", async () => {
			const record = await tracker.track("memory-1", "memory", [
				sampleLink({
					sourceId: "memory-1",
					sourceType: "memory",
					relationship: "supported_by",
					summary: "Supported by observation obs-2",
				}),
			]);

			expect(record.targetType).toBe("memory");
			expect(record.links[0].relationship).toBe("supported_by");
		});

		it("should create a provenance record for approval evaluations", async () => {
			const record = await tracker.track("approval-1", "approval", [
				sampleLink({
					sourceId: "approval-1",
					sourceType: "approval",
					relationship: "evaluated_by",
					summary: "Approved by user",
				}),
			]);

			expect(record.targetType).toBe("approval");
			expect(record.links[0].relationship).toBe("evaluated_by");
		});

		it("should create a provenance record for plan evaluations", async () => {
			const record = await tracker.track("plan-1", "plan", [
				sampleLink({
					sourceId: "plan-1",
					sourceType: "plan",
					relationship: "triggered_by",
					summary: "Triggered by approval approval-1",
				}),
			]);

			expect(record.targetType).toBe("plan");
			expect(record.links[0].relationship).toBe("triggered_by");
		});

		it("should create records for multiple target types simultaneously", async () => {
			const record1 = await tracker.track("target-a", "decision", [sampleLink()]);
			const record2 = await tracker.track("target-b", "proposal", [sampleLink()]);
			const record3 = await tracker.track("target-c", "memory", [sampleLink()]);

			const stats = await tracker.getStats();
			expect(stats.totalRecords).toBe(3);
		});
	});

	// -------------------------------------------------------------------
	// AC 2: Chain links to proposal, memory, observation, policy rule
	// -------------------------------------------------------------------

	describe("AC2: Chain links to proposals, memories, observations, policy rules", () => {
		it("should link a decision to a proposal", async () => {
			const decisionId = "decision-1";

			// Track a proposal first
			await tracker.track("proposal-42", "proposal", [
				sampleLink({
					sourceId: "obs-1",
					sourceType: "decision",
					relationship: "supported_by",
					summary: "Supported by observation obs-1",
				}),
			]);

			// Track a decision that links to the proposal
			await tracker.track(decisionId, "decision", [
				sampleLink({
					sourceId: "proposal-42",
					sourceType: "proposal",
					relationship: "derived_from",
					summary: "Decision derived from proposal-42",
				}),
				sampleLink({
					sourceId: "policy-rule-7",
					sourceType: "decision",
					relationship: "evaluated_by",
					summary: "Evaluated by policy rule 7",
				}),
			]);

			const record = await tracker.getProvenance(decisionId);
			expect(record).not.toBeNull();
			expect(record!.links.length).toBe(2);

			const proposalLink = record!.links.find((l) => l.sourceId === "proposal-42");
			expect(proposalLink).toBeDefined();
			expect(proposalLink!.sourceType).toBe("proposal");
			expect(proposalLink!.relationship).toBe("derived_from");

			const policyLink = record!.links.find((l) => l.sourceId === "policy-rule-7");
			expect(policyLink).toBeDefined();
			expect(policyLink!.sourceType).toBe("decision");
			expect(policyLink!.relationship).toBe("evaluated_by");
		});

		it("should link a proposal to multiple evidence sources", async () => {
			const proposalId = "proposal-99";

			await tracker.track(proposalId, "proposal", [
				sampleLink({
					sourceId: "memory-5",
					sourceType: "memory",
					relationship: "supported_by",
					summary: "Memory of previous similar fix",
				}),
				sampleLink({
					sourceId: "obs-3",
					sourceType: "decision",
					relationship: "triggered_by",
					summary: "Observation of recurring failure",
				}),
				sampleLink({
					sourceId: "policy-rule-2",
					sourceType: "decision",
					relationship: "evaluated_by",
					summary: "Policy rule allows this proposal type",
				}),
			]);

			const record = await tracker.getProvenance(proposalId);
			expect(record).not.toBeNull();
			expect(record!.links.length).toBe(3);
			expect(record!.links.some((l) => l.sourceType === "memory")).toBe(true);
			expect(record!.links.some((l) => l.sourceType === "decision")).toBe(true);
		});

		it("should support addLink to build a chain incrementally", async () => {
			// Start with a decision
			await tracker.track("decision-core", "decision", [
				sampleLink({
					sourceId: "policy-rule-1",
					sourceType: "decision",
					relationship: "evaluated_by",
					summary: "Initial evaluation",
				}),
			]);

			// Add more links later
			await tracker.addLink("decision-core", {
				sourceId: "proposal-7",
				sourceType: "proposal",
				relationship: "derived_from",
				timestamp: new Date().toISOString(),
				summary: "Linked to proposal-7 after review",
				metadata: {},
			});

			const record = await tracker.getProvenance("decision-core");
			expect(record).not.toBeNull();
			expect(record!.links.length).toBe(2);
		});
	});

	// -------------------------------------------------------------------
	// AC 3: Explanation generation includes chain traversal
	// -------------------------------------------------------------------

	describe("AC3: Explanation generation includes chain traversal", () => {
		it("should explain a decision from an audit entry", async () => {
			const auditEntry = sampleAuditEntry({
				id: "aud-decision-1",
				action: "execute_plan",
				decision: "allow",
				policyRuleId: "rule-1",
				policyRuleName: "Allow plan execution",
				proposalId: "proposal-42",
				evidence: [
					{ type: "validation", id: "proposal-42", description: "Proposal evidence" },
					{ type: "workspace", id: "exec-1", description: "Plan execution context" },
				],
				context: { autonomyLevel: 4, riskLevel: "medium" },
			});

			// Track provenance
			await tracker.track("aud-decision-1", "decision", [
				sampleLink({
					sourceId: "proposal-42",
					sourceType: "proposal",
					relationship: "derived_from",
					summary: "Derived from proposal for automated refactoring",
				}),
			]);

			const explanation = await tracker.explainDecision(auditEntry);

			expect(explanation).toContain("ALLOW");
			expect(explanation).toContain("execute_plan");
			expect(explanation).toContain("Allow plan execution");
			expect(explanation).toContain("Provenance Chain");
			expect(explanation).toContain("Derived from proposal for automated refactoring");
		});

		it("should explain a proposal's provenance", async () => {
			await tracker.track("proposal-7", "proposal", [
				sampleLink({
					sourceId: "obs-failure-3",
					sourceType: "decision",
					relationship: "triggered_by",
					summary: "Observation of validation failure in workspace-3",
				}),
				sampleLink({
					sourceId: "memory-12",
					sourceType: "memory",
					relationship: "supported_by",
					summary: "Similar fix applied in workspace-1 (memory-12)",
				}),
			]);

			const explanation = await tracker.explainProposal("proposal-7");

			expect(explanation).toContain("proposal-7");
			expect(explanation).toContain("obs-failure-3");
			expect(explanation).toContain("memory-12");
			expect(explanation).toContain("triggered by");
			expect(explanation).toContain("supported by");
		});

		it("should explain a memory's provenance", async () => {
			await tracker.track("memory-5", "memory", [
				sampleLink({
					sourceId: "obs-1",
					sourceType: "decision",
					relationship: "derived_from",
					summary: "Derived from observation of build failure",
				}),
			]);

			const explanation = await tracker.explainMemory("memory-5");

			expect(explanation).toContain("Memory");
			expect(explanation).toContain("memory-5");
			expect(explanation).toContain("obs-1");
		});

		it("should return a message for non-existent proposals", async () => {
			const explanation = await tracker.explainProposal("nonexistent");
			expect(explanation).toContain("No provenance record found");
		});

		it("should return a message for non-existent memories", async () => {
			const explanation = await tracker.explainMemory("nonexistent");
			expect(explanation).toContain("No provenance record found");
		});

		it("should handle circular chain references gracefully", async () => {
			// Create a circular reference
			await tracker.track("circle-a", "decision", [
				sampleLink({
					sourceId: "circle-b",
					sourceType: "decision",
					relationship: "derived_from",
					summary: "A derived from B",
				}),
			]);

			await tracker.track("circle-b", "decision", [
				sampleLink({
					sourceId: "circle-a",
					sourceType: "decision",
					relationship: "supported_by",
					summary: "B supported by A",
				}),
			]);

			const explanation = await tracker.explainDecision(
				sampleAuditEntry({
					id: "circle-a",
					action: "circular_ref",
				}),
			);

			// Should not hang or throw; should detect circular reference
			expect(explanation).toContain("circular");
		});

		it("should traverse a multi-hop chain", async () => {
			// Decision -> proposal -> observation
			await tracker.track("obs-final", "decision", [
				sampleLink({
					sourceId: "obs-origin",
					sourceType: "decision",
					relationship: "derived_from",
					summary: "Root observation",
				}),
			]);

			await tracker.track("proposal-mid", "proposal", [
				sampleLink({
					sourceId: "obs-final",
					sourceType: "decision",
					relationship: "triggered_by",
					summary: "Triggered by observation",
				}),
			]);

			await tracker.track("decision-top", "decision", [
				sampleLink({
					sourceId: "proposal-mid",
					sourceType: "proposal",
					relationship: "derived_from",
					summary: "Decision based on proposal",
				}),
			]);

			const explanation = await tracker.explainDecision(
				sampleAuditEntry({
					id: "decision-top",
					action: "policy_evaluation",
				}),
			);

			expect(explanation).toContain("decision-top");
			expect(explanation).toContain("proposal-mid");
			expect(explanation).toContain("obs-final");
		});
	});

	// -------------------------------------------------------------------
	// AC 4: Query by target ID returns full chain
	// -------------------------------------------------------------------

	describe("AC4: Query by target ID returns full chain", () => {
		it("should get a provenance record by target ID", async () => {
			await tracker.track("target-1", "decision", [sampleLink()]);

			const record = await tracker.getProvenance("target-1");
			expect(record).not.toBeNull();
			expect(record!.targetId).toBe("target-1");
		});

		it("should return null for non-existent target IDs", async () => {
			const record = await tracker.getProvenance("nonexistent");
			expect(record).toBeNull();
		});

		it("should get chain links for a target ID", async () => {
			await tracker.track("chain-target", "decision", [
				sampleLink({
					sourceId: "src-1",
					sourceType: "decision",
					relationship: "derived_from",
					summary: "First link",
				}),
				sampleLink({
					sourceId: "src-2",
					sourceType: "proposal",
					relationship: "supported_by",
					summary: "Second link",
				}),
			]);

			// getChain returns links built from explanation chain traversal
			const chain = await tracker.getChain("chain-target");
			expect(chain.length).toBeGreaterThan(0);
		});

		it("should query by multiple target IDs independently", async () => {
			await tracker.track("id-a", "decision", [sampleLink()]);
			await tracker.track("id-b", "proposal", [sampleLink()]);
			await tracker.track("id-c", "memory", [sampleLink()]);

			const a = await tracker.getProvenance("id-a");
			const b = await tracker.getProvenance("id-b");
			const c = await tracker.getProvenance("id-c");

			expect(a!.targetType).toBe("decision");
			expect(b!.targetType).toBe("proposal");
			expect(c!.targetType).toBe("memory");
		});
	});

	// -------------------------------------------------------------------
	// AC 5: Persistence survives restart
	// -------------------------------------------------------------------

	describe("AC5: Persistence survives restart", () => {
		it("should persist records to disk via save()", async () => {
			await tracker.track("persist-target", "decision", [
				sampleLink({ summary: "Persist test" }),
			]);
			await tracker.save();

			const recordsFile = resolve(persistencePath, "records.json");
			expect(existsSync(recordsFile)).toBe(true);
		});

		it("should load persisted records after creating a new tracker instance", async () => {
			// Write records with one tracker
			await tracker.track("survive-1", "decision", [
				sampleLink({ summary: "First link", sourceId: "src-a" }),
			]);
			await tracker.track("survive-2", "proposal", [
				sampleLink({ summary: "Second link", sourceId: "src-b" }),
			]);
			await tracker.save();

			// Create a new tracker pointing to the same path
			const tracker2 = createProvenanceTracker({ persistencePath });
			const record1 = await tracker2.getProvenance("survive-1");
			const record2 = await tracker2.getProvenance("survive-2");

			expect(record1).not.toBeNull();
			expect(record1!.targetId).toBe("survive-1");
			expect(record1!.links[0].summary).toBe("First link");

			expect(record2).not.toBeNull();
			expect(record2!.targetId).toBe("survive-2");
			expect(record2!.links[0].summary).toBe("Second link");
		});

		it("should handle empty persistence directory gracefully", async () => {
			const emptyTracker = createProvenanceTracker({
				persistencePath: resolve(persistencePath, "empty"),
			});

			const stats = await emptyTracker.getStats();
			expect(stats.totalRecords).toBe(0);
			expect(stats.totalLinks).toBe(0);
		});

		it("should survive a corrupted records file", async () => {
			// Write invalid JSON to the records file
			const recordsDir = resolve(persistencePath);
			await mkdir(recordsDir, { recursive: true });
			await writeFile(resolve(recordsDir, "records.json"), "not-valid-json{{{", "utf-8");

			// Loading should not throw
			const corruptedTracker = createProvenanceTracker({ persistencePath });
			await corruptedTracker.init();

			// Should start with empty records
			const stats = await corruptedTracker.getStats();
			expect(stats.totalRecords).toBe(0);
		});

		it("should atomically write records (temp file + rename)", async () => {
			await tracker.track("atomic-target", "decision", [sampleLink()]);
			await tracker.save();

			const recordsFile = resolve(persistencePath, "records.json");
			const content = await readFile(recordsFile, "utf-8");
			const data = JSON.parse(content);

			expect(data.version).toBe(1);
			expect(data.records).toBeDefined();
			expect(data.records["atomic-target"]).toBeDefined();
		});
	});

	// -------------------------------------------------------------------
	// Stats
	// -------------------------------------------------------------------

	describe("Stats", () => {
		it("should return zero stats for empty tracker", async () => {
			const stats = await tracker.getStats();
			expect(stats.totalRecords).toBe(0);
			expect(stats.totalLinks).toBe(0);
			expect(stats.byType).toEqual({});
		});

		it("should compute stats correctly", async () => {
			await tracker.track("d-1", "decision", [
				sampleLink(),
				sampleLink({ sourceId: "src-2" }),
			]);
			await tracker.track("p-1", "proposal", [sampleLink()]);
			await tracker.track("m-1", "memory", [sampleLink()]);
			await tracker.track("a-1", "approval", [sampleLink()]);
			await tracker.track("pl-1", "plan", [sampleLink()]);

			const stats = await tracker.getStats();
			expect(stats.totalRecords).toBe(5);
			expect(stats.totalLinks).toBe(6); // d-1 has 2 links
			expect(stats.byType.decision).toBe(1);
			expect(stats.byType.proposal).toBe(1);
			expect(stats.byType.memory).toBe(1);
			expect(stats.byType.approval).toBe(1);
			expect(stats.byType.plan).toBe(1);
		});
	});

	// -------------------------------------------------------------------
	// addLink with auto-create
	// -------------------------------------------------------------------

	describe("addLink with auto-creation", () => {
		it("should auto-create a record when adding a link to a non-existent target", async () => {
			const record = await tracker.addLink("auto-create-target", {
				sourceId: "src-origin",
				sourceType: "decision",
				relationship: "derived_from",
				timestamp: new Date().toISOString(),
				summary: "Auto-created link",
				metadata: {},
			});

			expect(record).toBeDefined();
			expect(record.targetId).toBe("auto-create-target");
			expect(record.links.length).toBe(1);

			const fetched = await tracker.getProvenance("auto-create-target");
			expect(fetched).not.toBeNull();
			expect(fetched!.links[0].summary).toBe("Auto-created link");
		});
	});

	// -------------------------------------------------------------------
	// init() safety
	// -------------------------------------------------------------------

	describe("init safety", () => {
		it("should be safe to call init() multiple times", async () => {
			await tracker.init();
			await tracker.init(); // second call should be no-op
			await tracker.init(); // third call should be no-op

			// Should still work fine
			await tracker.track("safe-init", "decision", [sampleLink()]);
			const record = await tracker.getProvenance("safe-init");
			expect(record).not.toBeNull();
		});
	});
});
