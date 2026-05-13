/**
 * Tests for Plan Parser + JSON Queue - P2 Workstream 7.A
 */

import { describe, expect, it } from "vitest";
import {
	findMissingWorkspaceLabels,
	formatParseResult,
	parsePlan,
	scanMarkdownWorkstreamHeadings,
} from "../src/core/plan-parser.js";

describe("parsePlan", () => {
	it("should parse valid Part 3 JSON queue", () => {
		const planContent = `
# Phase P2 — Test Phase

## Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task A",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3
    },
    {
      "id": "7.B",
      "title": "Task B",
      "dependencies": ["7.A"],
      "roleBudget": "worker",
      "maxRetries": 3
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();
		expect(result.queue?.phase).toBe("P2");
		expect(result.queue?.workspaces).toHaveLength(2);
		expect(result.errors).toHaveLength(0);
	});

	it("should detect unresolved placeholders", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "{{ PROJECT_NAME }}",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task {{ TASK_ID }}",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(false);
		expect(result.unresolvedPlaceholders).toContain("PROJECT_NAME");
		expect(result.unresolvedPlaceholders).toContain("TASK_ID");
	});

	it("should allow placeholders when option is set", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "{{ PROJECT_NAME }}",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task A",
      "dependencies": [],
      "roleBudget": "worker",
      "maxRetries": 3
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent, { allowPlaceholders: true });
		expect(result.success).toBe(true);
		expect(result.unresolvedPlaceholders).toContain("PROJECT_NAME");
	});

	it("should fallback to Markdown heading parser", () => {
		const planContent = `
# Phase P2 — Test Phase
Title: Test Phase

## 7. Workstreams

### 7.A — Task A

Goal: Do something

Dependencies: None

Role: worker

### 7.B — Task B

Goal: Do something else

Dependencies: 7.A

Role: worker
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();
		expect(result.queue?.workspaces).toHaveLength(2);
		expect(result.warnings.some((w) => w.includes("Markdown heading fallback"))).toBe(true);
	});

	it("should parse Markdown dependencies correctly", () => {
		const planContent = `
# Phase P2 — Test Phase

## 7. Workstreams

### 7.A — Task A

Dependencies: None

### 7.B — Task B

Dependencies: 7.A

### 7.C — Task C

Dependencies: 7.A, 7.B
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[0].dependencies).toEqual([]);
		expect(result.queue?.workspaces[1].dependencies).toEqual(["7.A"]);
		expect(result.queue?.workspaces[2].dependencies).toEqual(expect.arrayContaining(["7.A", "7.B"]));
	});

	it("should fail when JSON is malformed", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test",
  "workspaces": [
    { invalid json }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("Failed to parse JSON"))).toBe(true);
	});

	it("should fail when no JSON and Markdown fallback disabled", () => {
		const planContent = `
# Phase P2 — Test Phase

Some content without JSON queue.
`;

		const result = parsePlan(planContent, { markdownFallback: false });
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("JSON queue not found"))).toBe(true);
	});

	it("should validate queue after parsing", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task A",
      "dependencies": ["7.Z"],
      "roleBudget": "worker",
      "maxRetries": 3
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("non-existent workspace"))).toBe(true);
	});

	it("should skip validation when option is set", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task A",
      "dependencies": ["7.Z"],
      "roleBudget": "worker",
      "maxRetries": 3
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent, { validate: false });
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();
	});

	it("should normalize queue with defaults", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "workspaces": [
    {
      "id": "7.A",
      "title": "Task A"
    }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.title).toBe("Untitled Phase");
		expect(result.queue?.maxParallelWorkspaces).toBe(3);
		expect(result.queue?.workspaces[0].dependencies).toEqual([]);
		expect(result.queue?.workspaces[0].roleBudget).toBe("worker");
		expect(result.queue?.workspaces[0].maxRetries).toBe(3);
	});

	it("should normalize missing optional array fields to prevent undefined.join() errors", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
	 "phase": "P2",
	 "title": "Test Phase",
	 "maxParallelWorkspaces": 2,
	 "workspaces": [
	   {
	     "id": "7.A",
	     "title": "Task A",
	     "dependencies": [],
	     "roleBudget": "worker",
	     "maxRetries": 3,
	     "capabilities": {
	       "canEdit": ["docs/dogfood-output.md"],
	       "canRead": ["docs/**/*.md"],
	       "canRun": ["echo"]
	     },
	     "acceptanceCriteria": [
	       "docs/dogfood-output.md created",
	       "Contains header and introduction"
	     ]
	   }
	 ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue).toBeDefined();

		const workspace = result.queue!.workspaces[0];

		// Verify all array fields are normalized
		expect(Array.isArray(workspace.dependencies)).toBe(true);
		expect(workspace.dependencies).toEqual([]);

		// Verify capabilities arrays are normalized
		expect(workspace.capabilities).toBeDefined();
		expect(Array.isArray(workspace.capabilities!.canEdit)).toBe(true);
		expect(workspace.capabilities!.canEdit).toEqual(["docs/dogfood-output.md"]);
		expect(Array.isArray(workspace.capabilities!.cannotEdit)).toBe(true);
		expect(workspace.capabilities!.cannotEdit).toEqual([]);
		expect(Array.isArray(workspace.capabilities!.canRun)).toBe(true);
		expect(workspace.capabilities!.canRun).toEqual(["echo"]);
		expect(Array.isArray(workspace.capabilities!.cannotRun)).toBe(true);
		expect(workspace.capabilities!.cannotRun).toEqual([]);

		// Verify acceptanceCriteria is normalized
		expect(Array.isArray(workspace.acceptanceCriteria)).toBe(true);
		expect(workspace.acceptanceCriteria).toHaveLength(2);
	});

	it("should handle completely missing capabilities and acceptanceCriteria", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
	 "phase": "P2",
	 "title": "Test Phase",
	 "workspaces": [
	   {
	     "id": "7.A",
	     "title": "Task A"
	   }
	 ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);

		const workspace = result.queue!.workspaces[0];

		// Verify optional fields are undefined when not provided
		expect(workspace.capabilities).toBeUndefined();
		expect(workspace.acceptanceCriteria).toBeUndefined();

		// Verify required array fields are still normalized
		expect(Array.isArray(workspace.dependencies)).toBe(true);
		expect(workspace.dependencies).toEqual([]);
	});
});

describe("formatParseResult", () => {
	it("should format successful result", () => {
		const result = {
			success: true,
			queue: {
				phase: "P2",
				title: "Test Phase",
				maxParallelWorkspaces: 3,
				workspaces: [
					{
						id: "7.A",
						title: "Task A",
						dependencies: [],
						roleBudget: "worker" as const,
						maxRetries: 3,
					},
				],
			},
			errors: [],
			warnings: [],
			unresolvedPlaceholders: [],
			parsedSource: "part3_json" as const,
			markdownWorkstreamCount: null,
			missingWorkspaceLabels: [],
		};

		const formatted = formatParseResult(result);
		expect(formatted).toContain("✓ Plan parsed successfully");
		expect(formatted).toContain("Phase: P2");
		expect(formatted).toContain("Workspaces: 1");
	});

	it("should format failed result with errors", () => {
		const result = {
			success: false,
			errors: ["Error 1", "Error 2"],
			warnings: ["Warning 1"],
			unresolvedPlaceholders: ["PLACEHOLDER"],
			parsedSource: "markdown_fallback" as const,
			markdownWorkstreamCount: null,
			missingWorkspaceLabels: [],
		};

		const formatted = formatParseResult(result);
		expect(formatted).toContain("✗ Plan parsing failed");
		expect(formatted).toContain("Errors:");
		expect(formatted).toContain("Error 1");
		expect(formatted).toContain("Warnings:");
		expect(formatted).toContain("Warning 1");
		expect(formatted).toContain("Unresolved Placeholders:");
		expect(formatted).toContain("{{ PLACEHOLDER }}");
	});
});

// ===========================================================================
// P4.6.2 Tests — Plan Parser Metadata & Workspace Count Consistency
// ===========================================================================

describe("P4.6.2: parsedSource tracking", () => {
	it("reports parsedSource as part3_json when Part 3 JSON is valid", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;
		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.parsedSource).toBe("part3_json");
	});

	it("reports parsedSource as markdown_fallback when no Part 3 JSON", () => {
		const planContent = `
# Phase P2 — Test Phase
Title: Test Phase

## 7. Workstreams

### 7.A — Task A

Dependencies: None

Role: worker
`;
		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.parsedSource).toBe("markdown_fallback");
	});
});

describe("P4.6.2: metadata from Part 3 JSON overrides defaults", () => {
	const phase19Plan = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.B", "title": "Task B", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.C", "title": "Task C", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

	it("uses phase from Part 3 JSON (e.g., '19') instead of default 'P2'", () => {
		const result = parsePlan(phase19Plan);
		expect(result.success).toBe(true);
		expect(result.queue?.phase).toBe("19");
		expect(result.queue?.phase).not.toBe("P2");
	});

	it("uses title from Part 3 JSON instead of 'Untitled Phase'", () => {
		const result = parsePlan(phase19Plan);
		expect(result.success).toBe(true);
		expect(result.queue?.title).toBe("V6.2 Mode-Routed Scalp Expansion");
		expect(result.queue?.title).not.toBe("Untitled Phase");
	});

	it("uses maxParallelWorkspaces from Part 3 JSON", () => {
		const result = parsePlan(phase19Plan);
		expect(result.success).toBe(true);
		expect(result.queue?.maxParallelWorkspaces).toBe(3);
	});

	it("uses workspace count from Part 3 JSON workspaces.length", () => {
		const result = parsePlan(phase19Plan);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces.length).toBe(3);
	});

	it("parsedSource is part3_json for this plan", () => {
		const result = parsePlan(phase19Plan);
		expect(result.parsedSource).toBe("part3_json");
	});

	it("formatParseResult shows phase 19, not P2", () => {
		const result = parsePlan(phase19Plan);
		const formatted = formatParseResult(result);
		expect(formatted).toContain("Phase: 19");
		expect(formatted).not.toContain("Phase: P2");
		expect(formatted).toContain("V6.2 Mode-Routed Scalp Expansion");
		expect(formatted).not.toContain("Untitled Phase");
	});
});

describe("P4.6.2: missing Part 3 still uses markdown fallback", () => {
	it("falls back to markdown when Part 3 JSON is absent", () => {
		const planContent = `
# Phase P2 — Test Phase
Title: Fallback Title

## 7. Workstreams

### 7.A — Task A

Dependencies: None

Role: worker
`;
		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.parsedSource).toBe("markdown_fallback");
		expect(result.warnings.some((w) => w.includes("Markdown heading fallback"))).toBe(true);
	});
});

describe("P4.6.2: invalid Part 3 falls back or fails", () => {
	it("malformed JSON in Part 3 produces error", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{ invalid json }
\`\`\`
`;
		const result = parsePlan(planContent, { markdownFallback: false });
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("Failed to parse JSON"))).toBe(true);
	});

	it("malformed JSON with markdown fallback still works", () => {
		const planContent = `
# Phase P2 — Test Phase
Title: Fallback Title

## 7. Workstreams

### 7.A — Task A

Dependencies: None

Role: worker

# Part 3 — Workspace Queue

\`\`\`json
{ invalid json }
\`\`\`
`;
		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.parsedSource).toBe("markdown_fallback");
	});
});

