/**
 * Tests for Task Creation Studio — Parser, Validator, and UI.
 *
 * Tests:
 * 1. Plan parser extracts metadata from markdown
 * 2. Plan parser extracts metadata from JSON
 * 3. Plan parser extracts metadata from YAML
 * 4. Plan parser handles plain text (filename fallback)
 * 5. Validator detects missing title
 * 6. Validator detects missing plan ID
 * 7. Validator detects duplicate plan IDs
 * 8. Validator detects duplicate task names
 * 9. Validator detects missing dependencies
 * 10. Validator detects cycles
 * 11. Validator detects file conflicts
 * 12. Validator produces batches from DAG
 * 13. Rename preview generation
 * 14. Rename template validation
 * 15. Execution preview computation
 * 16. UI renders and responds
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { parsePlan } from "../src/utils/planParser";
import {
	validatePlans,
	generateRenamePreviews,
	computeExecutionPreview,
	validateRenameTemplate,
} from "../src/utils/planValidator";
import type { ParsedPlanDraft } from "../src/types";

// =========================================================================
// Plan Parser Tests
// =========================================================================

describe("planParser", () => {
	it("extracts title and plan ID from markdown (plain key:value)", () => {
		const md = `# P42-RIR: Requirements Inspection Report

plan_id: P42-RIR
execution_class: research
depends_on: P41-RIR
allowed_files: docs/requirements.md, specs/api.md
forbidden_files: src/
validate: npm run lint, npm test
report: ACCP-Lite v1.0 IPR

## Workspace A — Analysis
`;
		const parsed = parsePlan(md, "P42-RIR.md");
		expect(parsed.detectedTitle).toBe("P42-RIR: Requirements Inspection Report");
		expect(parsed.detectedPlanId).toBe("P42-RIR");
		expect(parsed.detectedExecutionClass).toBe("research");
		expect(parsed.detectedDependencies).toContain("P41-RIR");
		expect(parsed.detectedAllowedFiles).toContain("docs/requirements.md");
		expect(parsed.detectedForbiddenFiles).toContain("src/");
		expect(parsed.detectedValidationCommands).toContain("npm run lint");
		expect(parsed.parseStatus).toBe("ok");
	});

	it("extracts metadata from bold-markdown format (**Key:** Value)", () => {
		const md = `# P42-RIR — Requirements Inspection

**Plan ID:** P42-RIR
**Execution Class:** \`research\`
**Depends On:** P41-RIR
**Allowed Files:** docs/requirements.md
**Required Gates:** npm test
`;
		const parsed = parsePlan(md, "P42-RIR.md");
		expect(parsed.detectedTitle).toBe("P42-RIR — Requirements Inspection");
		expect(parsed.detectedPlanId).toBe("P42-RIR");
		expect(parsed.detectedExecutionClass).toContain("research");
		expect(parsed.detectedDependencies).toContain("P41-RIR");
		expect(parsed.detectedAllowedFiles).toContain("docs/requirements.md");
		expect(parsed.detectedValidationCommands).toContain("npm test");
	});

	it("extracts metadata from bullet-list format (- Key: Value)", () => {
		const md = `# P43-TVR: Test Validation

- Plan ID: P43-TVR
- Execution Class: validation
- Depends On: P42-RIR
- Allowed Files: tests/
- Validate: npm run test:unit
`;
		const parsed = parsePlan(md, "P43-TVR.md");
		expect(parsed.detectedTitle).toBe("P43-TVR: Test Validation");
		expect(parsed.detectedPlanId).toBe("P43-TVR");
		expect(parsed.detectedExecutionClass).toBe("validation");
		expect(parsed.detectedDependencies).toContain("P42-RIR");
		expect(parsed.detectedAllowedFiles).toContain("tests/");
		expect(parsed.detectedValidationCommands).toContain("npm run test:unit");
	});

	it("extracts full P41 plan with embedded Part 3 JSON (deps, allowedFiles, workspaces, valCmds)", () => {
		const md = `# P41 — Execution Visibility & Control Cockpit

**Contract Version:** 5.0.0
**Phase:** P41
**Title:** Execution Visibility & Control Cockpit
**Status:** Planned
**Execution Class:** \`visibility_control_platform\`
**Required Gates:** \`make test\`, \`make test-full\`

## 1. Section

### P41.00 — Workspace One

### P41.01 — Workspace Two

## Part 3 — JSON Queue

\`\`\`json
{
  "phase": "P41",
  "workspaces": [
    {
      "id": "P41.00",
      "title": "Workspace One",
      "dependencies": [],
      "capabilities": {
        "canEdit": ["docs/pi/p41/**"]
      }
    },
    {
      "id": "P41.01",
      "title": "Workspace Two",
      "dependencies": ["P41.00"],
      "capabilities": {
        "canEdit": ["packages/execution-core/src/events/**"]
      }
    }
  ]
}
\`\`\`
`;
		const parsed = parsePlan(md, "P41-plan.md");
		expect(parsed.detectedTitle).toBe("P41 — Execution Visibility & Control Cockpit");
		expect(parsed.detectedPlanId).toBe("P41");
		expect(parsed.detectedExecutionClass).toContain("visibility_control_platform");
		expect(parsed.detectedValidationCommands).toContain("make test");
		expect(parsed.detectedValidationCommands).toContain("make test-full");
		expect(parsed.detectedWorkspaces).toContain("P41.00");
		expect(parsed.detectedWorkspaces).toContain("P41.01");
		expect(parsed.detectedDependencies).toContain("P41.00");
		expect(parsed.detectedAllowedFiles).toContain("docs/pi/p41/**");
		expect(parsed.detectedAllowedFiles).toContain("packages/execution-core/src/events/**");
	});

	it("parses the real docs/P41_Execution_Visibility_Control_Cockpit.md file", () => {
		const fs = require("fs");
		const content = fs.readFileSync(
			"/Users/hootie/src/pi/docs/P41_Execution_Visibility_Control_Cockpit.md",
			"utf-8",
		);
		const parsed = parsePlan(content, "P41_Execution_Visibility_Control_Cockpit.md");
		expect(parsed.detectedTitle).toBe("P41 — Execution Visibility & Control Cockpit");
		expect(parsed.detectedPlanId).toBe("P41");
		expect(parsed.detectedExecutionClass).toBe("visibility_control_platform");
		expect(parsed.detectedValidationCommands).toContain("make test");
		expect(parsed.detectedValidationCommands).toContain("make test-full");
		expect(parsed.detectedWorkspaces.length).toBe(14);
		expect(parsed.detectedWorkspaces).toContain("P41.00");
		expect(parsed.detectedWorkspaces).toContain("P41.13");
		expect(parsed.detectedDependencies.length).toBeGreaterThan(0);
		expect(parsed.detectedDependencies).toContain("P41.00");
		expect(parsed.detectedDependencies).toContain("P41.02");
		expect(parsed.detectedAllowedFiles.length).toBeGreaterThan(0);
		expect(parsed.detectedAllowedFiles).toContain("docs/pi/p41/**");
		expect(parsed.detectedAllowedFiles).toContain("packages/execution-core/src/events/**");
		expect(parsed.parseStatus).toBe("ok");
	});

	it("extracts data from JSON plan", () => {
		const json = JSON.stringify({
			title: "P43-IPR: Implementation Plan",
			planId: "P43-IPR",
			executionClass: "implementation",
			workspaces: ["A", "B", "C"],
			dependencies: ["P42-RIR"],
			allowedFiles: ["src/features/"],
			forbiddenFiles: ["node_modules/"],
			validationCommands: ["npm test"],
			reportRequirements: ["ACCP-Lite IPR"],
		});
		const parsed = parsePlan(json, "P43-IPR.json");
		expect(parsed.detectedTitle).toBe("P43-IPR: Implementation Plan");
		expect(parsed.detectedPlanId).toBe("P43-IPR");
		expect(parsed.detectedDependencies).toContain("P42-RIR");
		expect(parsed.detectedValidationCommands).toContain("npm test");
		expect(parsed.parseStatus).toBe("ok");
	});

	it("extracts data from YAML plan", () => {
		const yaml = `title: P44-TVR: Test Validation Report
plan_id: P44-TVR
execution_class: validation
dependencies:
  - P43-IPR
allowed_files:
  - tests/
validation_commands:
  - npm run test:unit
`;
		const parsed = parsePlan(yaml, "P44-TVR.yml");
		expect(parsed.detectedTitle).toBe("P44-TVR: Test Validation Report");
		expect(parsed.detectedPlanId).toBe("P44-TVR");
		expect(parsed.detectedDependencies).toContain("P43-IPR");
		expect(parsed.detectedAllowedFiles).toContain("tests/");
		expect(parsed.detectedValidationCommands).toContain("npm run test:unit");
		expect(parsed.parseStatus).toBe("ok");
	});

	it("uses filename as fallback title for plain text without heading", () => {
		const txt = "Some plan content without a markdown heading.\ndepends_on: P42";
		const parsed = parsePlan(txt, "my-plan.txt");
		expect(parsed.detectedTitle).toBe("my plan");
		expect(parsed.parseStatus).toBe("warning");
		expect(parsed.parseMessages.some((m) => m.message.includes("filename"))).toBe(true);
	});

	it("reports JSON parse error for invalid JSON", () => {
		const parsed = parsePlan("{invalid json}", "bad.json");
		expect(parsed.parseStatus).toBe("error");
		expect(parsed.parseMessages.some((m) => m.severity === "error")).toBe(true);
	});

	it("detects ACCP references in markdown", () => {
		// ACCP-Lite and IPR should be detected as report requirements
		const md = `# P45-PRR: Progress Review\n\nreport_requirements: ACCP-Lite v1.0, IPR`;
		const parsed = parsePlan(md, "P45-PRR.md");
		expect(parsed.detectedReportRequirements.length).toBeGreaterThan(0);
		expect(parsed.detectedReportRequirements.some(r => r.includes("ACCP") || r.includes("Lite"))).toBe(true);
	});
});

// =========================================================================
// Validator Tests
// =========================================================================

describe("planValidator", () => {
	const makePlan = (overrides: Partial<ParsedPlanDraft> & { sourceFileName: string }): ParsedPlanDraft => ({
		localId: overrides.localId ?? `local-${Math.random().toString(36).slice(2, 6)}`,
		sourceFileName: overrides.sourceFileName,
		rawText: overrides.rawText ?? "",
		detectedTitle: overrides.detectedTitle ?? "Test Plan",
		detectedPlanId: overrides.detectedPlanId ?? "TP-001",
		detectedExecutionClass: overrides.detectedExecutionClass,
		detectedWorkspaces: overrides.detectedWorkspaces ?? [],
		detectedDependencies: overrides.detectedDependencies ?? [],
		detectedAllowedFiles: overrides.detectedAllowedFiles ?? [],
		detectedForbiddenFiles: overrides.detectedForbiddenFiles ?? [],
		detectedValidationCommands: overrides.detectedValidationCommands ?? [],
		detectedReportRequirements: overrides.detectedReportRequirements ?? [],
		parseStatus: overrides.parseStatus ?? "ok",
		parseMessages: overrides.parseMessages ?? [],
	});

	it("detects missing title as blocker", () => {
		const plan = makePlan({ sourceFileName: "plan.md", detectedTitle: "" });
		const result = validatePlans([plan]);
		expect(result.hasBlocker).toBe(true);
		expect(result.messages.some((m) => m.area === "schema" && m.severity === "blocker")).toBe(true);
	});

	it("detects missing plan ID as blocker", () => {
		const plan = makePlan({ sourceFileName: "plan.md", detectedPlanId: "" });
		const result = validatePlans([plan]);
		expect(result.hasBlocker).toBe(true);
		expect(result.messages.some((m) => m.message.includes("no plan ID"))).toBe(true);
	});

	it("detects duplicate plan IDs", () => {
		const a = makePlan({ sourceFileName: "a.md", detectedPlanId: "P42" });
		const b = makePlan({ sourceFileName: "b.md", detectedPlanId: "P42" });
		const result = validatePlans([a, b]);
		expect(result.messages.some((m) => m.area === "rename" && m.message.includes("Duplicate plan ID"))).toBe(true);
	});

	it("detects missing dependencies", () => {
		const plan = makePlan({
			sourceFileName: "plan.md",
			detectedDependencies: ["NONEXISTENT"],
		});
		const result = validatePlans([plan]);
		expect(result.messages.some((m) => m.area === "dag" && m.message.includes("not found"))).toBe(true);
	});

	it("detects cycles", () => {
		const a = makePlan({
			sourceFileName: "a.md",
			localId: "plan-a",
			detectedPlanId: "P42",
			detectedTitle: "Plan A",
			detectedDependencies: ["P43"],
		});
		const b = makePlan({
			sourceFileName: "b.md",
			localId: "plan-b",
			detectedPlanId: "P43",
			detectedTitle: "Plan B",
			detectedDependencies: ["P42"],
		});
		const result = validatePlans([a, b]);
		expect(result.cycles.length).toBeGreaterThan(0);
		expect(result.hasBlocker).toBe(true);
	});

	it("detects file conflicts", () => {
		const a = makePlan({
			sourceFileName: "a.md",
			localId: "plan-a-1",
			detectedAllowedFiles: ["src/shared/file.ts"],
		});
		const b = makePlan({
			sourceFileName: "b.md",
			localId: "plan-b-1",
			detectedAllowedFiles: ["src/shared/file.ts"],
		});
		const result = validatePlans([a, b]);
		expect(result.fileConflicts.length).toBeGreaterThan(0);
		expect(result.messages.some((m) => m.area === "files" && m.message.includes("File conflict"))).toBe(true);
	});

	it("produces topological batches from dependency graph", () => {
		const root = makePlan({
			sourceFileName: "root.md",
			localId: "plan-root",
			detectedPlanId: "ROOT",
			detectedDependencies: [],
		});
		const child = makePlan({
			sourceFileName: "child.md",
			localId: "plan-child",
			detectedPlanId: "CHILD",
			detectedDependencies: ["ROOT"],
		});
		const result = validatePlans([root, child]);
		expect(result.batches.length).toBeGreaterThanOrEqual(2);
		expect(result.batches[0].planLocalIds).toContain("plan-root");
		expect(result.batches[1]?.planLocalIds).toContain("plan-child");
	});

	it("warns about missing validation commands", () => {
		const plan = makePlan({
			sourceFileName: "plan.md",
			detectedValidationCommands: [],
		});
		const result = validatePlans([plan]);
		expect(result.messages.some((m) => m.area === "validation" && m.severity === "warning")).toBe(true);
	});

	it("warns about missing allowed files", () => {
		const plan = makePlan({
			sourceFileName: "plan.md",
			detectedAllowedFiles: [],
		});
		const result = validatePlans([plan]);
		expect(result.messages.some((m) => m.area === "files" && m.severity === "warning")).toBe(true);
	});
});

// =========================================================================
// Rename Preview Tests
// =========================================================================

describe("rename preview", () => {
	it("generates previews using template variables", () => {
		const plans = [
			{
				localId: "p1",
				sourceFileName: "P42-RIR.md",
				rawText: "",
				detectedPlanId: "P42-RIR",
				detectedTitle: "Requirements Inspection",
				detectedExecutionClass: undefined,
				detectedWorkspaces: [],
				detectedDependencies: [],
				detectedAllowedFiles: [],
				detectedForbiddenFiles: [],
				detectedValidationCommands: [],
				detectedReportRequirements: [],
				parseStatus: "ok" as const,
				parseMessages: [],
			},
		];
		const previews = generateRenamePreviews(plans, "{planId}-{shortTitle}");
		expect(previews[0].newTitle).toBe("P42-RIR-Requirements Inspection");
		expect(previews[0].slug).toBeTruthy();
	});

	it("detects duplicate generated names", () => {
		// Use same planId so generated names are identical
		const plans = [
			{
				localId: "p1",
				sourceFileName: "a.md",
				rawText: "",
				detectedPlanId: "P42",
				detectedTitle: "Same Title",
				detectedExecutionClass: undefined,
				detectedWorkspaces: [],
				detectedDependencies: [],
				detectedAllowedFiles: [],
				detectedForbiddenFiles: [],
				detectedValidationCommands: [],
				detectedReportRequirements: [],
				parseStatus: "ok" as const,
				parseMessages: [],
			},
			{
				localId: "p2",
				sourceFileName: "b.md",
				rawText: "",
				detectedPlanId: "P42",
				detectedTitle: "Same Title",
				detectedExecutionClass: undefined,
				detectedWorkspaces: [],
				detectedDependencies: [],
				detectedAllowedFiles: [],
				detectedForbiddenFiles: [],
				detectedValidationCommands: [],
				detectedReportRequirements: [],
				parseStatus: "ok" as const,
				parseMessages: [],
			},
		];
		const result = validatePlans(plans);
		expect(result.messages.some((m) => m.area === "rename" && m.message.includes("Duplicate generated"))).toBe(true);
	});
});

describe("validateRenameTemplate", () => {
	it("returns null for valid template", () => {
		expect(validateRenameTemplate("{planId}-{shortTitle}")).toBeNull();
	});

	it("returns error for unknown variable", () => {
		expect(validateRenameTemplate("{unknown}")).toContain("Unknown");
	});

	it("returns error for empty template", () => {
		expect(validateRenameTemplate("")).toContain("cannot be empty");
	});
});

// =========================================================================
// Execution Preview Tests
// =========================================================================

describe("computeExecutionPreview", () => {
	it("adjusts safe parallelism for file conflicts", () => {
		const plans = [
			{
				localId: "a",
				sourceFileName: "a.md",
				rawText: "",
				detectedPlanId: "P1",
				detectedTitle: "Plan A",
				detectedExecutionClass: undefined,
				detectedWorkspaces: [],
				detectedDependencies: [],
				detectedAllowedFiles: ["shared.ts"],
				detectedForbiddenFiles: [],
				detectedValidationCommands: [],
				detectedReportRequirements: [],
				parseStatus: "ok" as const,
				parseMessages: [],
			},
			{
				localId: "b",
				sourceFileName: "b.md",
				rawText: "",
				detectedPlanId: "P2",
				detectedTitle: "Plan B",
				detectedExecutionClass: undefined,
				detectedWorkspaces: [],
				detectedDependencies: [],
				detectedAllowedFiles: ["shared.ts"],
				detectedForbiddenFiles: [],
				detectedValidationCommands: [],
				detectedReportRequirements: [],
				parseStatus: "ok" as const,
				parseMessages: [],
			},
		];
		const validation = validatePlans(plans);
		const preview = computeExecutionPreview(plans, validation, 3, 5);
		expect(preview.safeParallelism).toBeLessThan(3);
	});
});
