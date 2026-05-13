/**
 * Tests for Edit Strategy Policy - Adaptive Edit Strategy & Failure Handoff
 *
 * P4.5: Validates the three edit strategy modes (Token Saving, Hybrid, Speed)
 * with TSX component patch requirements, generated manifest checks,
 * and all mode-specific thresholds.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	createEditStrategyPolicy,
	DEFAULT_EDIT_STRATEGY_POLICY_CONFIG,
	type EditStrategyMode,
	EditStrategyPolicy,
} from "../src/core/edit-strategy-policy.js";

/** Shorthand to create a policy with a specific mode and optional overrides. */
function policyWithMode(mode: EditStrategyMode, overrides?: Record<string, unknown>): EditStrategyPolicy {
	return new EditStrategyPolicy({ mode, ...overrides });
}

// ---------------------------------------------------------------------------
// 1. Module Structure & Defaults
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Module Structure & Defaults", () => {
	it("should export createEditStrategyPolicy factory", () => {
		const policy = createEditStrategyPolicy();
		expect(policy).toBeInstanceOf(EditStrategyPolicy);
	});

	it("should export DEFAULT_EDIT_STRATEGY_POLICY_CONFIG with correct defaults", () => {
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.mode).toBe("hybrid");
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxLines).toBe(200);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingMaxBytes).toBe(8192);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridBudgetMaxBytes).toBe(40960);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.speedMaxLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.tokenSavingTsxPatchRequiredLines).toBe(300);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.hybridTsxPatchRequiredLines).toBe(1000);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.sameFileEditFailureHandoffThreshold).toBe(2);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.truncationForcesFallback).toBe(true);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.exactMatchFailureCountsTowardHandoff).toBe(true);
		expect(DEFAULT_EDIT_STRATEGY_POLICY_CONFIG.generatedManifest).toEqual([]);
	});

	it("should default to hybrid mode", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.getMode()).toBe("hybrid");
	});
});

// ---------------------------------------------------------------------------
// 2. New Files - always write_allowed in all modes
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - New Files", () => {
	const modes: EditStrategyMode[] = ["token_saving", "hybrid", "speed"];

	for (const mode of modes) {
		it(`should return write_allowed for new files in ${mode} mode`, () => {
			const policy = policyWithMode(mode);
			const result = policy.checkPolicy("src/new-file.ts", true, 0, 0);
			expect(result.allowed).toBe(true);
			expect(result.writeAllowed).toBe(true);
			expect(result.reasonCode).toBe("new_file_write_allowed");
		});
	}
});

