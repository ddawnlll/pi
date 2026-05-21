/**
 * Master Template Integration tests — P17.B
 *
 * Tests that MasterTemplateIntegration can load, parse, populate,
 * and validate the master template v2.5.1 for plan generation.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MasterTemplateIntegration } from "../../../src/brain/plan-factory/template.js";
import type { PlanExecutionContract, WorkstreamDef } from "../../../src/brain/plan-factory/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal v2.5.1 template for testing. */
function createMinimalTemplate(): string {
	return `# LLM Implementation Agent — Master Template v2.5.1

## 0. TL;DR / Compact Mental Model

{{phase}} {{title}} {{goal}}

## 1. Header

| Field | Value |
|---|---|
| Phase | {{phase}} |
| Title | {{title}} |
| Status | {{status}} |
| Mode | {{mode}} |

## 2. RACI

No placeholders here.

## 3. Purpose

{{phase}} {{description}}

## 4. What Carried Over

Nothing carried over.

## 5. Background / What Was Wrong

Some background.

## 6. Current Failure State / Known Blockers

Some blockers.

## 7. Risk Register

Risks listed here.

## 8. Workstreams

{{workstreams}}

## 9. Combined Implementation Order

{{batches}}

## 10. Definition of Done

{{criteria}}

## 11. Rollback Playbook

Conditions: {{conditions}}

Procedure: {{procedure}}

## 12. What Next Phase Inherits

{{nextPhase}}
`;
}

/** Create temp directory with a template file. */
function setupTemplateDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "template-test-"));
	writeFileSync(join(dir, "master-template.md"), createMinimalTemplate());
	return dir;
}

/** Create a minimal workstream definition for testing. */
function makeWorkstream(id: string, title: string): WorkstreamDef {
	return {
		id,
		title,
		goal: `Implement ${title}`,
		acceptanceCriteria: [`${id} complete`, `${id} validated`],
		dependencies: [],
		fileScope: [],
		isolationNotes: "",
		queuePriority: "normal",
		riskLevel: "medium",
	};
}

/** Create sample TemplateData for populating a template. */
function makeTemplateData(wsCount = 2) {
	const workstreams: WorkstreamDef[] = [];
	for (let i = 0; i < wsCount; i++) {
		const letter = String.fromCharCode(65 + i);
		workstreams.push(makeWorkstream(`P99.${letter}`, `Workstream ${letter}`));
	}

	return {
		phase: { id: "P99", title: "Test Phase", purpose: "Testing the template engine" },
		workstreams,
		dependencies: workstreams.slice(1).map((_, i) => ({
			from: workstreams[i].id,
			to: workstreams[i + 1].id,
			type: "blocking" as const,
		})),
		batches: [workstreams.slice(0, 1).map((w) => w.id), workstreams.slice(1).map((w) => w.id)],
		riskRegister: [{ risk: "Scope creep", likelihood: "medium", impact: "medium", mitigation: "Phased delivery" }],
		rollback: { triggerConditions: ["Test failures > 10%"], procedure: ["Revert to previous commit"] },
		nextPhase: { id: "P100", title: "Next Phase" },
		hardRequirements: ["npm only"],
		executionPolicies: {},
	};
}

// ---------------------------------------------------------------------------
// MasterTemplateIntegration Tests
// ---------------------------------------------------------------------------