describe("P4.6.2: workstream/workspace count consistency", () => {
	it("warns when markdown has 14 workstreams but JSON has 3 workspaces", () => {
		// Build a plan with 14 markdown workstreams A-N and 3 JSON workspaces
		const workstreamHeadings = Array.from(
			{ length: 14 },
			(_, i) => `### 7.${String.fromCharCode(65 + i)} — Workstream ${String.fromCharCode(65 + i)}`,
		).join("\n\nDependencies: None\n\nRole: worker\n\n");

		const planContent = `
## 7. Workstreams

${workstreamHeadings}

# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.B", "title": "Scale logic", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.C", "title": "Integration tests", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.markdownWorkstreamCount).toBe(14);
		expect(result.warnings.some((w) => w.includes("14 workstream") && w.includes("3 executable"))).toBe(true);
	});

	it("doctor remains SAFE/VALID when mismatch is warning only", () => {
		const workstreamHeadings = Array.from(
			{ length: 14 },
			(_, i) => `### 7.${String.fromCharCode(65 + i)} — Workstream ${String.fromCharCode(65 + i)}`,
		).join("\n\nDependencies: None\n\nRole: worker\n\n");

		const planContent = `
## 7. Workstreams

${workstreamHeadings}

# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.B", "title": "Scale logic", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.C", "title": "Integration tests", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		// Mismatch warning should NOT cause success to be false
		expect(result.success).toBe(true);
	});

	it("fails when failOnWorkspaceCountMismatch is true", () => {
		const workstreamHeadings = Array.from(
			{ length: 14 },
			(_, i) => `### 7.${String.fromCharCode(65 + i)} — Workstream ${String.fromCharCode(65 + i)}`,
		).join("\n\nDependencies: None\n\nRole: worker\n\n");

		const planContent = `
## 7. Workstreams

${workstreamHeadings}

# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent, { failOnWorkspaceCountMismatch: true });
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("14 workstream") && e.includes("1 executable"))).toBe(true);
	});

	it("no warning when counts match", () => {
		const planContent = `
## 7. Workstreams

### 7.A — Task A

Dependencies: None

Role: worker

### 7.B — Task B

Dependencies: 7.A

Role: worker

# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "7",
  "title": "Match Test",
  "maxParallelWorkspaces": 2,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "7.B", "title": "Task B", "dependencies": ["7.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.markdownWorkstreamCount).toBe(2);
		expect(result.warnings.some((w) => w.includes("workstream") && w.includes("executable"))).toBe(false);
	});
});

