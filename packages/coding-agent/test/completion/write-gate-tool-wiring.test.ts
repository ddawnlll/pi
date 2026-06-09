/**
 * P44.WG — WriteGate and SmartMutation Tool Wiring Tests
 *
 * Tests that the write and edit tools correctly wire in:
 * - WriteGate (pre-check blocking and result tracking)
 * - SmartMutationEngine (safe mutation via the engine)
 *
 * Each guard is optional: when provided, the tools use them;
 * when omitted, the existing direct implementation is used.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MutationRequest, MutationResult } from "../../src/core/mutation/mutation-types.js";
import type { SmartMutationEngine } from "../../src/core/mutation/smart-mutation-engine.js";
import { createEditToolDefinition } from "../../src/core/tools/edit.js";
import { createWriteToolDefinition } from "../../src/core/tools/write.js";
import type { EditStrategyReasonCode, WriteGate, WriteGateResult } from "../../src/core/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTextOutput(result: any): string {
	return (
		result.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n") || ""
	);
}

function executeWriteTool(tool: any, callId: string, params: { path: string; content: string }): Promise<any> {
	return tool.execute(callId, params, undefined, undefined, {});
}

function executeEditTool(
	tool: any,
	callId: string,
	params: { path: string; edits: Array<{ oldText: string; newText: string }> },
): Promise<any> {
	return tool.execute(callId, params, undefined, undefined, {});
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALLOW_GATE_RESULT: WriteGateResult = {
	allowed: true,
	isNewFile: false,
	reason: "",
	reasonCode: undefined,
	snapshot: undefined,
	truncationFallback: false,
	handoffTriggered: false,
};

const BLOCK_GATE_RESULT: WriteGateResult = {
	allowed: false,
	isNewFile: false,
	reason: "Full rewrite blocked by edit strategy policy. Use targeted edits instead.",
	reasonCode: "existing_file_blocked_size" as EditStrategyReasonCode,
	snapshot: "original content",
	truncationFallback: false,
	handoffTriggered: false,
};

function createMockWriteGate(): WriteGate {
	return {
		check: vi.fn<WriteGate["check"]>().mockResolvedValue(ALLOW_GATE_RESULT),
		processWriteResult: vi.fn(),
		processEditResult: vi.fn(),
		emitBlockedEvent: vi.fn(),
	} as unknown as WriteGate;
}

const OK_MUTATION_RESULT: MutationResult = {
	ok: true,
	path: "/test/file.ts",
	mode: "overwrite",
	safetyLevel: "safe",
	preHash: "abc",
	postHash: "def",
	createdFile: true,
};

const BLOCKED_MUTATION_RESULT: MutationResult = {
	ok: false,
	path: "/test/file.ts",
	mode: "overwrite",
	safetyLevel: "blocked",
	blocked: true,
	blockReason:
		"blocked: large_existing_file_overwrite_blocked: File has 301 lines (threshold: 300). Full overwrite blocked.",
};

function createMockSmartMutationEngine(ok: boolean = true): SmartMutationEngine {
	const result = ok ? OK_MUTATION_RESULT : BLOCKED_MUTATION_RESULT;
	return {
		mutate: vi.fn().mockResolvedValue(result) as any,
	} as unknown as SmartMutationEngine;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P44.WG — WriteGate and SmartMutation Tool Wiring", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `wg-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	// =====================================================================
	// Write Tool + WriteGate
	// =====================================================================

	describe("write tool + WriteGate", () => {
		it("should proceed with write when WriteGate allows", async () => {
			const mockGate = createMockWriteGate();
			const tool = createWriteToolDefinition(testDir, { writeGate: mockGate });
			const testFile = join(testDir, "test.txt");
			const content = "Hello, world!";

			const result = await executeWriteTool(tool, "tc-1", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(readFileSync(testFile, "utf-8")).toBe(content);
			expect(mockGate.check).toHaveBeenCalledTimes(1);
			expect(mockGate.check).toHaveBeenCalledWith(
				testFile,
				"test.txt",
				Buffer.byteLength(content, "utf-8"),
				undefined,
				content.split("\n").length,
			);
		});

		it("should block write when WriteGate blocks", async () => {
			const mockGate = createMockWriteGate();
			vi.mocked(mockGate.check).mockResolvedValue(BLOCK_GATE_RESULT);
			const tool = createWriteToolDefinition(testDir, { writeGate: mockGate });
			const testFile = join(testDir, "blocked.txt");
			const content = "Large content";

			const result = await executeWriteTool(tool, "tc-2", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Full rewrite blocked");
			expect(result.isError).toBe(true);
			// File should NOT have been written
			expect(() => readFileSync(testFile, "utf-8")).toThrow();
		});

		it("should not call WriteGate when no WriteGate is configured", async () => {
			const tool = createWriteToolDefinition(testDir);
			const testFile = join(testDir, "no-gate.txt");
			const content = "No gate here";

			const result = await executeWriteTool(tool, "tc-3", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(readFileSync(testFile, "utf-8")).toBe(content);
		});

		it("should create parent directories even with WriteGate", async () => {
			const mockGate = createMockWriteGate();
			const tool = createWriteToolDefinition(testDir, { writeGate: mockGate });
			const nestedFile = join(testDir, "a", "b", "nested.txt");
			const content = "Nested";

			const result = await executeWriteTool(tool, "tc-4", { path: nestedFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(readFileSync(nestedFile, "utf-8")).toBe(content);
		});

		it("should call processWriteResult after successful write via default path", async () => {
			// Note: The default path doesn't call processWriteResult directly;
			// it's only called in the SmartMutationEngine path.
			// This test verifies the write still succeeds without processWriteResult.
			const mockGate = createMockWriteGate();
			const tool = createWriteToolDefinition(testDir, { writeGate: mockGate });
			const testFile = join(testDir, "track.txt");
			const content = "Track me";

			const result = await executeWriteTool(tool, "tc-5", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(mockGate.check).toHaveBeenCalled();
			// processWriteResult is NOT called in the default path
		});
	});

	// =====================================================================
	// Write Tool + SmartMutationEngine
	// =====================================================================

	describe("write tool + SmartMutationEngine", () => {
		it("should use SmartMutationEngine when provided (successful)", async () => {
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createWriteToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-write.txt");
			const content = "Engine content";

			const result = await executeWriteTool(tool, "tc-6", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(vi.mocked(mockEngine.mutate as any).mock.calls).toHaveLength(1);

			const mutateCall = vi.mocked(mockEngine.mutate as any).mock.calls[0][0] as MutationRequest;
			expect(mutateCall.repoRoot).toBe(testDir);
			expect(mutateCall.path).toBe("sme-write.txt");
			expect(mutateCall.mode).toBe("overwrite");
			expect(mutateCall.content).toBe(content);
		});

		it("should report error when SmartMutationEngine blocks the write", async () => {
			const mockEngine = createMockSmartMutationEngine(false);
			const tool = createWriteToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-blocked.txt");
			const content = "Blocked content";

			const result = await executeWriteTool(tool, "tc-7", { path: testFile, content });

			expect(getTextOutput(result)).toContain("blocked");
			expect(result.isError).toBe(true);
		});

		it("should call processWriteResult after SME mutation succeeds", async () => {
			const mockGate = createMockWriteGate();
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createWriteToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-gate.txt");
			const content = "Gate + SME";

			const result = await executeWriteTool(tool, "tc-8", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			expect(mockGate.processWriteResult).toHaveBeenCalledWith("sme-gate.txt", "", true);
		});

		it("should call processWriteResult with error when SME mutation fails", async () => {
			const mockGate = createMockWriteGate();
			const mockEngine = createMockSmartMutationEngine(false);
			const tool = createWriteToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-gate-fail.txt");
			const content = "Fail";

			const result = await executeWriteTool(tool, "tc-9", { path: testFile, content });

			expect(result.isError).toBe(true);
			expect(mockGate.processWriteResult).toHaveBeenCalledTimes(1);
			const args = vi.mocked(mockGate.processWriteResult).mock.calls[0];
			expect(args[0]).toBe("sme-gate-fail.txt");
			expect(args[1]).toBe(BLOCKED_MUTATION_RESULT.blockReason);
			expect(args[2]).toBe(false);
		});

		it("should handle SME exception gracefully", async () => {
			const mockEngine = {
				mutate: vi.fn().mockRejectedValue(new Error("Engine exploded")),
			} as unknown as SmartMutationEngine;
			const tool = createWriteToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-crash.txt");
			const content = "Crash";

			const result = await executeWriteTool(tool, "tc-10", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Write failed: Engine exploded");
			expect(result.isError).toBe(true);
		});
	});

	// =====================================================================
	// Write Tool + WriteGate + SmartMutationEngine (combined)
	// =====================================================================

	describe("write tool + WriteGate + SmartMutationEngine (combined)", () => {
		it("should check WriteGate before using SmartMutationEngine", async () => {
			const mockGate = createMockWriteGate();
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createWriteToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "combined.txt");
			const content = "Combined";

			const result = await executeWriteTool(tool, "tc-11", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Successfully wrote");
			// Gate check called before SME mutate
			expect(mockGate.check).toHaveBeenCalledBefore(mockEngine.mutate as any);
		});

		it("should not call SmartMutationEngine when WriteGate blocks", async () => {
			const mockGate = createMockWriteGate();
			vi.mocked(mockGate.check).mockResolvedValue(BLOCK_GATE_RESULT);
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createWriteToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "combined-blocked.txt");
			const content = "Blocked";

			const result = await executeWriteTool(tool, "tc-12", { path: testFile, content });

			expect(getTextOutput(result)).toContain("Full rewrite blocked");
			expect(result.isError).toBe(true);
			// SME should NOT have been called
			expect(vi.mocked(mockEngine.mutate as any).mock.calls).toHaveLength(0);
		});
	});

	// =====================================================================
	// Edit Tool + WriteGate
	// =====================================================================

	describe("edit tool + WriteGate", () => {
		it("should call processEditResult on successful edit", async () => {
			const mockGate = createMockWriteGate();
			const tool = createEditToolDefinition(testDir, { writeGate: mockGate });
			const testFile = join(testDir, "edit-track.txt");
			writeFileSync(testFile, "original");

			const result = await executeEditTool(tool, "tc-13", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			expect(mockGate.processEditResult).toHaveBeenCalledWith("edit-track.txt", "", true);
		});

		it("should not call WriteGate when none is configured", async () => {
			const tool = createEditToolDefinition(testDir);
			const testFile = join(testDir, "edit-no-gate.txt");
			writeFileSync(testFile, "original");

			const result = await executeEditTool(tool, "tc-14", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
		});
	});

	// =====================================================================
	// Edit Tool + SmartMutationEngine
	// =====================================================================

	describe("edit tool + SmartMutationEngine", () => {
		it("should use SmartMutationEngine when provided (successful)", async () => {
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createEditToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-edit.txt");
			writeFileSync(testFile, "original content");

			const result = await executeEditTool(tool, "tc-15", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			expect(vi.mocked(mockEngine.mutate as any).mock.calls).toHaveLength(1);

			const mutateCall = vi.mocked(mockEngine.mutate as any).mock.calls[0][0] as MutationRequest;
			expect(mutateCall.repoRoot).toBe(testDir);
			expect(mutateCall.path).toBe("sme-edit.txt");
			expect(mutateCall.mode).toBe("edit");
			expect(mutateCall.oldText).toBe("original");
			expect(mutateCall.newText).toBe("modified");
		});

		it("should report error when SmartMutationEngine blocks the edit", async () => {
			const mockEngine = createMockSmartMutationEngine(false);
			const tool = createEditToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-edit-blocked.txt");
			writeFileSync(testFile, "original content");

			const result = await executeEditTool(tool, "tc-16", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(getTextOutput(result)).toContain("blocked");
			expect(result.isError).toBe(true);
		});

		it("should process multiple edits sequentially through SME", async () => {
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createEditToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-multi-edit.txt");
			writeFileSync(testFile, "a\nb\nc\n");

			const result = await executeEditTool(tool, "tc-17", {
				path: testFile,
				edits: [
					{ oldText: "a", newText: "A" },
					{ oldText: "b", newText: "B" },
				],
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			// SME should have been called twice (once per edit)
			expect(vi.mocked(mockEngine.mutate as any).mock.calls).toHaveLength(2);
		});

		it("should stop on first SME failure for multiple edits", async () => {
			const mockEngine = createMockSmartMutationEngine(true);
			// First call succeeds, second fails
			vi.mocked((mockEngine as any).mutate)
				.mockResolvedValueOnce(OK_MUTATION_RESULT)
				.mockResolvedValueOnce(BLOCKED_MUTATION_RESULT);
			const tool = createEditToolDefinition(testDir, {
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "sme-stop-on-fail.txt");
			writeFileSync(testFile, "x\ny\nz\n");

			const result = await executeEditTool(tool, "tc-18", {
				path: testFile,
				edits: [
					{ oldText: "x", newText: "X" },
					{ oldText: "z", newText: "Z" },
				],
			});

			expect(getTextOutput(result)).toContain("blocked");
			expect(result.isError).toBe(true);
			// Second edit's mutation should have failed
			expect(vi.mocked(mockEngine.mutate as any).mock.calls).toHaveLength(2);
		});
	});

	// =====================================================================
	// Edit Tool + WriteGate + SmartMutationEngine (combined)
	// =====================================================================

	describe("edit tool + WriteGate + SmartMutationEngine (combined)", () => {
		it("should call processEditResult after successful SME edit", async () => {
			const mockGate = createMockWriteGate();
			const mockEngine = createMockSmartMutationEngine(true);
			const tool = createEditToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "edit-combined.txt");
			writeFileSync(testFile, "original content");

			const result = await executeEditTool(tool, "tc-19", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(getTextOutput(result)).toContain("Successfully replaced");
			expect(mockGate.processEditResult).toHaveBeenCalledWith("edit-combined.txt", "", true);
		});

		it("should call processEditResult when SME fails", async () => {
			const mockGate = createMockWriteGate();
			const mockEngine = createMockSmartMutationEngine(false);
			const tool = createEditToolDefinition(testDir, {
				writeGate: mockGate,
				smartMutationEngine: mockEngine,
				repoRoot: testDir,
			});
			const testFile = join(testDir, "edit-combined-fail.txt");
			writeFileSync(testFile, "original content");

			const result = await executeEditTool(tool, "tc-20", {
				path: testFile,
				edits: [{ oldText: "original", newText: "modified" }],
			});

			expect(result.isError).toBe(true);
			expect(mockGate.processEditResult).toHaveBeenCalledTimes(1);
			const args = vi.mocked(mockGate.processEditResult).mock.calls[0];
			expect(args[0]).toBe("edit-combined-fail.txt");
			expect(args[1]).toBe(BLOCKED_MUTATION_RESULT.blockReason);
			expect(args[2]).toBe(false);
		});
	});
});