describe("MasterTemplateIntegration", () => {
	// -----------------------------------------------------------------------
	// Construction
	// -----------------------------------------------------------------------

	it("should construct with default template path", () => {
		const integration = new MasterTemplateIntegration();
		expect(integration).toBeDefined();
		expect(integration.getSupportedVersions()).toEqual(["2.5.1"]);
	});

	it("should construct with custom template path", () => {
		const integration = new MasterTemplateIntegration("/custom/path/template.md");
		expect(integration).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 1: Loads and parses v2.5.1 template correctly
	// -----------------------------------------------------------------------

	it("should load and parse a valid v2.5.1 template", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const parsed = await integration.loadTemplate("2.5.1");

		expect(parsed).toBeDefined();
		expect(parsed.version).toBe("2.5.1");
		expect(parsed.segments.length).toBeGreaterThan(0);
		expect(parsed.raw).toBeTruthy();
		expect(typeof parsed.contractSchema).toBe("object");
	});

	it("should detect template version from content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "template-test-"));
		writeFileSync(
			join(dir, "template.md"),
			`# Test Template — Master Template v2.5.1\n\n## 1. Content\n\nTest`,
		);
		const integration = new MasterTemplateIntegration(join(dir, "template.md"));

		const parsed = await integration.loadTemplate("2.5.1");
		expect(parsed.version).toBe("2.5.1");
	});

	it("should default to 2.5.1 when no version marker is found", async () => {
		const dir = mkdtempSync(join(tmpdir(), "template-test-"));
		writeFileSync(join(dir, "template.md"), `# No Version\n\n## 1. Content\n\nTest`);
		const integration = new MasterTemplateIntegration(join(dir, "template.md"));

		const parsed = await integration.loadTemplate();
		// Falls back to "2.5.1" since no version marker found
		expect(parsed.version).toBe("2.5.1");
	});

	it("should cache parsed templates by version", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const first = await integration.loadTemplate("2.5.1");
		const second = await integration.loadTemplate("2.5.1");

		// Should be the same instance from cache
		expect(second).toBe(first);
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 2: Identifies all required segments
	// -----------------------------------------------------------------------

	it("should identify all 13 required segments", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const parsed = await integration.loadTemplate("2.5.1");

		// All 13 required segments
		expect(parsed.segments.length).toBe(13);

		const segmentNames = parsed.segments.map((s) => s.name);
		expect(segmentNames).toContain("TL;DR / Compact Mental Model");
		expect(segmentNames).toContain("Header");
		expect(segmentNames).toContain("RACI");
		expect(segmentNames).toContain("Purpose");
		expect(segmentNames).toContain("What Carried Over");
		expect(segmentNames).toContain("Background / What Was Wrong");
		expect(segmentNames).toContain("Current Failure State / Known Blockers");
		expect(segmentNames).toContain("Risk Register");
		expect(segmentNames).toContain("Workstreams");
		expect(segmentNames).toContain("Combined Implementation Order");
		expect(segmentNames).toContain("Definition of Done");
		expect(segmentNames).toContain("Rollback Playbook");
		expect(segmentNames).toContain("What Next Phase Inherits");
	});

	it("should extract placeholders from segment content", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const parsed = await integration.loadTemplate("2.5.1");

		// TL;DR segment should have 3 placeholders
		const tldr = parsed.segments.find((s) => s.id === "tldr");
		expect(tldr).toBeDefined();
		expect(tldr!.placeholders.length).toBeGreaterThanOrEqual(1);
		expect(tldr!.placeholders).toContain("phase");
		expect(tldr!.placeholders).toContain("title");
		expect(tldr!.placeholders).toContain("goal");
	});

	it("should mark all segments as required", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const parsed = await integration.loadTemplate("2.5.1");

		for (const segment of parsed.segments) {
			expect(segment.required).toBe(true);
		}
	});

	it("should assign correct ordering to each segment", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const parsed = await integration.loadTemplate("2.5.1");

		for (let i = 0; i < parsed.segments.length; i++) {
			expect(parsed.segments[i].order).toBe(i);
		}
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 3: Populates all {{ ... }} placeholders
	// -----------------------------------------------------------------------

	it("should populate a single segment with data", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData();

		const segment = {
			id: "tldr",
			name: "TL;DR / Compact Mental Model",
			required: true,
			order: 0,
			template: "Phase {{phase}} - {{title}}: {{goal}}",
			placeholders: ["phase", "title", "goal"],
		};

		const result = integration.populateSegment(segment, data, "P99", "Test Phase");
		expect(result).toContain("Phase P99");
		expect(result).toContain("- Test Phase:");
		expect(result).toContain(data.phase.purpose);
		expect(result).not.toMatch(/\{\{/);
	});

	it("should populate all segments in full template", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));
		const parsed = await integration.loadTemplate("2.5.1");
		const data = makeTemplateData();

		const result = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");

		// All placeholders should be replaced
		expect(result).not.toMatch(/\{\{\w+\}\}/);

		// All segments present
		expect(result).toContain("TL;DR / Compact Mental Model");
		expect(result).toContain("Header");
		expect(result).toContain("RACI");
		expect(result).toContain("Purpose");
		expect(result).toContain("Workstreams");
		expect(result).toContain("Rollback Playbook");

		// Data should be injected
		expect(result).toContain("P99");
		expect(result).toContain("Test Phase");
	});

	it("should populate {{phase}} and {{title}} in Header segment", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData();

		const headerSegment = {
			id: "header",
			name: "Header",
			required: true,
			order: 1,
			template: "| Phase | {{phase}} |\n| Title | {{title}} |\n| Status | {{status}} |\n| Mode | {{mode}} |",
			placeholders: ["phase", "title", "status", "mode"],
		};

		const result = integration.populateSegment(headerSegment, data, "P99", "Test Phase");
		expect(result).toContain("P99");
		expect(result).toContain("Test Phase");
		expect(result).toContain("Authoritative Implementation");
		expect(result).toContain("experimental_6");
	});

	it("should populate {{workstreams}} with workstream definitions", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(3);

		const wsSegment = {
			id: "workstreams",
			name: "Workstreams",
			required: true,
			order: 8,
			template: "{{workstreams}}",
			placeholders: ["workstreams"],
		};

		const result = integration.populateSegment(wsSegment, data, "P99", "Test Phase");
		expect(result).toContain("P99.A");
		expect(result).toContain("P99.B");
		expect(result).toContain("P99.C");
		expect(result).toContain("Implement Workstream");
	});

	it("should populate {{batches}} with batch layout", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(3);

		const batchSegment = {
			id: "order",
			name: "Combined Implementation Order",
			required: true,
			order: 9,
			template: "{{batches}}",
			placeholders: ["batches"],
		};

		const result = integration.populateSegment(batchSegment, data, "P99", "Test Phase");
		expect(result).toContain("Batch 1");
		expect(result).toContain("Batch 2");
		expect(result).toContain("P99.A");
		expect(result).toContain("P99.B");
	});

	it("should populate {{criteria}} with acceptance criteria", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(2);

		const doneSegment = {
			id: "done",
			name: "Definition of Done",
			required: true,
			order: 10,
			template: "{{criteria}}",
			placeholders: ["criteria"],
		};

		const result = integration.populateSegment(doneSegment, data, "P99", "Test Phase");
		expect(result).toContain("[ ] P99.A complete");
		expect(result).toContain("[ ] P99.A validated");
		expect(result).toContain("[ ] P99.B complete");
	});

	it("should populate {{conditions}} and {{procedure}} in Rollback Playbook", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData();

		const rollbackSegment = {
			id: "rollback",
			name: "Rollback Playbook",
			required: true,
			order: 11,
			template: "Conditions: {{conditions}}\n\nProcedure:\n{{procedure}}",
			placeholders: ["conditions", "procedure"],
		};

		const result = integration.populateSegment(rollbackSegment, data, "P99", "Test Phase");
		expect(result).toContain("Test failures > 10%");
		expect(result).toContain("Revert to previous commit");
	});

	it("should populate {{nextPhase}} with next phase info", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData();

		const nextSegment = {
			id: "next",
			name: "What Next Phase Inherits",
			required: true,
			order: 12,
			template: "Next: {{nextPhase}}",
			placeholders: ["nextPhase"],
		};

		const result = integration.populateSegment(nextSegment, data, "P99", "Test Phase");
		expect(result).toContain("P100");
		expect(result).toContain("Next Phase");
	});

	it("should remove unfilled placeholders as empty strings", async () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData();

		// A segment with an unknown placeholder
		const segment = {
			id: "unknown",
			name: "Unknown",
			required: true,
			order: 99,
			template: "Value: {{unknown_placeholder}}",
			placeholders: ["unknown_placeholder"],
		};

		const result = integration.populateSegment(segment, data, "P99", "Test Phase");
		// The unknown placeholder should be removed
		expect(result).not.toMatch(/\{\{/);
		expect(result).toBe("Value: ");
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 4: Generates valid JSON contract
	// -----------------------------------------------------------------------

	it("should generate a valid PlanExecutionContract", () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(3);

		const contract = integration.generateContract("", {
			id: "P99",
			title: "Test Phase",
			workstreams: data.workstreams,
			dependencies: data.dependencies,
			batches: data.batches,
		});

		expect(contract).toBeDefined();
		expect(contract.contractVersion).toBe("2.5.1");
		expect(contract.phase.id).toBe("P99");
		expect(contract.phase.title).toBe("Test Phase");
		expect(contract.workstreams.length).toBe(3);
		expect(contract.batches.length).toBeGreaterThanOrEqual(1);
		expect(contract.scaleMode).toBe("experimental_6");
		expect(contract.integrationQueue).toBe(true);
		expect(contract.worktreeIsolation).toBe(true);
	});

	it("should include all workstreams in the contract", () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(2);

		const contract = integration.generateContract("", {
			id: "P99",
			title: "Test Phase",
			workstreams: data.workstreams,
			dependencies: data.dependencies,
			batches: data.batches,
		});

		expect(contract.workstreams.map((w) => w.id)).toEqual(["P99.A", "P99.B"]);
	});

	it("should include dependency edges in the contract", () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(2);

		const contract = integration.generateContract("", {
			id: "P99",
			title: "Test Phase",
			workstreams: data.workstreams,
			dependencies: data.dependencies,
			batches: data.batches,
		});

		expect(contract.dependencies.length).toBe(1);
		expect(contract.dependencies[0].from).toBe("P99.A");
		expect(contract.dependencies[0].to).toBe("P99.B");
		expect(contract.dependencies[0].type).toBe("blocking");
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 5: Validates populated output completeness
	// -----------------------------------------------------------------------

	it("should validate complete populated template with all segments", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));
		const parsed = await integration.loadTemplate("2.5.1");
		const data = makeTemplateData();

		const populated = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");

		const results = integration.validatePopulated(populated);
		const errors = results.filter((r) => r.type === "error");
		expect(errors.length).toBe(0);
	});

	it("should detect missing segments in populated output", () => {
		const integration = new MasterTemplateIntegration();

		const results = integration.validatePopulated("No segments here at all");
		const errors = results.filter((r) => r.type === "error");
		expect(errors.length).toBe(13); // All 13 segments missing
	});

	it("should detect a partially complete populated output", () => {
		const integration = new MasterTemplateIntegration();

		// Only the first two segments
		const partial = `## 0. TL;DR / Compact Mental Model\n\nSome content\n\n## 1. Header\n\nSome header`;
		const results = integration.validatePopulated(partial);
		const errors = results.filter((r) => r.type === "error");
		expect(errors.length).toBe(11); // 11 out of 13 missing
		const infos = results.filter((r) => r.type === "info");
		expect(infos.length).toBe(2); // 2 segments present
	});

	it("should validate a complete contract without errors", () => {
		const integration = new MasterTemplateIntegration();
		const data = makeTemplateData(2);

		const contract = integration.generateContract("", {
			id: "P99",
			title: "Test Phase",
			workstreams: data.workstreams,
			dependencies: data.dependencies,
			batches: data.batches,
		});

		const results = integration.validateContract(contract);
		const errors = results.filter((r) => r.type === "error");
		expect(errors.length).toBe(0);
	});

	it("should detect invalid contract: missing contractVersion", () => {
		const integration = new MasterTemplateIntegration();

		const contract: PlanExecutionContract = {
			contractVersion: "",
			phase: { id: "P99", title: "Test" },
			workstreams: [],
			dependencies: [],
			batches: [],
			scaleMode: "stable_3",
			integrationQueue: false,
			worktreeIsolation: false,
			metadata: {},
		};

		const results = integration.validateContract(contract);
		expect(results.some((r) => r.message.includes("contractVersion"))).toBe(true);
	});

	it("should detect invalid contract: missing phase ID", () => {
		const integration = new MasterTemplateIntegration();

		const contract: PlanExecutionContract = {
			contractVersion: "2.5.1",
			phase: { id: "", title: "Test" },
			workstreams: [],
			dependencies: [],
			batches: [],
			scaleMode: "stable_3",
			integrationQueue: false,
			worktreeIsolation: false,
			metadata: {},
		};

		const results = integration.validateContract(contract);
		expect(results.some((r) => r.message.includes("phase.id"))).toBe(true);
	});

	it("should detect invalid contract: no workstreams", () => {
		const integration = new MasterTemplateIntegration();

		const contract: PlanExecutionContract = {
			contractVersion: "2.5.1",
			phase: { id: "P99", title: "Test" },
			workstreams: [],
			dependencies: [],
			batches: [["P99.A"]],
			scaleMode: "stable_3",
			integrationQueue: false,
			worktreeIsolation: false,
			metadata: {},
		};

		const results = integration.validateContract(contract);
		expect(results.some((r) => r.message.includes("workstreams"))).toBe(true);
	});

	it("should detect duplicate workstream IDs", () => {
		const integration = new MasterTemplateIntegration();

		const contract: PlanExecutionContract = {
			contractVersion: "2.5.1",
			phase: { id: "P99", title: "Test" },
			workstreams: [
				makeWorkstream("P99.A", "First"),
				makeWorkstream("P99.A", "Duplicate"),
			],
			dependencies: [],
			batches: [["P99.A"]],
			scaleMode: "stable_3",
			integrationQueue: false,
			worktreeIsolation: false,
			metadata: {},
		};

		const results = integration.validateContract(contract);
		expect(results.some((r) => r.message.includes("Duplicate"))).toBe(true);
	});

	it("should check all required segments are present", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));
		const parsed = await integration.loadTemplate("2.5.1");
		const data = makeTemplateData();

		const populated = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");

		expect(integration.checkAllRequiredSegmentsPresent(populated)).toBe(true);
		expect(integration.checkAllRequiredSegmentsPresent("")).toBe(false);
		expect(integration.checkAllRequiredSegmentsPresent("## 0. TL;DR only")).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 6: Handles missing template gracefully
	// -----------------------------------------------------------------------

	it("should handle missing template file gracefully", async () => {
		const integration = new MasterTemplateIntegration("/nonexistent/path/template.md");

		const parsed = await integration.loadTemplate("2.5.1");

		// Should return a fallback template
		expect(parsed).toBeDefined();
		expect(parsed.version).toBe("2.5.1");
		expect(parsed.segments.length).toBe(13);
	});

	it("should generate fallback template with all required segments", () => {
		const integration = new MasterTemplateIntegration();

		// Access private method via bracket notation
		const fallback = integration["generateFallbackTemplate"]("2.5.1");

		expect(fallback).toContain("2.5.1");
		expect(fallback).toContain("TL;DR / Compact Mental Model");
		expect(fallback).toContain("Header");
		expect(fallback).toContain("RACI");
		expect(fallback).toContain("Workstreams");
		expect(fallback).toContain("Definition of Done");
		expect(fallback).toContain("Rollback Playbook");
		expect(fallback).toContain("What Next Phase Inherits");
	});

	it("should use fallback segments for population when template is missing", async () => {
		const integration = new MasterTemplateIntegration("/nonexistent/path/template.md");
		const parsed = await integration.loadTemplate("2.5.1");
		const data = makeTemplateData();

		const populated = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");

		// Should still produce usable output with all section headers
		expect(populated).toContain("TL;DR / Compact Mental Model");
		expect(populated).toContain("Header");
		expect(populated).toContain("RACI");
		expect(populated).toContain("Purpose");
		expect(populated).toContain("Workstreams");
		expect(populated).toContain("Definition of Done");
		expect(populated).toContain("Rollback Playbook");
		expect(populated).toContain("What Next Phase Inherits");

		// Workstream content should be populated
		expect(populated).toContain("P99.A");
		expect(populated).toContain("Workstream A");
	});

	it("should still validate populated content from fallback template", async () => {
		const integration = new MasterTemplateIntegration("/nonexistent/path/template.md");
		const parsed = await integration.loadTemplate("2.5.1");
		const data = makeTemplateData();

		const populated = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");
		const results = integration.validatePopulated(populated);
		const errors = results.filter((r) => r.type === "error");

		expect(errors.length).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Version support
	// -----------------------------------------------------------------------

	it("should report supported versions", () => {
		const integration = new MasterTemplateIntegration();
		expect(integration.getSupportedVersions()).toEqual(["2.5.1"]);
	});

	it("should check if version is supported", () => {
		const integration = new MasterTemplateIntegration();
		expect(integration.isVersionSupported("2.5.1")).toBe(true);
		expect(integration.isVersionSupported("2.4.0")).toBe(false);
		expect(integration.isVersionSupported("3.0.0")).toBe(false);
	});

	// -----------------------------------------------------------------------
	// Cache management
	// -----------------------------------------------------------------------

	it("should clear the parsed cache", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		const first = await integration.loadTemplate("2.5.1");
		integration.clearCache();
		const second = await integration.loadTemplate("2.5.1");

		// After clearing cache, should get a new parsed instance
		expect(second).not.toBe(first);
	});

	// -----------------------------------------------------------------------
	// Round-trip: load -> populate -> validate -> contract
	// -----------------------------------------------------------------------

	it("should complete full round-trip: load -> populate -> validate -> contract", async () => {
		const dir = setupTemplateDir();
		const integration = new MasterTemplateIntegration(join(dir, "master-template.md"));

		// 1. Load
		const parsed = await integration.loadTemplate("2.5.1");
		expect(parsed.segments.length).toBe(13);

		// 2. Populate
		const data = makeTemplateData(3);
		const populated = integration.populateFullTemplate(parsed, data, "P99", "Test Phase");

		// 3. Validate populated
		const popResults = integration.validatePopulated(populated);
		expect(popResults.filter((r) => r.type === "error").length).toBe(0);

		// 4. Check all segments present
		expect(integration.checkAllRequiredSegmentsPresent(populated)).toBe(true);

		// 5. Generate contract
		const contract = integration.generateContract(populated, {
			id: "P99",
			title: "Test Phase",
			workstreams: data.workstreams,
			dependencies: data.dependencies,
			batches: data.batches,
		});

		// 6. Validate contract
		const contractResults = integration.validateContract(contract);
		expect(contractResults.filter((r) => r.type === "error").length).toBe(0);

		// 7. Verify contract structure
		expect(contract.contractVersion).toBe("2.5.1");
		expect(contract.workstreams.length).toBe(3);
		expect(contract.batches.length).toBeGreaterThanOrEqual(1);
	});
});