describe("P4.6.2: workspace ID mismatch warnings", () => {
	it("reports missing markdown workstream labels", () => {
		const workstreamHeadings = Array.from(
			{ length: 14 },
			(_, i) => `### 7.${String.fromCharCode(65 + i)} — Workstream ${String.fromCharCode(65 + i)}`,
		).join("\n\nDependencies: None\n\nRole: worker\n\n");

		const planContent = `
## 7. Workstreams

${workstreamHeadings}

# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "7.B", "title": "Scale logic", "dependencies": ["7.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "7.C", "title": "Integration tests", "dependencies": ["7.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.missingWorkspaceLabels.length).toBeGreaterThan(0);
		expect(result.missingWorkspaceLabels).toContain("D");
		expect(result.missingWorkspaceLabels).toContain("N");
		expect(result.warnings.some((w) => w.includes("without JSON workspace entry"))).toBe(true);
	});
});

describe("P4.6.2: scanMarkdownWorkstreamHeadings", () => {
	it("extracts workstream labels from ### X.Y[Z] headings", () => {
		const content = `
## 7. Workstreams

### 7.A — Auth Module

### 7.B — Data Layer

### 7.N — Final Review
`;
		const result = scanMarkdownWorkstreamHeadings(content);
		expect(result.count).toBe(3);
		expect(result.labels).toEqual(["A", "B", "N"]);
	});

	it("returns empty when no workstream headings exist", () => {
		const result = scanMarkdownWorkstreamHeadings("No headings here");
		expect(result.count).toBe(0);
		expect(result.labels).toEqual([]);
	});
});

describe("P4.6.2: findMissingWorkspaceLabels", () => {
	it("finds labels in markdown that have no JSON workspace", () => {
		const labels = ["A", "B", "C", "D", "E"];
		const ids = ["7.A", "7.B", "7.C"];
		const missing = findMissingWorkspaceLabels(labels, ids);
		expect(missing).toEqual(["D", "E"]);
	});

	it("returns empty when all labels have workspaces", () => {
		const labels = ["A", "B"];
		const ids = ["7.A", "7.B"];
		const missing = findMissingWorkspaceLabels(labels, ids);
		expect(missing).toEqual([]);
	});
});

describe("P4.6.2: dashboard validation payload includes parsedSource and mismatch metadata", () => {
	it("ParseResult includes parsedSource, markdownWorkstreamCount, and missingWorkspaceLabels", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.B", "title": "Scale logic", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.C", "title": "Integration tests", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;
		const result = parsePlan(planContent);
		expect(result.parsedSource).toBe("part3_json");
		expect(result).toHaveProperty("markdownWorkstreamCount");
		expect(result).toHaveProperty("missingWorkspaceLabels");
	});
});

describe("P4.6.2: plan run/start log uses phase/title from Part 3 JSON", () => {
	it("formatParseResult shows Phase: 19 and title from JSON, not defaults", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "19",
  "title": "V6.2 Mode-Routed Scalp Expansion",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "19.A", "title": "Create routes", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.B", "title": "Scale logic", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "19.C", "title": "Integration tests", "dependencies": ["19.A"], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;
		const result = parsePlan(planContent);
		const formatted = formatParseResult(result);
		expect(formatted).toContain("Phase: 19");
		expect(formatted).not.toContain("Phase: P2");
		expect(formatted).toContain("V6.2 Mode-Routed Scalp Expansion");
		expect(formatted).not.toContain("Untitled Phase");
	});
});

// ===========================================================================
// v2.2.0 Tests — Contract Schema Parallelism Fields in Plan Parser
// ===========================================================================

describe("v2.2.0: contract version parsing", () => {
	it("should parse contractVersion from Part 3 JSON", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.contractVersion).toBe("2.2.0");
	});

	it("should reject unsupported contract version", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "99.0.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.includes("not supported"))).toBe(true);
	});

	it("should accept v2.1.0 contract version", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.1.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.contractVersion).toBe("2.1.0");
	});

	it("should default to undefined contractVersion when not specified", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.contractVersion).toBeUndefined();
	});
});

describe("v2.2.0: planExecution.interactiveParallelismReview parsing", () => {
	it("should parse planExecution.interactiveParallelismReview true", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "planExecution": {
    "interactiveParallelismReview": true
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.planExecution?.interactiveParallelismReview).toBe(true);
	});

	it("should parse planExecution.interactiveParallelismReview false", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "planExecution": {
    "interactiveParallelismReview": false
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.planExecution?.interactiveParallelismReview).toBe(false);
	});

	it("should parse planExecution without interactiveParallelismReview", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "planExecution": {},
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.planExecution?.interactiveParallelismReview).toBeUndefined();
	});

	it("should not break v2.1.0 plans without planExecution", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.1.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.planExecution).toBeUndefined();
	});
});

describe("v2.2.0: parallelismReview parsing", () => {
	it("should parse parallelismReview with all fields", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "parallelismReview": {
    "enabled": true,
    "threshold": 4,
    "description": "Review above 4 parallel workspaces",
    "metadata": { "reviewer": "team-lead" }
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.parallelismReview?.enabled).toBe(true);
		expect(result.queue?.parallelismReview?.threshold).toBe(4);
		expect(result.queue?.parallelismReview?.description).toBe("Review above 4 parallel workspaces");
		expect(result.queue?.parallelismReview?.metadata).toEqual({ reviewer: "team-lead" });
	});

	it("should parse parallelismReview with minimal fields", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "parallelismReview": {
    "enabled": false
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.parallelismReview?.enabled).toBe(false);
		expect(result.queue?.parallelismReview?.threshold).toBeUndefined();
		expect(result.queue?.parallelismReview?.description).toBeUndefined();
	});

	it("should parse parallelismReview with threshold null", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "parallelismReview": {
    "enabled": true,
    "threshold": null
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.parallelismReview?.threshold).toBeNull();
	});

	it("should not break v2.1.0 plans without parallelismReview", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.1.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.parallelismReview).toBeUndefined();
	});

	it("should ignore parallelismReview when enabled is not boolean", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "parallelismReview": {
    "enabled": "yes"
  },
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		// Should not crash — parallelismReview is ignored when invalid shape
		expect(result.success).toBe(true);
		expect(result.queue?.parallelismReview).toBeUndefined();
	});
});

describe("v2.2.0: workspace parallelGroup and dependencyReason parsing", () => {
	it("should parse workspace parallelGroup", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3, "parallelGroup": "backend" },
    { "id": "7.B", "title": "Task B", "dependencies": [], "roleBudget": "worker", "maxRetries": 3, "parallelGroup": "backend" },
    { "id": "7.C", "title": "Task C", "dependencies": [], "roleBudget": "worker", "maxRetries": 3, "parallelGroup": "frontend" }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[0].parallelGroup).toBe("backend");
		expect(result.queue?.workspaces[1].parallelGroup).toBe("backend");
		expect(result.queue?.workspaces[2].parallelGroup).toBe("frontend");
	});

	it("should parse workspace dependencyReason", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 },
    { "id": "7.B", "title": "Task B", "dependencies": ["7.A"], "roleBudget": "worker", "maxRetries": 3, "dependencyReason": { "7.A": "Auth setup required" } }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[1].dependencyReason).toEqual({ "7.A": "Auth setup required" });
	});

	it("should not break v2.1.0 plans without parallelGroup or dependencyReason", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.1.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[0].parallelGroup).toBeUndefined();
		expect(result.queue?.workspaces[0].dependencyReason).toBeUndefined();
	});

	it("should ignore non-string parallelGroup", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3, "parallelGroup": 42 }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[0].parallelGroup).toBeUndefined();
	});

	it("should ignore non-object dependencyReason", () => {
		const planContent = `
# Part 3 — Workspace Queue

\`\`\`json
{
  "contractVersion": "2.2.0",
  "phase": "P2",
  "title": "Test Phase",
  "maxParallelWorkspaces": 3,
  "workspaces": [
    { "id": "7.A", "title": "Task A", "dependencies": [], "roleBudget": "worker", "maxRetries": 3, "dependencyReason": "wrong type" }
  ]
}
\`\`\`
`;

		const result = parsePlan(planContent);
		expect(result.success).toBe(true);
		expect(result.queue?.workspaces[0].dependencyReason).toBeUndefined();
	});
});
