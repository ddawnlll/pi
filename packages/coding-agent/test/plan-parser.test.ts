/**
 * Tests for Plan Parser + JSON Queue - P2 Workstream 7.A
 */

import { describe, expect, it } from "vitest";
import { formatParseResult, parsePlan } from "../src/core/plan-parser.js";

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
