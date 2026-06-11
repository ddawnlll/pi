import { describe, expect, it } from "vitest";
import { EngineMode, type SmartEditConfig } from "../../src/core/mode/engine-mode.js";
import { createTaskIntentEnvelope } from "../../src/core/mode/task-intent-envelope.js";
import {
	createMutationPlan,
	transitionToAudit,
	transitionToPatch,
} from "../../src/core/smart-mutation/smart-mutation-planner.js";

describe("createMutationPlan", () => {
	it("creates a plan in inspect phase for smart edit", () => {
		const config: SmartEditConfig = {
			mode: EngineMode.SmartEdit,
			targetPath: "/tmp/file.ts",
			auditScope: ["imports"],
		};
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit and fix imports"));
		expect(plan.phase).toBe("inspect");
		expect(plan.plannedMutations).toHaveLength(1);
		expect(plan.readyForPatch).toBe(false);
	});

	it("rejects non-smart-edit mode", () => {
		const config = { mode: EngineMode.Write } as any;
		const plan = createMutationPlan(config, createTaskIntentEnvelope("write"));
		expect(plan.phase).toBe("inspect");
		expect(plan.readyForPatch).toBe(false);
	});

	it("blocks when target path is missing", () => {
		const config: SmartEditConfig = { mode: EngineMode.SmartEdit, targetPath: "", auditScope: ["imports"] };
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit"));
		expect(plan.readyForPatch).toBe(false);
	});
});

describe("transitionToAudit", () => {
	it("transitions from inspect to audit", () => {
		const config: SmartEditConfig = { mode: EngineMode.SmartEdit, targetPath: "/tmp/file.ts", auditScope: ["all"] };
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit"));
		const audited = transitionToAudit(plan);
		expect(audited.phase).toBe("audit");
		expect(audited.readyForPatch).toBe(false);
	});

	it("rejects transition from non-inspect phase", () => {
		const config: SmartEditConfig = { mode: EngineMode.SmartEdit, targetPath: "/tmp/file.ts", auditScope: ["all"] };
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit"));
		const audited = transitionToAudit(plan);
		const patched = transitionToAudit(audited); // try audit -> audit (invalid)
		expect(patched.phase).toBe("audit");
	});
});

describe("transitionToPatch", () => {
	it("transitions from audit to patch with findings", () => {
		const config: SmartEditConfig = { mode: EngineMode.SmartEdit, targetPath: "/tmp/file.ts", auditScope: ["all"] };
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit and fix"));
		const audited = transitionToAudit(plan);
		const patched = transitionToPatch(audited, ["finding-1", "finding-2"]);
		expect(patched.phase).toBe("patch");
		expect(patched.readyForPatch).toBe(true);
		expect(patched.plannedMutations[0].addressedFindings).toContain("finding-1");
	});

	it("rejects patch transition from inspect phase", () => {
		const config: SmartEditConfig = { mode: EngineMode.SmartEdit, targetPath: "/tmp/file.ts", auditScope: ["all"] };
		const plan = createMutationPlan(config, createTaskIntentEnvelope("audit and fix"));
		const patched = transitionToPatch(plan, ["finding-1"]);
		expect(patched.phase).toBe("inspect");
		expect(patched.readyForPatch).toBe(false);
	});
});
