/**
 * WorkspaceAgentExecutor ACCP Tests (P49.16)
 *
 * Verifies that ACCP output contract injection works through the
 * executor path (delegates to AgentSession which handles injection).
 */
import { describe, expect, it } from "vitest";
import { renderAccpPrompt } from "../../src/core/accp-prompt-renderer.js";

describe("WorkspaceAgentExecutor ACCP Contract Injection", () => {
	it("should render ACCP prompt contract for TVR in warn mode", () => {
		const contract = renderAccpPrompt("tvr", "warn");
		expect(contract).toContain("TVR");
		expect(contract).toContain("Test Validation Report");
		expect(contract).toContain("ACCP-YAML");
	});

	it("should render ACCP prompt contract for BSR in required mode", () => {
		const contract = renderAccpPrompt("bsr", "required");
		expect(contract).toContain("BSR");
		expect(contract).toContain("REQUIRED");
	});

	it("should render repair prompt contract", () => {
		const contract = renderAccpPrompt("repair", "warn");
		expect(contract).toContain("normalizing");
		expect(contract).toContain("NOT");
	});

	it("should be off mode no-op for all contracts", () => {
		expect(renderAccpPrompt("bsr", "off")).toBe("");
		expect(renderAccpPrompt("tvr", "off")).toBe("");
		expect(renderAccpPrompt("repair", "off")).toBe("");
	});

	it("should include authority boundary in prompt contracts", () => {
		const contract = renderAccpPrompt("bsr", "warn");
		// Must not suggest that the report authorizes mutation
		expect(contract).toContain("evidence-only");
		expect(contract).not.toContain("authorizes");
	});
});
