/**
 * ACCP Prompt Renderer Tests (P49.14)
 */
import { describe, expect, it } from "vitest";
import { renderAccpModeDirective, renderAccpPrompt } from "../../src/core/accp-prompt-renderer.js";

describe("ACCP Prompt Renderer", () => {
	it("should return empty for off mode", () => {
		expect(renderAccpPrompt("bsr", "off")).toBe("");
		expect(renderAccpModeDirective("off")).toBe("");
	});

	it("should return a rendered contract for warn mode", () => {
		const result = renderAccpPrompt("bsr", "warn");
		expect(result).toContain("ACCP Prompt Contract: bsr");
		expect(result).toContain("WARN");
	});

	it("should return a rendered contract for required mode", () => {
		const result = renderAccpPrompt("tvr", "required");
		expect(result).toContain("ACCP Prompt Contract: tvr");
		expect(result).toContain("REQUIRED");
	});

	it("should return fallback for unknown contract ID", () => {
		const result = renderAccpPrompt("unknown_contract", "warn");
		expect(result).toContain("No template found");
	});

	it("should render mode directive for warn", () => {
		const result = renderAccpModeDirective("warn");
		expect(result).toContain("ACCP Mode");
		expect(result).toContain("warn");
		expect(result).toContain("non-blocking");
	});

	it("should render mode directive for required", () => {
		const result = renderAccpModeDirective("required");
		expect(result).toContain("required");
		expect(result).toContain("Gate-blocking findings");
	});
});
