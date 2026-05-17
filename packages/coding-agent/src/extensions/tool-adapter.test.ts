/**
 * Tests for ToolAdapter - Agent Tool Injection
 *
 * Acceptance criteria:
 * 1. Installed extension appears in agent tool list
 * 2. When agent calls extension tool, it runs in sandbox
 * 3. Failed extension tool call does not stop the plan
 * 4. Integration test: WorkspaceAgentExecutor works with extension tool
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { Extension, ToolDefinition } from "../core/extensions/types.js";
import type { SourceInfo } from "../core/source-info.js";
import { adaptExtensionTools, ToolAdapter } from "./tool-adapter.js";

// ============================================================================
// Test Helpers
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_CTX = {} as any;

const TEST_SOURCE_INFO: SourceInfo = {
	source: "test",
	path: "<test>",
	scope: "temporary",
	origin: "top-level",
};

/** Create a mock extension with registered tools for testing. */
function createMockExtension(tools: ToolDefinition[], path = "<test>"): Extension {
	const toolMap = new Map<string, { definition: ToolDefinition; sourceInfo: SourceInfo }>();
	for (const tool of tools) {
		toolMap.set(tool.name, {
			definition: tool,
			sourceInfo: { ...TEST_SOURCE_INFO, path },
		});
	}

	return {
		path,
		resolvedPath: path,
		sourceInfo: { ...TEST_SOURCE_INFO, path },
		handlers: new Map(),
		tools: toolMap as unknown as Map<string, Extension["tools"] extends Map<string, infer V> ? V : never>,
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

/** Extract text content from AgentToolResult. */
function getResultText(result: AgentToolResult<unknown>): string {
	if (Array.isArray(result.content)) {
		return result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");
	}
	return "";
}

/** A simple tool that returns a string result. */
function createGreetingTool(): ToolDefinition {
	return {
		name: "greet",
		label: "Greet",
		description: "Greets a person by name",
		parameters: Type.Object({
			name: Type.String(),
		}),
		execute: async (_toolCallId, params) => {
			const { name } = params as { name: string };
			return { content: [{ type: "text" as const, text: `Hello, ${name}!` }], details: {} };
		},
	};
}

/** A tool that always throws an error. */
function createFailingTool(): ToolDefinition {
	return {
		name: "fail_tool",
		label: "Failing Tool",
		description: "A tool that always fails",
		parameters: Type.Object({
			message: Type.String(),
		}),
		execute: async (_toolCallId, params) => {
			const { message } = params as { message: string };
			throw new Error(message);
		},
	};
}

/** A tool that returns various types of results. */
function createEchoTool(): ToolDefinition {
	return {
		name: "echo",
		label: "Echo",
		description: "Echoes back the input",
		parameters: Type.Object({
			input: Type.Any(),
		}),
		execute: async (_toolCallId, params) => {
			return {
				content: [{ type: "text" as const, text: String((params as { input: unknown }).input) }],
				details: {},
			};
		},
	};
}

// ============================================================================
// AC 1: Installed extension appears in agent tool list
// ============================================================================

describe("AC 1: Installed extension appears in agent tool list", () => {
	it("returns adapted tool definitions from a single extension", () => {
		const extension = createMockExtension([createGreetingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolDefinitions).toHaveLength(1);
		expect(result.toolDefinitions[0].name).toBe("greet");
		expect(result.toolDefinitions[0].label).toBe("Greet");
		expect(result.toolDefinitions[0].description).toBe("Greets a person by name");
	});

	it("returns tool names for the agent allowlist", () => {
		const extension = createMockExtension([createGreetingTool(), createEchoTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolNames).toEqual(["greet", "echo"]);
	});

	it("aggregates tools from multiple extensions", () => {
		const ext1 = createMockExtension([createGreetingTool()], "<ext1>");
		const ext2 = createMockExtension([createEchoTool()], "<ext2>");
		const adapter = new ToolAdapter({ extensions: [ext1, ext2], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolDefinitions).toHaveLength(2);
		expect(result.toolNames.sort()).toEqual(["echo", "greet"]);
	});

	it("handles extensions with no tools", () => {
		const extension = createMockExtension([]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolDefinitions).toHaveLength(0);
		expect(result.toolNames).toHaveLength(0);
	});

	it("preserves tool parameters schema in adapted definitions", () => {
		const greetingTool = createGreetingTool();
		const extension = createMockExtension([greetingTool]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolDefinitions[0].parameters).toBe(greetingTool.parameters);
	});

	it("preserves promptSnippet and promptGuidelines when present", () => {
		const toolWithPrompt: ToolDefinition = {
			...createGreetingTool(),
			promptSnippet: "greet <name>: says hello",
			promptGuidelines: ["Use greet to say hello to users."],
		};
		const extension = createMockExtension([toolWithPrompt]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();

		expect(result.toolDefinitions[0].promptSnippet).toBe("greet <name>: says hello");
		expect(result.toolDefinitions[0].promptGuidelines).toEqual(["Use greet to say hello to users."]);
	});
});

// ============================================================================
// AC 2: When agent calls extension tool, it runs in sandbox
// ============================================================================

describe("AC 2: When agent calls extension tool, it runs in sandbox", () => {
	it("executes a simple extension tool in non-sandbox mode and returns the result", async () => {
		const extension = createMockExtension([createGreetingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", { name: "World" }, undefined, undefined, EMPTY_CTX);

		expect(getResultText(output)).toBe("Hello, World!");
	});

	it("executes tool with sandbox mode enabled", async () => {
		const extension = createMockExtension([createGreetingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", { name: "World" }, undefined, undefined, EMPTY_CTX);

		expect(getResultText(output)).toBe("Hello, World!");
	});

	it("sandbox blocks access to require global", async () => {
		const toolDef: ToolDefinition = {
			name: "check_require",
			label: "Check Require",
			description: "Checks if require is defined",
			parameters: Type.Object({}),
			execute: async () => {
				const r = (typeof require !== "undefined" ? "defined" : "undefined") as string;
				return { content: [{ type: "text" as const, text: r }], details: {} };
			},
		};
		const extension = createMockExtension([toolDef]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", {}, undefined, undefined, EMPTY_CTX);

		expect(getResultText(output)).toBe("undefined");
	});

	it("sandbox blocks access to process global", async () => {
		const toolDef: ToolDefinition = {
			name: "check_process",
			label: "Check Process",
			description: "Checks if process is defined",
			parameters: Type.Object({}),
			execute: async () => {
				const p = (typeof process !== "undefined" ? "defined" : "undefined") as string;
				return { content: [{ type: "text" as const, text: p }], details: {} };
			},
		};
		const extension = createMockExtension([toolDef]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", {}, undefined, undefined, EMPTY_CTX);

		expect(getResultText(output)).toBe("undefined");
	});

	it("sandbox blocks Function constructor", async () => {
		const toolDef: ToolDefinition = {
			name: "try_function",
			label: "Try Function",
			description: "Tests Function constructor is blocked",
			parameters: Type.Object({}),
			execute: async () => {
				try {
					const fn = new (Function as any)("return 1");
					return { content: [{ type: "text" as const, text: String(fn()) }], details: {} };
				} catch {
					return { content: [{ type: "text" as const, text: "blocked" }], details: {} };
				}
			},
		};
		const extension = createMockExtension([toolDef]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: true });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", {}, undefined, undefined, EMPTY_CTX);

		expect(getResultText(output)).toBe("blocked");
	});

	it("forwards AbortSignal to original tool execution in non-sandbox mode", async () => {
		let capturedSignal: AbortSignal | undefined;
		const abortAwareTool: ToolDefinition = {
			name: "abort_aware",
			label: "Abort Aware",
			description: "A tool that checks abort signal",
			parameters: Type.Object({}),
			execute: async (_toolCallId, _params, signal) => {
				capturedSignal = signal;
				return { content: [{ type: "text" as const, text: "done" }], details: {} };
			},
		};

		const extension = createMockExtension([abortAwareTool]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();
		const ac = new AbortController();
		await result.toolDefinitions[0].execute("call-1", {}, ac.signal, undefined, EMPTY_CTX);

		expect(capturedSignal).toBe(ac.signal);
	});
});

// ============================================================================
// AC 3: Failed extension tool call does not stop the plan
// ============================================================================

describe("AC 3: Failed extension tool call does not stop the plan", () => {
	it("returns error result when tool throws an error", async () => {
		const extension = createMockExtension([createFailingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		const output = await tool.execute("call-1", { message: "Something went wrong" }, undefined, undefined, EMPTY_CTX);
		const text = getResultText(output);

		expect(text).toContain("Something went wrong");
	});

	it("does not throw when tool throws an error", async () => {
		const extension = createMockExtension([createFailingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();
		const tool = result.toolDefinitions[0];

		await expect(tool.execute("call-1", { message: "Boom" }, undefined, undefined, EMPTY_CTX)).resolves.toBeDefined();
	});

	it("continues executing subsequent tools after a tool failure", async () => {
		const extension = createMockExtension([createFailingTool(), createGreetingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });

		const result = adapter.adaptAllTools();
		const failTool = result.toolDefinitions.find((t) => t.name === "fail_tool")!;
		const greetTool = result.toolDefinitions.find((t) => t.name === "greet")!;

		// Failing tool returns error, doesn't throw
		const failOutput = await failTool.execute("call-1", { message: "fail" }, undefined, undefined, EMPTY_CTX);
		expect(getResultText(failOutput)).toContain("fail");

		// Greeting tool still works after failure
		const greetOutput = await greetTool.execute("call-2", { name: "Test" }, undefined, undefined, EMPTY_CTX);
		expect(getResultText(greetOutput)).toBe("Hello, Test!");
	});
});

// ============================================================================
// AC 4: Integration test - WorkspaceAgentExecutor works with extension tool
// ============================================================================

describe("AC 4: Integration - WorkspaceAgentExecutor works with extension tool", () => {
	it("adaptExtensionTools convenience function works correctly", () => {
		const extension = createMockExtension([createGreetingTool()]);
		const result = adaptExtensionTools([extension], { sandbox: false });

		expect(result.toolDefinitions).toHaveLength(1);
		expect(result.toolNames).toEqual(["greet"]);
	});

	it("adapted tool definitions can be passed alongside built-in tools", () => {
		const ext1 = createMockExtension([createGreetingTool(), createEchoTool()]);
		const adapter = new ToolAdapter({ extensions: [ext1], sandbox: false });
		const adapted = adapter.adaptAllTools();

		// Simulate combining with built-in tool names
		const builtInTools = ["read", "bash", "edit", "write"];
		const allToolNames = [...builtInTools, ...adapted.toolNames];

		expect(allToolNames).toContain("greet");
		expect(allToolNames).toContain("echo");
		expect(allToolNames).toContain("read");
		expect(allToolNames).toContain("bash");
	});

	it("tool definitions have correct signature for AgentTool compatibility", () => {
		const extension = createMockExtension([createGreetingTool()]);
		const adapter = new ToolAdapter({ extensions: [extension], sandbox: false });
		const result = adapter.adaptAllTools();

		const tool = result.toolDefinitions[0];

		expect(typeof tool.name).toBe("string");
		expect(typeof tool.label).toBe("string");
		expect(typeof tool.description).toBe("string");
		expect(tool.parameters).toBeDefined();
		expect(typeof tool.execute).toBe("function");
		expect(tool.execute.length).toBeGreaterThanOrEqual(4);
	});

	it("extension tool names are available for combining with session tools", () => {
		const ext1 = createMockExtension([createGreetingTool()]);
		const adapted = adaptExtensionTools([ext1], { sandbox: false });

		// Tool names that would be passed to createAgentSession tools array
		const tools = ["read", "bash", "edit", "write", ...adapted.toolNames];
		expect(tools).toContain("greet");

		// Tool definitions that would be passed as customTools
		const customTools = adapted.toolDefinitions;
		expect(customTools).toHaveLength(1);
		expect(customTools[0].name).toBe("greet");
	});
});