// ---------------------------------------------------------------------------
// 3. Generated Files with Manifest
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Generated Files with Manifest", () => {
	it("should allow full rewrite for manifest-marked generated file in token_saving mode", () => {
		const policy = policyWithMode("token_saving", {
			generatedManifest: [{ path: "dist/output.js", rewriteAllowed: true }],
		});
		const result = policy.checkPolicy("dist/output.js", false, 500, 20000);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("manifest_marked_rewrite_allowed");
	});

	it("should NOT allow full rewrite for manifest entry with rewriteAllowed=false", () => {
		const policy = policyWithMode("token_saving", {
			generatedManifest: [{ path: "dist/output.js", rewriteAllowed: false }],
		});
		const result = policy.checkPolicy("dist/output.js", false, 300, 12000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("generated_file_rewrite_blocked");
	});

	it("should NOT allow full rewrite for generated file NOT in manifest", () => {
		const policy = policyWithMode("token_saving", {
			generatedManifest: [{ path: "dist/other.js", rewriteAllowed: true }],
		});
		const result = policy.checkPolicy("dist/not-in-manifest.js", false, 300, 12000);
		expect(result.writeAllowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 4. Token Saving Mode
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Token Saving Mode", () => {
	let policy: EditStrategyPolicy;

	beforeEach(() => {
		policy = policyWithMode("token_saving");
	});

	it("should block full rewrite for existing file with 201 lines", () => {
		const result = policy.checkPolicy("src/large.ts", false, 201, 5000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("existing_file_blocked_size");
	});

	it("should allow full rewrite for existing file with exactly 200 lines", () => {
		const result = policy.checkPolicy("src/medium.ts", false, 200, 5000);
		expect(result.writeAllowed).toBe(true);
	});

	it("should block full rewrite for existing file over 8KB bytes", () => {
		const result = policy.checkPolicy("src/big.ts", false, 100, 8193);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("existing_file_blocked_bytes");
	});

	it("should allow full rewrite for existing file at exactly 8KB bytes", () => {
		const result = policy.checkPolicy("src/ok.ts", false, 100, 8192);
		expect(result.writeAllowed).toBe(true);
	});

	it("should block full rewrite for TSX component over 300 lines", () => {
		const result = policy.checkPolicy("src/Component.tsx", false, 301, 5000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("should block full rewrite for JSX component over 300 lines", () => {
		const result = policy.checkPolicy("src/Component.jsx", false, 301, 5000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("should block TSX component at 300 lines due to general 200-line limit", () => {
		const result = policy.checkPolicy("src/Component.tsx", false, 300, 5000);
		// TSX patch limit (300) doesn't trigger at exactly 300, but general 200-line limit does
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("existing_file_blocked_size");
	});

	it("should NOT apply TSX patch requirement to .ts files", () => {
		const result = policy.checkPolicy("src/service.ts", false, 250, 8000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("existing_file_blocked_size");
	});

	it("should allow full rewrite for TSX under both limits", () => {
		const result = policy.checkPolicy("src/Small.tsx", false, 150, 4000);
		expect(result.writeAllowed).toBe(true);
	});

	it("should allow full rewrite for file with 0 lines and 0 bytes", () => {
		const result = policy.checkPolicy("src/empty.ts", false, 0, 0);
		expect(result.writeAllowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5. Hybrid Mode
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Hybrid Mode", () => {
	it("should block files over 200 lines without budget", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/file.ts", false, 201, 5000);
		expect(result.writeAllowed).toBe(false);
	});

	it("should allow full rewrite for 500-line file when budget passes", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/file.ts", false, 500, 20000, 20000, 10000, 500);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("output_budget_pass_full_rewrite");
	});

	it("should block full rewrite for 1001 lines even when budget passes", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/file.ts", false, 1001, 41000, 41000, 50000, 1001);
		expect(result.writeAllowed).toBe(false);
	});

	it("should block full rewrite for file over 40KB even when budget passes", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/file.ts", false, 800, 40961, 40961, 50000, 800);
		expect(result.writeAllowed).toBe(false);
	});

	it("should block full rewrite for TSX over 1000 lines when budget passes", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/Big.tsx", false, 1001, 41000, 41000, 50000, 1001);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("should apply token-saving TSX limit (300 lines) when budget does NOT pass", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/Component.tsx", false, 301, 12000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("should treat undefined budget as no budget (falls back to token saving)", () => {
		const policy = policyWithMode("hybrid");
		const result = policy.checkPolicy("src/file.ts", false, 500, 20000, 20000, undefined, 500);
		expect(result.writeAllowed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 6. Speed Mode
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Speed Mode", () => {
	it("should allow full rewrite for existing file under 1000 lines", () => {
		const policy = policyWithMode("speed");
		const result = policy.checkPolicy("src/file.ts", false, 999, 40000);
		expect(result.writeAllowed).toBe(true);
		expect(result.reasonCode).toBe("speed_mode_full_rewrite");
	});

	it("should block full rewrite for existing file over 1000 lines (hard safety gate)", () => {
		const policy = policyWithMode("speed");
		const result = policy.checkPolicy("src/file.ts", false, 1001, 40000);
		expect(result.writeAllowed).toBe(false);
		expect(result.reasonCode).toBe("hard_safety_gate_blocked");
	});

	it("should allow full rewrite for small files", () => {
		const policy = policyWithMode("speed");
		const result = policy.checkPolicy("src/small.ts", false, 50, 2000);
		expect(result.writeAllowed).toBe(true);
	});

	it("should not consider byte size in speed mode (only line count)", () => {
		const policy = policyWithMode("speed");
		const result = policy.checkPolicy("src/wide.ts", false, 800, 100000);
		expect(result.writeAllowed).toBe(true);
	});

	it("should not block TSX components under hard safety gate in speed mode", () => {
		const policy = policyWithMode("speed");
		const result = policy.checkPolicy("src/Big.tsx", false, 999, 40000);
		expect(result.writeAllowed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 7. Reason Codes
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Reason Codes", () => {
	it("should return tsx_component_patch_required for TSX components over limit", () => {
		const policy = policyWithMode("token_saving");
		const result = policy.checkPolicy("Big.tsx", false, 400, 16000);
		expect(result.reasonCode).toBe("tsx_component_patch_required");
	});

	it("should return generated_file_rewrite_blocked for non-rewrite manifest entries", () => {
		const policy = createEditStrategyPolicy({
			generatedManifest: [{ path: "g.ts", rewriteAllowed: false }],
		});
		const result = policy.checkPolicy("g.ts", false, 500, 20000);
		expect(result.reasonCode).toBe("generated_file_rewrite_blocked");
	});

	it("should always include a human-readable reason string", () => {
		const policy = policyWithMode("token_saving");
		const result = policy.checkPolicy("src/test.ts", false, 300, 5000);
		expect(result.reason).toBeTruthy();
		expect(typeof result.reason).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// 8. Config Management
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Config Management", () => {
	it("should return a read-only copy of config", () => {
		const policy = createEditStrategyPolicy();
		const config = policy.getConfig();
		expect(config.mode).toBe("hybrid");
		(config as Record<string, unknown>).mode = "speed";
		expect(policy.getMode()).toBe("hybrid");
	});

	it("should support partial config update", () => {
		const policy = createEditStrategyPolicy();
		policy.updateConfig({ mode: "speed", speedMaxLines: 2000 });
		expect(policy.getMode()).toBe("speed");
		expect(policy.getConfig().speedMaxLines).toBe(2000);
	});

	it("should expose handoff threshold", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.getHandoffThreshold()).toBe(2);
	});

	it("should expose truncation fallback flag", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.isTruncationFallbackEnabled()).toBe(true);
	});

	it("should expose exact-match failure counted flag", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.isExactMatchFailureCounted()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 9. Acceptance Criteria Verification
// ---------------------------------------------------------------------------

describe("EditStrategyPolicy - Acceptance Criteria", () => {
	it("AC3: Hybrid is default", () => {
		const policy = createEditStrategyPolicy();
		expect(policy.getMode()).toBe("hybrid");
	});

	it("AC4: Token Saving blocks existing files over 200 lines or 8KB", () => {
		const policy = policyWithMode("token_saving");
		expect(policy.checkPolicy("f.ts", false, 201, 5000).writeAllowed).toBe(false);
		expect(policy.checkPolicy("f.ts", false, 100, 8193).writeAllowed).toBe(false);
		expect(policy.checkPolicy("f.ts", false, 200, 8192).writeAllowed).toBe(true);
	});

	it("AC6: Speed allows full rewrite under 1000 lines while preserving hard safety gates", () => {
		const policy = policyWithMode("speed");
		expect(policy.checkPolicy("f.ts", false, 999, 40000).writeAllowed).toBe(true);
		expect(policy.checkPolicy("f.ts", false, 1001, 40000).writeAllowed).toBe(false);
	});

	it("AC8: Generated files can be rewrite-allowed only with manifest marking", () => {
		const policy = policyWithMode("token_saving", {
			generatedManifest: [{ path: "gen/out.ts", rewriteAllowed: true }],
		});
		expect(policy.checkPolicy("gen/out.ts", false, 500, 20000).writeAllowed).toBe(true);
		expect(policy.checkPolicy("gen/other.ts", false, 500, 20000).writeAllowed).toBe(false);
	});
});
