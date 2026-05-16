/**
 * Tests for Skill Output Artifacts - P11.E
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillOutputArtifactStore, type SkillOutputArtifact } from "../src/core/skill-output-artifact.js";
import type { SkillExecutionOutput } from "../src/core/skill-runner.js";

describe("skill-output-artifact", () => {
	let archiveDir: string;
	let store: SkillOutputArtifactStore;

	const sampleOutput: SkillExecutionOutput = {
		content: "# Skill output\n\nTest content.",
		skillName: "test-skill",
		frontmatter: { name: "test-skill" },
		policyChecks: [{ allowed: true }],
		errors: [],
	};

	beforeEach(() => {
		archiveDir = join(tmpdir(), `pi-skill-artifact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(archiveDir, { recursive: true });
		store = new SkillOutputArtifactStore(archiveDir);
	});

	afterEach(() => {
		if (archiveDir) {
			rmSync(archiveDir, { recursive: true, force: true });
		}
	});

	describe("attach", () => {
		it("should attach a skill output to plan_intake artifact", () => {
			const artifact = store.attach("plan_intake", "plan-123", "test-skill", sampleOutput);
			expect(artifact.id).toBeDefined();
			expect(artifact.artifactType).toBe("plan_intake");
			expect(artifact.parentId).toBe("plan-123");
			expect(artifact.skillName).toBe("test-skill");
			expect(artifact.status).toBe("attached");
		});

		it("should attach a skill output to proposal artifact", () => {
			const artifact = store.attach("proposal", "proposal-456", "test-skill", sampleOutput, {
				signalId: "signal-001",
			});
			expect(artifact.artifactType).toBe("proposal");
			expect(artifact.parentId).toBe("proposal-456");
			expect(artifact.metadata?.signalId).toBe("signal-001");
		});

		it("should attach a skill output to remediation artifact", () => {
			const artifact = store.attach("remediation", "remediation-789", "test-skill", sampleOutput);
			expect(artifact.artifactType).toBe("remediation");
			expect(artifact.parentId).toBe("remediation-789");
		});

		it("should persist artifact to disk", () => {
			const artifact = store.attach("plan_intake", "plan-persist", "test-skill", sampleOutput);
			// The artifact is persisted in skill-outputs subdirectory
			expect(existsSync(join(archiveDir, "skill-outputs"))).toBe(true);
		});
	});

	describe("query", () => {
		it("should get artifacts by parent ID", () => {
			store.attach("plan_intake", "plan-001", "skill-a", sampleOutput);
			store.attach("plan_intake", "plan-001", "skill-b", sampleOutput);
			store.attach("proposal", "prop-001", "skill-a", sampleOutput);

			const planArtifacts = store.getByParent("plan-001");
			expect(planArtifacts).toHaveLength(2);

			const proposalArtifacts = store.getByParent("prop-001");
			expect(proposalArtifacts).toHaveLength(1);
		});

		it("should filter by artifact type when getting by parent", () => {
			store.attach("plan_intake", "plan-001", "skill-a", sampleOutput);
			store.attach("plan_intake", "plan-001", "skill-b", sampleOutput);
			store.attach("proposal", "plan-001", "skill-c", sampleOutput);

			const planIntakeOnly = store.getByParent("plan-001", "plan_intake");
			expect(planIntakeOnly).toHaveLength(2);
		});

		it("should get artifacts by skill name", () => {
			store.attach("plan_intake", "plan-001", "my-skill", sampleOutput);
			store.attach("proposal", "prop-001", "my-skill", sampleOutput);

			const results = store.getBySkill("my-skill");
			expect(results).toHaveLength(2);
		});

		it("should get artifact by ID", () => {
			const artifact = store.attach("plan_intake", "plan-001", "test-skill", sampleOutput);
			const found = store.getById(artifact.id);
			expect(found).toBeDefined();
			expect(found!.id).toBe(artifact.id);
		});
	});

	describe("detach", () => {
		it("should remove an attached artifact", () => {
			const artifact = store.attach("plan_intake", "plan-001", "test-skill", sampleOutput);
			expect(store.getById(artifact.id)).toBeDefined();

			const removed = store.detach(artifact.id);
			expect(removed).toBe(true);
			expect(store.getById(artifact.id)).toBeUndefined();
		});

		it("should return false for unknown artifact", () => {
			expect(store.detach("nonexistent")).toBe(false);
		});
	});

	describe("create artifact wrappers", () => {
		it("should create a plan intake artifact wrapper", () => {
			const artifact = store.attach("plan_intake", "plan-001", "test-skill", sampleOutput);
			const planIntake = store.createPlanIntakeArtifact("plan-001", [artifact]);
			expect(planIntake.planExecutionId).toBe("plan-001");
			expect(planIntake.skillArtifacts).toHaveLength(1);
		});

		it("should create a proposal artifact wrapper", () => {
			const artifact = store.attach("proposal", "prop-001", "test-skill", sampleOutput);
			const proposal = store.createProposalArtifact("prop-001", [artifact], "signal-001");
			expect(proposal.proposalId).toBe("prop-001");
			expect(proposal.signalId).toBe("signal-001");
		});

		it("should create a remediation artifact wrapper", () => {
			const artifact = store.attach("remediation", "rem-001", "test-skill", sampleOutput);
			const remediation = store.createRemediationArtifact("rem-001", [artifact]);
			expect(remediation.remediationId).toBe("rem-001");
		});
	});

	describe("loadFromDisk", () => {
		it("should load artifacts for a parent from disk", () => {
			const artifact = store.attach("plan_intake", "plan-load-test", "test-skill", sampleOutput);
			const loaded = store.loadFromDisk("plan-load-test");
			expect(loaded).toHaveLength(1);
			expect(loaded[0].id).toBe(artifact.id);
		});

		it("should return empty array for unknown parent", () => {
			const loaded = store.loadFromDisk("nonexistent");
			expect(loaded).toHaveLength(0);
		});
	});

	describe("getAll", () => {
		it("should return all artifacts", () => {
			store.attach("plan_intake", "plan-001", "skill-a", sampleOutput);
			store.attach("proposal", "prop-001", "skill-b", sampleOutput);
			expect(store.getAll()).toHaveLength(2);
		});
	});
});
