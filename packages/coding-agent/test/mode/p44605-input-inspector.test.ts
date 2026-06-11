/**
 * P44.6.05 — Input Inspector for Write/Edit Intent
 *
 * Unit tests for:
 * - Classifying prompts into creation, mutation, audit-then-mutate, route-then-create
 * - Extracting target paths from prompts
 * - Detecting ambiguity signals
 * - Producing correct TaskIntentEnvelope
 * - Deterministic classification (no LLM involvement)
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import { inspectPrompt } from "../../src/core/mode/input-inspector.js";

// ---------------------------------------------------------------------------
// Create/Write Intent
// ---------------------------------------------------------------------------

describe("inspectPrompt — create/write intent", () => {
	it("classifies 'create a file' as create", () => {
		const result = inspectPrompt("create a file called src/components/Button.tsx");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("create");
	});

	it("classifies 'generate component' as create", () => {
		const result = inspectPrompt("generate a new React component for the user profile");
		// Intent is correctly classified but blocks due to missing target path
		expect(result.envelope.mutationIntent).toBe("create");
		expect(result.success).toBe(false);
	});

	it("classifies 'add a route' as create", () => {
		const result = inspectPrompt("add a new API route for user login");
		expect(result.envelope.mutationIntent).toBe("create");
		expect(result.success).toBe(false);
	});

	it("classifies 'write a test' as create", () => {
		const result = inspectPrompt("write a test for the auth service");
		expect(result.envelope.mutationIntent).toBe("create");
		expect(result.success).toBe(false);
	});

	it("extracts target path from create prompt", () => {
		const result = inspectPrompt("create src/services/auth.ts with login and register functions");
		expect(result.envelope.targetPaths).toContain("src/services/auth.ts");
	});
});

// ---------------------------------------------------------------------------
// Edit/Modify Intent
// ---------------------------------------------------------------------------

describe("inspectPrompt — edit/modify intent", () => {
	it("classifies 'edit the file' as modify", () => {
		const result = inspectPrompt("edit src/components/Button.tsx to fix the styling");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("modify");
	});

	it("classifies 'fix the bug' as modify", () => {
		const result = inspectPrompt("fix the bug in src/utils/format.ts");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("modify");
	});

	it("classifies 'refactor component' as modify", () => {
		const result = inspectPrompt("refactor the UserProfile component");
		// Intent is correctly classified but blocks due to missing target path
		expect(result.envelope.mutationIntent).toBe("modify");
		expect(result.success).toBe(false);
	});

	it("classifies 'update the function' as modify", () => {
		const result = inspectPrompt("update the validateEmail function in src/utils/validation.ts");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("modify");
	});

	it("extracts target path from edit prompt", () => {
		const result = inspectPrompt("fix the bug in src/utils/format.ts");
		expect(result.envelope.targetPaths).toContain("src/utils/format.ts");
	});
});

// ---------------------------------------------------------------------------
// Audit-then-Mutate (Smart Edit) Intent
// ---------------------------------------------------------------------------

describe("inspectPrompt — audit-then-mutate intent", () => {
	it("classifies 'audit and fix' as audit_then_mutate", () => {
		const result = inspectPrompt("audit and fix the security issues in src/auth.ts");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("audit_then_mutate");
	});

	it("classifies 'inspect and repair' as audit_then_mutate", () => {
		const result = inspectPrompt("inspect and repair the error handling in src/api.ts");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("audit_then_mutate");
	});

	it("classifies 'smart edit' as audit_then_mutate", () => {
		const result = inspectPrompt("smart edit src/components/Table.tsx");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("audit_then_mutate");
	});
});

// ---------------------------------------------------------------------------
// Route-then-Create (Smart Write) Intent
// ---------------------------------------------------------------------------

describe("inspectPrompt — route-then-create intent", () => {
	it("classifies 'plan and create' as route_then_create", () => {
		const result = inspectPrompt("plan and create a new authentication system");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("route_then_create");
	});

	it("classifies 'design and implement' as route_then_create", () => {
		const result = inspectPrompt("design and implement a new API for user management");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("route_then_create");
	});

	it("classifies 'smart write' as route_then_create", () => {
		const result = inspectPrompt("smart write a new data access layer");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("route_then_create");
	});

	it("classifies 'generate a plan for' as route_then_create", () => {
		const result = inspectPrompt("generate a plan for the new dashboard module");
		expect(result.success).toBe(true);
		expect(result.envelope.mutationIntent).toBe("route_then_create");
	});
});

// ---------------------------------------------------------------------------
// Ambiguity Detection
// ---------------------------------------------------------------------------

describe("inspectPrompt — ambiguity detection", () => {
	it("detects missing target path for edit intent", () => {
		const result = inspectPrompt("edit the file");
		expect(result.success).toBe(false);
		expect(result.envelope.ambiguities.length).toBeGreaterThan(0);
		const hasMissingPath = result.envelope.ambiguities.some((a) => a.code === "missing_target_path");
		expect(hasMissingPath).toBe(true);
	});

	it("detects unclear mutation intent", () => {
		const result = inspectPrompt("do something with the codebase");
		expect(result.success).toBe(false);
		expect(result.envelope.ambiguities.length).toBeGreaterThan(0);
		const hasUnclearIntent = result.envelope.ambiguities.some((a) => a.code === "unclear_mutation_intent");
		expect(hasUnclearIntent).toBe(true);
	});

	it("detects ambiguous phrasing", () => {
		const result = inspectPrompt("maybe create or edit the file src/foo.ts");
		expect(result.envelope.ambiguities.length).toBeGreaterThan(0);
	});

	it("detects overwrite mention without explicit policy", () => {
		const result = inspectPrompt("overwrite the existing config in src/config.ts");
		// Should have an overwrite policy ambiguity
		const hasOverwriteAmbiguity = result.envelope.ambiguities.some((a) => a.code === "unclear_overwrite_policy");
		expect(hasOverwriteAmbiguity).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Path Extraction
// ---------------------------------------------------------------------------

describe("inspectPrompt — path extraction", () => {
	it("extracts src/ paths", () => {
		const result = inspectPrompt("edit src/components/Header.tsx");
		expect(result.envelope.targetPaths).toContain("src/components/Header.tsx");
	});

	it("extracts packages/ paths", () => {
		const result = inspectPrompt("fix packages/core/src/index.ts");
		expect(result.envelope.targetPaths).toContain("packages/core/src/index.ts");
	});

	it("extracts .ts and .tsx file references", () => {
		const result = inspectPrompt("create src/utils/helpers.ts and src/utils/types.ts");
		expect(result.envelope.targetPaths).toContain("src/utils/helpers.ts");
		expect(result.envelope.targetPaths).toContain("src/utils/types.ts");
	});

	it("extracts .json file references", () => {
		const result = inspectPrompt("update package.json");
		expect(result.envelope.targetPaths).toContain("package.json");
	});
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe("inspectPrompt — diagnostics", () => {
	it("returns blocking diagnostic for ambiguous prompts", () => {
		const result = inspectPrompt("do something");
		expect(result.diagnostics.length).toBeGreaterThan(0);
		const hasBlocking = result.diagnostics.some((d) => d.severity === "blocking");
		expect(hasBlocking).toBe(true);
	});

	it("returns no diagnostics for clear prompts", () => {
		const result = inspectPrompt("create src/new-file.ts with a simple hello world function");
		const blockingDiags = result.diagnostics.filter((d) => d.severity === "blocking");
		expect(blockingDiags).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Design Contract
// ---------------------------------------------------------------------------

describe("design contract — deterministic classification", () => {
	it("same prompt always produces same classification", () => {
		const prompt = "create src/components/Button.tsx with primary and secondary variants";
		const result1 = inspectPrompt(prompt);
		const result2 = inspectPrompt(prompt);

		expect(result1.envelope.mutationIntent).toBe(result2.envelope.mutationIntent);
		expect(result1.success).toBe(result2.success);
		expect(result1.envelope.targetPaths).toEqual(result2.envelope.targetPaths);
	});

	it("does not use LLM for classification — fully pattern-based", () => {
		// There are no async operations, no API calls, no model references
		// in the inspection result. This is verified by the type system
		// (synchronous function) and the test structure (no mocks needed).
		const result = inspectPrompt("create src/test.ts");
		expect(result.envelope.correlationId).toBeUndefined();
		expect(result.envelope.metadata).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("inspectPrompt — edge cases", () => {
	it("handles empty prompt", () => {
		const result = inspectPrompt("");
		expect(result.success).toBe(false);
	});

	it("handles very short prompt", () => {
		const result = inspectPrompt("hi");
		expect(result.success).toBe(false);
	});

	it("handles prompt with only file path", () => {
		const result = inspectPrompt("src/foo.ts");
		// Just a file path — no intent keywords
		expect(result.envelope.mutationIntent).toBeNull();
		expect(result.envelope.targetPaths).toContain("src/foo.ts");
	});

	it("handles prompt with special characters", () => {
		const result = inspectPrompt("create src/file[1].ts with special chars! @#$%");
		expect(result.envelope.mutationIntent).toBe("create");
	});
});
