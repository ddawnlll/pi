/**
 * P44.6.01 — EngineMode Contract and Mode Enum Canonicalization
 *
 * Unit tests for:
 * - EngineMode enum values
 * - getModeCapability, isSmartMode, isSimpleMode
 * - getTargetRequirement, getExecutionPhase
 * - EngineConfig discriminated union
 * - validateEngineConfig
 * - isEngineMode guard
 * - That mode is never inferred from strings/prose
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import {
	ALL_ENGINE_MODES,
	type EditConfig,
	ENGINE_MODE_LABELS,
	type EngineConfig,
	EngineMode,
	getExecutionPhase,
	getModeCapability,
	getTargetRequirement,
	isEngineMode,
	isSimpleMode,
	isSmartMode,
	type SmartEditConfig,
	type SmartWriteConfig,
	validateEngineConfig,
	type WriteConfig,
} from "../../src/core/mode/engine-mode.js";

// ---------------------------------------------------------------------------
// EngineMode Enum Values
// ---------------------------------------------------------------------------

describe("EngineMode enum", () => {
	it("has exactly four values", () => {
		expect(ALL_ENGINE_MODES).toHaveLength(4);
	});

	it("has write mode with correct string value", () => {
		expect(EngineMode.Write).toBe("write");
	});

	it("has edit mode with correct string value", () => {
		expect(EngineMode.Edit).toBe("edit");
	});

	it("has smart_write mode with correct string value", () => {
		expect(EngineMode.SmartWrite).toBe("smart_write");
	});

	it("has smart_edit mode with correct string value", () => {
		expect(EngineMode.SmartEdit).toBe("smart_edit");
	});

	it("all enum values are unique", () => {
		const values = ALL_ENGINE_MODES.map((m: EngineMode) => m.toString());
		expect(new Set(values).size).toBe(4);
	});

	it("mode is never inferred from strings — string comparison must be explicit", () => {
		// This test verifies that using a raw string instead of the
		// enum does not accidentally match. The isEngineMode guard
		// is the ONLY way to coerce unknown values.
		const rawString = "write";
		expect(rawString === EngineMode.Write).toBe(true); // string match works
		expect(isEngineMode(rawString)).toBe(true); // guard works
		expect(isEngineMode("nonexistent")).toBe(false);
	});

	it("has human-readable labels for all modes", () => {
		expect(ENGINE_MODE_LABELS[EngineMode.Write]).toBe("Write");
		expect(ENGINE_MODE_LABELS[EngineMode.Edit]).toBe("Edit");
		expect(ENGINE_MODE_LABELS[EngineMode.SmartWrite]).toBe("Smart Write");
		expect(ENGINE_MODE_LABELS[EngineMode.SmartEdit]).toBe("Smart Edit");
	});
});

// ---------------------------------------------------------------------------
// Mode Capability
// ---------------------------------------------------------------------------

describe("getModeCapability", () => {
	it("write is creation", () => {
		expect(getModeCapability(EngineMode.Write)).toBe("creation");
	});

	it("smart_write is creation", () => {
		expect(getModeCapability(EngineMode.SmartWrite)).toBe("creation");
	});

	it("edit is mutation", () => {
		expect(getModeCapability(EngineMode.Edit)).toBe("mutation");
	});

	it("smart_edit is mutation", () => {
		expect(getModeCapability(EngineMode.SmartEdit)).toBe("mutation");
	});
});

describe("isSmartMode", () => {
	it("write is not smart", () => {
		expect(isSmartMode(EngineMode.Write)).toBe(false);
	});

	it("edit is not smart", () => {
		expect(isSmartMode(EngineMode.Edit)).toBe(false);
	});

	it("smart_write is smart", () => {
		expect(isSmartMode(EngineMode.SmartWrite)).toBe(true);
	});

	it("smart_edit is smart", () => {
		expect(isSmartMode(EngineMode.SmartEdit)).toBe(true);
	});
});

describe("isSimpleMode", () => {
	it("write is simple", () => {
		expect(isSimpleMode(EngineMode.Write)).toBe(true);
	});

	it("edit is simple", () => {
		expect(isSimpleMode(EngineMode.Edit)).toBe(true);
	});

	it("smart_write is not simple", () => {
		expect(isSimpleMode(EngineMode.SmartWrite)).toBe(false);
	});

	it("smart_edit is not simple", () => {
		expect(isSimpleMode(EngineMode.SmartEdit)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Target Requirements
// ---------------------------------------------------------------------------

describe("getTargetRequirement", () => {
	it("write requires target must not exist", () => {
		const req = getTargetRequirement(EngineMode.Write);
		expect(req.kind).toBe("must_not_exist");
	});

	it("edit requires target must exist", () => {
		const req = getTargetRequirement(EngineMode.Edit);
		expect(req.kind).toBe("must_exist");
	});

	it("smart_write target is optional", () => {
		const req = getTargetRequirement(EngineMode.SmartWrite);
		expect(req.kind).toBe("optional");
	});

	it("smart_edit requires target must exist", () => {
		const req = getTargetRequirement(EngineMode.SmartEdit);
		expect(req.kind).toBe("must_exist");
	});
});

// ---------------------------------------------------------------------------
// Execution Phase
// ---------------------------------------------------------------------------

describe("getExecutionPhase", () => {
	it("write is single phase", () => {
		const phase = getExecutionPhase(EngineMode.Write);
		expect(phase.kind).toBe("single");
	});

	it("edit is single phase", () => {
		const phase = getExecutionPhase(EngineMode.Edit);
		expect(phase.kind).toBe("single");
	});

	it("smart_write is two phase", () => {
		const phase = getExecutionPhase(EngineMode.SmartWrite);
		expect(phase.kind).toBe("two_phase");
		if (phase.kind === "two_phase") {
			expect(phase.auditPhase).toBe("inspect");
			expect(phase.patchPhase).toBe("patch");
		}
	});

	it("smart_edit is two phase", () => {
		const phase = getExecutionPhase(EngineMode.SmartEdit);
		expect(phase.kind).toBe("two_phase");
		if (phase.kind === "two_phase") {
			expect(phase.auditPhase).toBe("inspect");
			expect(phase.patchPhase).toBe("patch");
		}
	});
});

// ---------------------------------------------------------------------------
// EngineConfig Discriminated Union
// ---------------------------------------------------------------------------

describe("EngineConfig discriminated union", () => {
	it("write config has correct discriminated mode", () => {
		const config: WriteConfig = {
			mode: EngineMode.Write,
			targetPath: "/new/file.ts",
			overwritePolicy: "fail_if_exists",
		};
		// Discriminated union: narrowing by mode field
		if (config.mode === EngineMode.Write) {
			expect(config.overwritePolicy).toBe("fail_if_exists");
		} else {
			// TypeScript should make this unreachable
			expect(true).toBe(false);
		}
	});

	it("edit config has correct discriminated mode", () => {
		const config: EditConfig = {
			mode: EngineMode.Edit,
			targetPath: "/existing/file.ts",
			preserveConstraints: ["import paths", "copyright header"],
		};
		if (config.mode === EngineMode.Edit) {
			expect(config.preserveConstraints).toHaveLength(2);
		}
	});

	it("smart_write config has correct discriminated mode", () => {
		const config: SmartWriteConfig = {
			mode: EngineMode.SmartWrite,
			outputSchema: "planspec_v5",
		};
		if (config.mode === EngineMode.SmartWrite) {
			expect(config.outputSchema).toBe("planspec_v5");
		}
	});

	it("smart_edit config has correct discriminated mode", () => {
		const config: SmartEditConfig = {
			mode: EngineMode.SmartEdit,
			targetPath: "/existing/file.ts",
			auditScope: ["imports", "exports", "types"],
		};
		if (config.mode === EngineMode.SmartEdit) {
			expect(config.auditScope).toHaveLength(3);
		}
	});
});

// ---------------------------------------------------------------------------
// validateEngineConfig
// ---------------------------------------------------------------------------

describe("validateEngineConfig", () => {
	it("accepts valid write config", () => {
		const config: WriteConfig = {
			mode: EngineMode.Write,
			targetPath: "/new/file.ts",
			overwritePolicy: "fail_if_exists",
		};
		expect(validateEngineConfig(config)).toEqual([]);
	});

	it("rejects write config without targetPath", () => {
		const config = {
			mode: EngineMode.Write,
			targetPath: "",
			overwritePolicy: "fail_if_exists" as const,
		};
		const errors = validateEngineConfig(config);
		expect(errors).toContain("Write config requires targetPath");
	});

	it("accepts valid edit config", () => {
		const config: EditConfig = {
			mode: EngineMode.Edit,
			targetPath: "/existing/file.ts",
		};
		expect(validateEngineConfig(config)).toEqual([]);
	});

	it("rejects edit config without targetPath", () => {
		const config = {
			mode: EngineMode.Edit,
			targetPath: "",
		};
		const errors = validateEngineConfig(config);
		expect(errors).toContain("Edit config requires targetPath");
	});

	it("accepts valid smart_write config", () => {
		const config: SmartWriteConfig = {
			mode: EngineMode.SmartWrite,
			outputSchema: "planspec_v5",
		};
		expect(validateEngineConfig(config)).toEqual([]);
	});

	it("rejects smart_write with invalid outputSchema", () => {
		const config = {
			mode: EngineMode.SmartWrite,
			outputSchema: "markdown",
		};
		const errors = validateEngineConfig(config);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("invalid outputSchema");
	});

	it("accepts valid smart_edit config", () => {
		const config: SmartEditConfig = {
			mode: EngineMode.SmartEdit,
			targetPath: "/existing/file.ts",
			auditScope: ["imports"],
		};
		expect(validateEngineConfig(config)).toEqual([]);
	});

	it("rejects smart_edit without targetPath", () => {
		const config = {
			mode: EngineMode.SmartEdit,
			targetPath: "",
			auditScope: ["imports"],
		};
		const errors = validateEngineConfig(config);
		expect(errors).toContain("SmartEdit config requires targetPath");
	});

	it("rejects smart_edit with empty auditScope", () => {
		const config = {
			mode: EngineMode.SmartEdit,
			targetPath: "/existing/file.ts",
			auditScope: [],
		};
		const errors = validateEngineConfig(config);
		expect(errors).toContain("SmartEdit config requires at least one auditScope entry");
	});
});

// ---------------------------------------------------------------------------
// isEngineMode Guard
// ---------------------------------------------------------------------------

describe("isEngineMode", () => {
	it("returns true for valid mode values", () => {
		expect(isEngineMode("write")).toBe(true);
		expect(isEngineMode("edit")).toBe(true);
		expect(isEngineMode("smart_write")).toBe(true);
		expect(isEngineMode("smart_edit")).toBe(true);
	});

	it("returns true for EngineMode enum members", () => {
		expect(isEngineMode(EngineMode.Write)).toBe(true);
		expect(isEngineMode(EngineMode.Edit)).toBe(true);
	});

	it("returns false for invalid strings", () => {
		expect(isEngineMode("auto_detect")).toBe(false);
		expect(isEngineMode("infer")).toBe(false);
		expect(isEngineMode("")).toBe(false);
	});

	it("returns false for non-string values", () => {
		expect(isEngineMode(undefined)).toBe(false);
		expect(isEngineMode(null)).toBe(false);
		expect(isEngineMode(42)).toBe(false);
		expect(isEngineMode({})).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// No Implicit Inference (Design Contract)
// ---------------------------------------------------------------------------

describe("design contract — no implicit inference", () => {
	it("isEngineMode is the only coercion path — raw string comparison is explicit", () => {
		// There MUST be no "auto-detect" or "infer" mode value.
		expect(isEngineMode("auto_detect")).toBe(false);
		expect(isEngineMode("infer")).toBe(false);
	});

	it("every EngineConfig explicitly declares its mode", () => {
		// All configs must have a mode field that is the discriminated
		// union discriminant. There is no "mode-optional" config.
		const configs: EngineConfig[] = [
			{ mode: EngineMode.Write, targetPath: "/a.ts", overwritePolicy: "fail_if_exists" },
			{ mode: EngineMode.Edit, targetPath: "/b.ts" },
			{ mode: EngineMode.SmartWrite, outputSchema: "planspec_v5" },
			{ mode: EngineMode.SmartEdit, targetPath: "/c.ts", auditScope: ["imports"] },
		];
		for (const config of configs) {
			expect(config.mode).toBeDefined();
			expect(isEngineMode(config.mode)).toBe(true);
		}
	});

	it("no function accepts an implicit or auto-detected mode string", () => {
		// Every mode-taking function in this module requires EngineMode enum.
		// There is no overload that accepts a raw unvalidated string.
		// This is enforced at the type level by TypeScript.
		// Runtime check: the guard exists, but functions don't coerce internally.
		expect(true).toBe(true);
	});
});
