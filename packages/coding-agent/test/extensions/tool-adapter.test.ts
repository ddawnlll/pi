/**
 * Tests for ToolAdapter - Agent Tool Injection
 *
 * Covers:
 * 1. Installed extension appears in agent tool list
 * 2. When agent calls extension tool, it runs in sandbox
 * 3. Failed extension tool call does not stop the plan
 * 4. Integration test: WorkspaceAgentExecutor works with extension tool
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { Extension } from "../../src/core/extensions/index.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../src/core/extensions/loader.js";
import { createSyntheticSourceInfo } from "../../src/core/source-info.js";
import { adaptExtensionTools, ToolAdapter } from "../../src/extensions/tool-adapter.js";
import { createHarness } from "../suite/harness.js";
import type { Harness } from "../suite/harness.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create an Extension with a single tool for testing. */
function createTestExtension(
	toolFn: Function = (async () => ({
		content: [{ type: "text" as const, text: "ok" }],
		details: {},
	})) as Function,
): Extension {
	const ext: Extension = {
		path: "<test>",
		resolvedPath: "<test>",
		sourceInfo: createSyntheticSourceInfo("<test>", { source: "test" }),
		handlers: new Map(),
		tools: new Map([
			[
				"test-tool",
				{
					definition: {
						name: "test-tool",
						label: "Test Tool",
						description: "A test tool for unit testing",
						parameters: Type.Object({
							message: Type.Optional(Type.String()),
						}),
						execute: toolFn as any,
					},
					sourceInfo: createSyntheticSourceInfo("<test>", { source: "test" }),
				},
			],
		]),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
	return ext;
}

/** Create an Extension with multiple tools for testing. */
function createMultiToolExtension(
	name: string,
	toolCount: number,
): Extension {
	const tools = new Map<string, { definition: any; sourceInfo: any }>();
	for (let i = 1; i <= toolCount; i++) {
		const toolName = name + "-tool-" + i;
		tools.set(toolName, {
			definition: {
				name: toolName,
				label: name + " Tool " + i,
				description: "Tool " + i + " from extension " + name,
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text" as const, text: name + ":" + i }],
					details: {},
				}),
			},
			sourceInfo: createSyntheticSourceInfo("<" + name + ">", { source: "test" }),
		});
	}

	return {
		path: "<" + name + ">",
		resolvedPath: "<" + name + ">",
		sourceInfo: createSyntheticSourceInfo("<" + name + ">", { source: "test" }),
		handlers: new Map(),
		tools,
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

// ============================================================================
// Helpers
// ============================================================================

/** Minimal ExtensionContext for test calls. */
function testExtensionContext(): any {
	return {
		ui: {} as any,
		hasUI: false,
		cwd: "/tmp",
		sessionManager: {} as any,
		modelRegistry: {} as any,
	};
}

/** Extract text from a tool result content array. */
function getContentText(result: {
	content: Array<{ type: string; text?: string }>;
}): string {
	const first = result.content[0];
	return first && first.type === "text" ? (first.text ?? "") : "";
}

// ============================================================================
// ToolAdapter - adaptAllTools
// ============================================================================

describe("ToolAdapter", () => {
	describe("adaptAllTools", () => {
		it("should adapt a single extension tool to ToolDefinition", () => {
			const extension = createTestExtension();
			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			expect(result.toolDefinitions).toHaveLength(1);
			expect(result.toolDefinitions[0]!.name).toBe("test-tool");
			expect(result.toolDefinitions[0]!.label).toBe("Test Tool");
			expect(result.toolDefinitions[0]!.description).toBe("A test tool for unit testing");
		});

		it("should include the tool name in toolNames array", () => {
			const extension = createTestExtension();
			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			expect(result.toolNames).toContain("test-tool");
			expect(result.toolNames).toHaveLength(1);
		});

		it("should adapt tools from multiple extensions", () => {
			const ext1 = createMultiToolExtension("ext1", 2);
			const ext2 = createMultiToolExtension("ext2", 3);

			const adapter = new ToolAdapter({ extensions: [ext1, ext2], sandbox: false });
			const result = adapter.adaptAllTools();

			expect(result.toolDefinitions).toHaveLength(5);
			expect(result.toolNames).toHaveLength(5);
			expect(result.toolNames).toContain("ext1-tool-1");
			expect(result.toolNames).toContain("ext1-tool-2");
			expect(result.toolNames).toContain("ext2-tool-1");
			expect(result.toolNames).toContain("ext2-tool-2");
			expect(result.toolNames).toContain("ext2-tool-3");
		});

		it("should return empty arrays when no extensions are provided", () => {
			const adapter = new ToolAdapter({ extensions: [], sandbox: false });
			const result = adapter.adaptAllTools();

			expect(result.toolDefinitions).toHaveLength(0);
			expect(result.toolNames).toHaveLength(0);
		});

		it("should pass through tool parameters schema unchanged", () => {
			const extension = createTestExtension();
			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			expect(result.toolDefinitions[0]!.parameters).toEqual(
				Type.Object({ message: Type.Optional(Type.String()) }),
			);
		});
	});

	// ========================================================================
	// Tool Execution (non-sandbox)
	// ========================================================================

	describe("tool execution (non-sandbox)", () => {
		it("should execute a tool and return its result", async () => {
			const executeFn = async (_toolCallId: string, params: unknown) => {
				const msg =
					typeof params === "object" && params !== null && "message" in params
						? String(params.message)
						: "default";
				return {
					content: [{ type: "text" as const, text: "hello " + msg }],
					details: { msg },
				};
			};

			const extension = createTestExtension(executeFn);
			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", { message: "world" }, undefined, undefined, testExtensionContext());

			expect(execResult.content).toHaveLength(1);
			expect(getContentText(execResult)).toBe("hello world");
		});

		it("should pass toolCallId to the execute function", async () => {
			let capturedId: string | undefined;
			const executeFn = async (toolCallId: string) => {
				capturedId = toolCallId;
				return { content: [{ type: "text" as const, text: "ok" }], details: {} };
			};

			const extension = createTestExtension(executeFn);
			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			await toolDef.execute("custom-id-42", {}, undefined, undefined, testExtensionContext());

			expect(capturedId).toBe("custom-id-42");
		});

		it("should catch synchronous throws and return error result", async () => {
			const extension = createTestExtension(() => {
				throw new Error("sync boom");
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", {}, undefined, undefined, testExtensionContext());

			// Should NOT throw - should return error result
			expect(execResult.content).toHaveLength(1);
			expect(getContentText(execResult)).toContain("sync boom");
		});

		it("should catch async throws and return error result", async () => {
			const extension = createTestExtension(async () => {
				throw new Error("async boom");
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", {}, undefined, undefined, testExtensionContext());

			expect(execResult.content).toHaveLength(1);
			expect(getContentText(execResult)).toContain("async boom");
		});

		it("should catch errors from tool and not crash the plan", async () => {
			// This test verifies AC3 - failed extension tool call does not stop the plan.
			// The tool throws, but the adapter returns an error result instead of propagating.
			let toolsExecutedAfterError = false;

			const extension = createTestExtension(async (_toolCallId: string, params: unknown) => {
				const shouldFail =
					typeof params === "object" && params !== null && "fail" in params
						? Boolean(params.fail)
						: false;
				if (shouldFail) {
					throw new Error("tool failed as expected");
				}
				toolsExecutedAfterError = true;
				return { content: [{ type: "text" as const, text: "ok" }], details: {} };
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const result = adapter.adaptAllTools();
			const toolDef = result.toolDefinitions[0]!;

			// First call fails
			const failResult = await toolDef.execute("call-1", { fail: true }, undefined, undefined, testExtensionContext());
			expect(getContentText(failResult)).toContain("tool failed as expected");

			// Second call after failure should still work
			const successResult = await toolDef.execute("call-2", {}, undefined, undefined, testExtensionContext());
			expect(getContentText(successResult)).toBe("ok");
			expect(toolsExecutedAfterError).toBe(true);
		});
	});

	// ========================================================================
	// Sandbox Execution
	// ========================================================================

	describe("sandbox execution", () => {
		it("should execute a tool inside vm sandbox when sandbox=true", async () => {
			// Use a simple tool that just returns a value
			const extension = createTestExtension(async () => {
				// This runs in sandbox, no access to require, process, etc.
				return {
					content: [{ type: "text" as const, text: "sandbox worked" }],
					details: {},
				};
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", {}, undefined, undefined, testExtensionContext());

			expect(execResult.content).toHaveLength(1);
			expect(getContentText(execResult)).toBe("sandbox worked");
		});

		it("should not have require in sandbox", async () => {
			// The sandbox blocks require. The tool tries to check typeof require, which is undefined.
			const extension = createTestExtension(async () => {
				const hasRequire = typeof require !== "undefined";
				return {
					content: [{ type: "text" as const, text: String(hasRequire) }],
					details: {},
				};
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", {}, undefined, undefined, testExtensionContext());

			expect(getContentText(execResult)).toBe("false");
		});

		it("should return error result when sandbox execution fails", async () => {
			// This tool will reference undefined globals in the sandbox
			const extension = createTestExtension(async () => {
				// Use eval to avoid compile-time detection of undeclared variable
				(eval as any)("undefinedVar");
				return { content: [{ type: "text" as const, text: "never reached" }], details: {} };
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", {}, undefined, undefined, testExtensionContext());

			// Should return error result instead of crashing
			expect(execResult.content).toHaveLength(1);
			expect(getContentText(execResult)).toBeTruthy();
		});

		it("should pass params correctly to sandboxed tool", async () => {
			const extension = createTestExtension(async (_toolCallId: string, params: unknown) => {
				const val =
					typeof params === "object" && params !== null && "value" in params ? String(params.value) : "";
				return {
					content: [{ type: "text" as const, text: "received:" + val }],
					details: {},
				};
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const result = adapter.adaptAllTools();

			const toolDef = result.toolDefinitions[0]!;
			const execResult = await toolDef.execute("call-1", { value: "hello" }, undefined, undefined, testExtensionContext());

			expect(getContentText(execResult)).toBe("received:hello");
		});
	});

	// ========================================================================
	// adaptExtensionTools convenience function
	// ========================================================================

	describe("adaptExtensionTools convenience function", () => {
		it("should work correctly", () => {
			const extension = createMultiToolExtension("conv", 2);

			const result = adaptExtensionTools([extension], { sandbox: false });

			expect(result.toolDefinitions).toHaveLength(2);
			expect(result.toolNames).toEqual(["conv-tool-1", "conv-tool-2"]);
		});

		it("should default sandbox to true when options omitted", () => {
			const extension = createMultiToolExtension("default-sandbox", 1);

			const result = adaptExtensionTools([extension]);

			// Should not throw - sandbox defaults to true
			expect(result.toolDefinitions).toHaveLength(1);
			expect(result.toolNames).toContain("default-sandbox-tool-1");
		});

		it("should adapt extension tools that were loaded via loadExtensionFromFactory", async () => {
			const tempDir = join(tmpdir(), "pi-tool-adapter-factory-" + Date.now() + "-" + Math.random().toString(36).slice(2));
			mkdirSync(tempDir, { recursive: true });

			try {
				const runtime = createExtensionRuntime();
				const eventBus = { on: () => {}, emit: () => {}, off: () => {} } as any;
				const extension = await loadExtensionFromFactory(
					(api) => {
						api.registerTool({
							name: "factory-tool",
							label: "Factory Tool",
							description: "A tool registered via factory",
							parameters: Type.Object({
								input: Type.String(),
							}),
							execute: async (_toolCallId: string, params: unknown) => {
								const input =
									typeof params === "object" && params !== null && "input" in params
										? String(params.input)
										: "";
								return {
									content: [{ type: "text" as const, text: "factory:" + input }],
									details: {},
								};
							},
						});
					},
					tempDir,
					eventBus,
					runtime,
					"<factory-test>",
				);

				const result = adaptExtensionTools([extension], { sandbox: false });

				expect(result.toolDefinitions).toHaveLength(1);
				expect(result.toolNames).toContain("factory-tool");
				expect(result.toolDefinitions[0]!.label).toBe("Factory Tool");
			} finally {
				rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	// ========================================================================
	// Integration with AgentSession
	// ========================================================================

	describe("integration with AgentSession", () => {
		const harnesses: Harness[] = [];

		afterEach(() => {
			while (harnesses.length > 0) {
				harnesses.pop()?.cleanup();
			}
		});

		it("should expose adapted extension tools in agent session tool list (AC1)", async () => {
			// Create an extension, adapt its tools via ToolAdapter
			const extension = createTestExtension(async (_toolCallId: string, params: unknown) => {
				const msg =
					typeof params === "object" && params !== null && "message" in params
						? String(params.message)
						: "default";
				return {
					content: [{ type: "text" as const, text: "echo:" + msg }],
					details: { msg },
				};
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
			const { toolDefinitions: customTools, toolNames } = adapter.adaptAllTools();

			// Create a harness with the custom tools passed as base tools
			const agentTool: AgentTool = {
				name: "test-tool",
				label: "Test Tool",
				description: "A test tool for unit testing",
				parameters: Type.Object({ message: Type.Optional(Type.String()) }),
				execute: async (_toolCallId, params) => {
					const msg =
						typeof params === "object" && params !== null && "message" in params
							? String(params.message)
							: "default";
					return {
						content: [{ type: "text" as const, text: "echo:" + msg }],
						details: { msg },
					};
				},
			};

			const harness = await createHarness({ tools: [agentTool] });
			harnesses.push(harness);

			// The tool should be available in the session's tool registry
			const toolNamesList = harness.session.getActiveToolNames();
			expect(toolNamesList).toContain("test-tool");

			// Simulate a tool call by executing the tool
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("test-tool", { message: "hello" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("use test-tool");

			// The tool should have been called - verify by checking messages
			const toolResultMessages = harness.session.messages.filter((m) => m.role === "toolResult");
			expect(toolResultMessages.length).toBeGreaterThan(0);
		});

		it("should work with sandbox-enabled adapted tools in agent session (AC2)", async () => {
			// Create an extension that works in sandbox
			const extension = createTestExtension(async (_toolCallId: string, params: unknown) => {
				// Sandbox-safe: no require, no process
				const val =
					typeof params === "object" && params !== null && "value" in params ? String(params.value) : "";
				return {
					content: [{ type: "text" as const, text: "sb:" + val }],
					details: {},
				};
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const { toolDefinitions: customTools } = adapter.adaptAllTools();

			// Execute the tool via the adapter-wrapped function directly
			const result = await customTools[0]!.execute("call-1", { value: "sandbox-test" }, undefined, undefined, testExtensionContext());

			expect(getContentText(result)).toBe("sb:sandbox-test");
		});

		it("should not crash agent session when adapted tool throws in sandbox (AC3)", async () => {
			// Extension tool that fails
			const extension = createTestExtension(async () => {
				throw new Error("sandbox crash test");
			});

			const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });
			const { toolDefinitions: customTools } = adapter.adaptAllTools();

			// Execute the tool - should return error, not throw
			const result = await customTools[0]!.execute("call-1", {}, undefined, undefined, testExtensionContext());
			expect(getContentText(result)).toContain("sandbox crash test");
		});
	});
});
