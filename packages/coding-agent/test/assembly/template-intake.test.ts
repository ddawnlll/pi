import { describe, expect, it } from "vitest";
import { generateTemplateUpdate, intakePlan } from "../../src/core/assembly/template-intake.js";

describe("TemplateIntake", () => {
	it("generates template update with features", () => {
		const update = generateTemplateUpdate();
		expect(update.addedFeatures.length).toBeGreaterThan(0);
		expect(update.updatedSections.length).toBeGreaterThan(0);
		expect(update.breakingChanges.length).toBeGreaterThan(0);
	});

	it("intakePlan accepts green governor plans", () => {
		const result = intakePlan({ workspaceCount: 20, averageFileCount: 5, governorSignal: "green" });
		expect(result.accepted).toBe(true);
	});

	it("intakePlan blocks red governor plans", () => {
		const result = intakePlan({ workspaceCount: 20, averageFileCount: 5, governorSignal: "red" });
		expect(result.accepted).toBe(false);
	});

	it("warns on large plans", () => {
		const result = intakePlan({ workspaceCount: 50, averageFileCount: 5, governorSignal: "green" });
		expect(result.warnings.some((w) => w.includes("Large plan"))).toBe(true);
	});

	it("estimates duration proportional to workspace and file count", () => {
		const small = intakePlan({ workspaceCount: 10, averageFileCount: 3, governorSignal: "green" });
		const large = intakePlan({ workspaceCount: 30, averageFileCount: 10, governorSignal: "green" });
		expect(large.estimatedDurationMs).toBeGreaterThan(small.estimatedDurationMs);
	});
});
