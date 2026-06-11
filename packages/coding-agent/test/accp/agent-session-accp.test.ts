/**
 * AgentSession ACCP Injection Tests (P49.15)
 *
 * Verifies that ACCP mode directive is injected into the system prompt
 * when ACCP mode is active, and is a no-op when off.
 */
import { describe, expect, it } from "vitest";
import { renderAccpModeDirective } from "../../src/core/accp-prompt-renderer.js";

describe("AgentSession ACCP Injection", () => {
	it("should inject ACCP mode directive in warn mode", () => {
		const directive = renderAccpModeDirective("warn");
		expect(directive).toContain("ACCP Mode");
		expect(directive).toContain("warn");
	});

	it("should inject ACCP mode directive in required mode", () => {
		const directive = renderAccpModeDirective("required");
		expect(directive).toContain("ACCP Mode");
		expect(directive).toContain("required");
	});

	it("should be a no-op in off mode", () => {
		expect(renderAccpModeDirective("off")).toBe("");
		expect(renderAccpModeDirective("off").length).toBe(0);
	});

	it("should include authority boundary info in directive", () => {
		const directive = renderAccpModeDirective("warn");
		expect(directive).toContain("Route signals");
		expect(directive).toContain("advisory");
		expect(directive).toContain("Rendered Markdown");
	});

	it("should not contain full ACCP spec prose (AP-P49-004)", () => {
		const directive = renderAccpModeDirective("warn");
		// Compact contracts should not contain the full ACCP spec
		expect(directive.length).toBeLessThan(500);
	});
});
