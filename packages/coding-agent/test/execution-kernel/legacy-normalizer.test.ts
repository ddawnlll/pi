import { describe, expect, it } from "vitest";
import { normalizeLegacyPlanToIntent } from "../../src/execution-kernel/legacy-normalizer.js";

describe("legacy-normalizer", () => {
	it("handles empty input with defaults", () => {
		const result = normalizeLegacyPlanToIntent({});
		expect(result.intent.parallelism).toBe(3);
		expect(result.intent.safetyLevel).toBe("normal");
		expect(result.intent.conflictRisk).toBe("low");
		expect(result.warnings).toEqual([]);
	});

	it("maps maxParallelWorkspaces to parallelism", () => {
		const result = normalizeLegacyPlanToIntent({ maxParallelWorkspaces: 1 });
		expect(result.intent.parallelism).toBe(1);
	});

	it("maps experimental_6 scale to strict safety", () => {
		const result = normalizeLegacyPlanToIntent({
			scale: { selectedMode: "experimental_6" },
		});
		expect(result.intent.parallelism).toBe(6);
		expect(result.intent.safetyLevel).toBe("strict");
	});

	it("warns about deprecated worktreeRequired", () => {
		const result = normalizeLegacyPlanToIntent({ worktreeRequired: true });
		expect(result.warnings.some((w) => w.field === "worktreeRequired")).toBe(true);
		expect(result.warnings.some((w) => w.type === "legacy_mechanism_field_used_as_hint")).toBe(true);
	});

	it("warns about deprecated integrationQueueRequired", () => {
		const result = normalizeLegacyPlanToIntent({ integrationQueueRequired: true });
		expect(result.warnings.some((w) => w.field === "integrationQueueRequired")).toBe(true);
	});

	it("warns about deprecated validationLockRequired", () => {
		const result = normalizeLegacyPlanToIntent({ validationLockRequired: true });
		expect(result.warnings.some((w) => w.field === "validationLockRequired")).toBe(true);
	});

	it("warns about deprecated completionGateRequired", () => {
		const result = normalizeLegacyPlanToIntent({ completionGateRequired: true });
		expect(result.warnings.some((w) => w.field === "completionGateRequired")).toBe(true);
	});

	it("infers medium conflict risk from mechanism hints", () => {
		const result = normalizeLegacyPlanToIntent({
			worktreeRequired: true,
			integrationQueueRequired: true,
		});
		expect(result.intent.conflictRisk).toBe("high");
	});

	it("infers scale_8 parallelism", () => {
		const result = normalizeLegacyPlanToIntent({
			scale: { selectedMode: "scale_8" },
		});
		expect(result.intent.parallelism).toBe(8);
		expect(result.intent.safetyLevel).toBe("strict");
	});

	it("preserves deadlines from boundedLiveness", () => {
		const result = normalizeLegacyPlanToIntent({
			boundedLiveness: {
				llm: {
					providerRequestTimeoutMs: 120000,
					streamIdleTimeoutMs: 300000,
				},
				validation: {
					defaultTimeoutMs: 600000,
					heavyTimeoutMs: 1200000,
				},
			},
		});
		expect(result.intent.deadlines?.llmRequestMs).toBe(120000);
		expect(result.intent.deadlines?.llmStreamIdleMs).toBe(300000);
		expect(result.intent.deadlines?.validationDefaultMs).toBe(600000);
		expect(result.intent.deadlines?.validationHeavyMs).toBe(1200000);
	});
});
