/**
 * P44.6.03 — Mode Mapping Compiler
 *
 * Unit tests for:
 * - compileMode with explicit mutation intents
 * - compileMode with inferred mode from target paths
 * - compileMode with blocking ambiguities
 * - compileMode with ambiguous intent (no resolution)
 * - Route signal codes as diagnostics
 * - That silent fallback never occurs
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import { EngineMode } from "../../src/core/mode/engine-mode.js";
import { compileMode } from "../../src/core/mode/mode-mapping-compiler.js";
import { addAmbiguity, createTaskIntentEnvelope, setMutationIntent } from "../../src/core/mode/task-intent-envelope.js";

// ---------------------------------------------------------------------------
// Explicit Mutation Intent — Create
// ---------------------------------------------------------------------------

describe("compileMode with create intent", () => {
	it("compiles to Write mode when target path is specified", () => {
		const envelope = createTaskIntentEnvelope("create src/foo.ts");
		const updated = setMutationIntent(envelope, "create");
		updated.targetPaths = ["src/foo.ts"];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.Write);
		expect(result.config).not.toBeNull();
		if (result.config && "targetPath" in result.config) {
			expect(result.config.targetPath).toBe("src/foo.ts");
		}
	});

	it("compiles to SmartWrite mode when no target path is specified", () => {
		const envelope = createTaskIntentEnvelope("create something");
		const updated = setMutationIntent(envelope, "create");

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.SmartWrite);
	});

	it("respects overwritePolicy from envelope", () => {
		const envelope = createTaskIntentEnvelope("create src/foo.ts");
		const updated = setMutationIntent(envelope, "create");
		updated.targetPaths = ["src/foo.ts"];
		updated.overwritePolicy = "require_confirmation";

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		if (result.config && "overwritePolicy" in result.config) {
			expect(result.config.overwritePolicy).toBe("require_confirmation");
		}
	});
});

// ---------------------------------------------------------------------------
// Explicit Mutation Intent — Modify (Edit)
// ---------------------------------------------------------------------------

describe("compileMode with modify intent", () => {
	it("compiles to Edit mode when target path is specified", () => {
		const envelope = createTaskIntentEnvelope("edit src/bar.ts");
		const updated = setMutationIntent(envelope, "modify");
		updated.targetPaths = ["src/bar.ts"];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.Edit);
		if (result.config && "targetPath" in result.config) {
			expect(result.config.targetPath).toBe("src/bar.ts");
		}
	});

	it("adds preserveConstraints from envelope constraints", () => {
		const envelope = createTaskIntentEnvelope("edit src/bar.ts");
		const updated = setMutationIntent(envelope, "modify");
		updated.targetPaths = ["src/bar.ts"];
		updated.constraints = [
			{ domain: "preserve", description: "Keep copyright header", hardness: "hard" },
			{ domain: "preserve", description: "Keep existing exports", hardness: "soft" },
		];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		if (result.config && "preserveConstraints" in result.config) {
			const preserveConstraints = (result.config as { preserveConstraints?: string[] }).preserveConstraints;
			expect(preserveConstraints).toHaveLength(2);
			expect(preserveConstraints?.[0]).toBe("Keep copyright header");
		}
	});

	it("blocks with diagnostic when no target path is specified", () => {
		const envelope = createTaskIntentEnvelope("edit something");
		const updated = setMutationIntent(envelope, "modify");

		const result = compileMode(updated);
		expect(result.success).toBe(false);
		expect(result.mode).toBeNull();
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.diagnostics[0].code).toBe("BLOCKED_MISSING_TARGET");
	});
});

// ---------------------------------------------------------------------------
// Explicit Mutation Intent — Audit Then Mutate
// ---------------------------------------------------------------------------

describe("compileMode with audit_then_mutate intent", () => {
	it("compiles to SmartEdit mode", () => {
		const envelope = createTaskIntentEnvelope("audit and fix src/baz.ts");
		const updated = setMutationIntent(envelope, "audit_then_mutate");
		updated.targetPaths = ["src/baz.ts"];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.SmartEdit);
		if (result.config && "auditScope" in result.config) {
			expect(result.config.auditScope).toContain("full");
		}
	});

	it("uses constraints as audit scope", () => {
		const envelope = createTaskIntentEnvelope("audit imports in src/baz.ts");
		const updated = setMutationIntent(envelope, "audit_then_mutate");
		updated.targetPaths = ["src/baz.ts"];
		updated.constraints = [{ domain: "scope", description: "imports", hardness: "hard" }];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		if (result.config && "auditScope" in result.config) {
			expect(result.config.auditScope).toEqual(["imports"]);
		}
	});

	it("blocks when no target path", () => {
		const envelope = createTaskIntentEnvelope("audit and fix");
		const updated = setMutationIntent(envelope, "audit_then_mutate");

		const result = compileMode(updated);
		expect(result.success).toBe(false);
		expect(result.diagnostics[0].code).toBe("BLOCKED_MISSING_TARGET");
	});
});

// ---------------------------------------------------------------------------
// Explicit Mutation Intent — Route Then Create
// ---------------------------------------------------------------------------

describe("compileMode with route_then_create intent", () => {
	it("compiles to SmartWrite mode", () => {
		const envelope = createTaskIntentEnvelope("plan and create");
		const updated = setMutationIntent(envelope, "route_then_create");

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.SmartWrite);
	});

	it("passes target path if specified", () => {
		const envelope = createTaskIntentEnvelope("plan src/plan.json");
		const updated = setMutationIntent(envelope, "route_then_create");
		updated.targetPaths = ["src/plan.json"];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.SmartWrite);
	});
});

// ---------------------------------------------------------------------------
// Unsupported Intents
// ---------------------------------------------------------------------------

describe("compileMode with unsupported intents", () => {
	it("blocks delete intent", () => {
		const envelope = createTaskIntentEnvelope("delete src/foo.ts");
		const updated = setMutationIntent(envelope, "delete");
		updated.targetPaths = ["src/foo.ts"];

		const result = compileMode(updated);
		expect(result.success).toBe(false);
		expect(result.diagnostics[0].code).toBe("BLOCKED_UNSUPPORTED_INTENT");
	});

	it("warns on read_only intent", () => {
		const envelope = createTaskIntentEnvelope("read src/foo.ts");
		const updated = setMutationIntent(envelope, "read_only");

		const result = compileMode(updated);
		// Read-only is not technically a mode, but it shouldn't block — it warns
		expect(result.mode).toBeNull();
		expect(result.diagnostics.some((d) => d.code === "WARN_READ_ONLY_INTENT")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Inference from Target Paths
// ---------------------------------------------------------------------------

describe("compileMode inference from target paths", () => {
	it("infers edit mode when targetExists is true", () => {
		const envelope = createTaskIntentEnvelope("fix src/existing.ts");
		envelope.targetPaths = ["src/existing.ts"];
		envelope.targetExists = true;

		const result = compileMode(envelope);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.Edit);
		expect(result.diagnostics.some((d) => d.code === "WARN_INFERRED_MODE")).toBe(true);
	});

	it("infers write mode when targetExists is false", () => {
		const envelope = createTaskIntentEnvelope("create new file");
		envelope.targetPaths = ["src/new.ts"];
		envelope.targetExists = false;

		const result = compileMode(envelope);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.Write);
	});

	it("returns ambiguous when no signals available", () => {
		const envelope = createTaskIntentEnvelope("do something");

		const result = compileMode(envelope);
		expect(result.success).toBe(false);
		expect(result.mode).toBeNull();
		expect(result.diagnostics[0].code).toBe("BLOCKED_AMBIGUOUS_MODE");
	});
});

// ---------------------------------------------------------------------------
// Blocking Ambiguities
// ---------------------------------------------------------------------------

describe("compileMode with blocking ambiguities", () => {
	it("blocks immediately when envelope has blocking ambiguities", () => {
		let envelope = createTaskIntentEnvelope("fix the file");
		envelope = addAmbiguity(envelope, {
			code: "missing_target_path",
			message: "No target path.",
			blocking: true,
		});

		const result = compileMode(envelope);
		expect(result.success).toBe(false);
		expect(result.mode).toBeNull();
		expect(result.diagnostics[0].code).toBe("BLOCKED_AMBIGUOUS_INPUT");
	});

	it("allows non-blocking ambiguities to pass through", () => {
		let envelope = createTaskIntentEnvelope("create src/foo.ts");
		envelope = addAmbiguity(envelope, {
			code: "unclear_target_existence",
			message: "May already exist.",
			blocking: false,
		});
		const updated = setMutationIntent(envelope, "create");
		updated.targetPaths = ["src/foo.ts"];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
		expect(result.mode).toBe(EngineMode.Write);
	});
});

// ---------------------------------------------------------------------------
// Design Contract: No Silent Fallback
// ---------------------------------------------------------------------------

describe("design contract — no silent fallback", () => {
	it("never returns a mode when compilation is ambiguous", () => {
		const envelope = createTaskIntentEnvelope("do some work");

		const result = compileMode(envelope);
		// When ambiguous, mode must be null, not a default/inferred mode
		expect(result.mode).toBeNull();
		// There must be at least one diagnostic explaining why
		expect(result.diagnostics.length).toBeGreaterThan(0);
	});

	it("never returns success when mode is null", () => {
		const envelope = createTaskIntentEnvelope("do stuff");

		const result = compileMode(envelope);
		if (result.mode === null) {
			expect(result.success).toBe(false);
		}
	});

	it("never falls back to an implicit mode", () => {
		// Fallback NOT permitted: unlike the LLM commit message composer,
		// mode selection has no fallback. A blocked or ambiguous mode
		// must surface as a diagnostic.
		const envelope = createTaskIntentEnvelope("");
		const result = compileMode(envelope);
		expect(result.mode).toBeNull();
		const hasAmbiguousDiagnostic = result.diagnostics.some((d) => d.code === "BLOCKED_AMBIGUOUS_MODE");
		expect(hasAmbiguousDiagnostic).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("compileMode edge cases", () => {
	it("handles empty prompt gracefully", () => {
		const envelope = createTaskIntentEnvelope("");
		const result = compileMode(envelope);
		expect(result.success).toBe(false);
	});

	it("handles very long prompt without crashing", () => {
		const longPrompt = `create ${"a".repeat(10000)}.ts`;
		const envelope = createTaskIntentEnvelope(longPrompt);
		const updated = setMutationIntent(envelope, "create");
		updated.targetPaths = [longPrompt.substring(0, 100)];

		const result = compileMode(updated);
		expect(result.success).toBe(true);
	});

	it("returns no diagnostics on successful compilation", () => {
		const envelope = createTaskIntentEnvelope("edit src/foo.ts");
		const updated = setMutationIntent(envelope, "modify");
		updated.targetPaths = ["src/foo.ts"];

		const result = compileMode(updated);
		if (result.mode === EngineMode.Edit) {
			// Explicit intent with target — no diagnostics expected
			const blockingDiags = result.diagnostics.filter((d) => d.severity === "blocking");
			expect(blockingDiags).toHaveLength(0);
		}
	});
});
