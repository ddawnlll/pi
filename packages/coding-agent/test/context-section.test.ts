/**
 * Context Section Classification Tests - 5.5.B
 *
 * Acceptance criteria:
 * 1. Context sections are classified by cacheability
 * 2. Logs/timestamps/retry data stay out of prefix
 * 3. Worker context report shows static/dynamic token split
 * 4. Token budget gateway still applies
 * 5. Context classification tests pass
 */

import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import { ContextBuilder } from "../src/context/context-builder.js";
import {
	type Cacheability,
	type ContextSection,
	classifySection,
	estimateTokenCount,
	hashString,
	isCacheable,
	isDynamic,
	isStaticCacheable,
	SECTION_CACHEABILITY,
	summarizeMessageContent,
} from "../src/context/context-section.js";
import { BudgetExceededError, ContextBudgetEnforcer } from "../src/core/context-budget.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(text: string, timestamp = 1000): Message {
	return { role: "user", content: text, timestamp };
}

function makeAssistantMessage(text: string, timestamp = 1000): Message {
	return {
		role: "assistant",
		content: [{ type: "text" as const, text }],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function makeTool(name: string, description = `Description of ${name}`): Tool<TSchema> {
	return { name, description, parameters: { type: "object" } } as unknown as Tool<TSchema>;
}

function makeSystemPrompt(date?: string, cwd?: string): string {
	const parts = [
		"You are an expert coding assistant.",
		"",
		"Available tools: read, bash, edit, write, grep, ls, find",
		"",
		"Guidelines:",
		"- Be concise",
		"- Use meaningful variable names",
	];
	if (date) parts.push("", `Current date: ${date}`);
	if (cwd) parts.push(`Current working directory: ${cwd}`);
	return parts.join("\n");
}

function makeContext(overrides?: Partial<Context>): Context {
	return {
		systemPrompt: makeSystemPrompt("2026-05-14", "/Users/hootie/src/pi"),
		tools: [makeTool("read"), makeTool("bash")],
		messages: [makeUserMessage("hello")],
		...overrides,
	};
}

// -----------------------------------------------------------------------
// context-section.ts Unit Tests
// -----------------------------------------------------------------------

describe("context-section", () => {
	// -------------------------------------------------------------------
	// AC1: Context sections are classified by cacheability
	// -------------------------------------------------------------------
	describe("AC1: classifySection returns correct cacheability for all kinds", () => {
		it("classifies system_prompt as static_cacheable", () => {
			expect(classifySection("system_prompt")).toBe("static_cacheable");
		});

		it("classifies tool_definitions as static_cacheable", () => {
			expect(classifySection("tool_definitions")).toBe("static_cacheable");
		});

		it("classifies safety_policy as static_cacheable", () => {
			expect(classifySection("safety_policy")).toBe("static_cacheable");
		});

		it("classifies edit_strategy_policy as static_cacheable", () => {
			expect(classifySection("edit_strategy_policy")).toBe("static_cacheable");
		});

		it("classifies completion_gate_rules as static_cacheable", () => {
			expect(classifySection("completion_gate_rules")).toBe("static_cacheable");
		});

		it("classifies execution_contract as static_cacheable", () => {
			expect(classifySection("execution_contract")).toBe("static_cacheable");
		});

		it("classifies stable_project_conventions as static_cacheable", () => {
			expect(classifySection("stable_project_conventions")).toBe("static_cacheable");
		});

		it("classifies pinned_messages as semi_static_cacheable", () => {
			expect(classifySection("pinned_messages")).toBe("semi_static_cacheable");
		});

		it("classifies resource_loader_context as semi_static_cacheable", () => {
			expect(classifySection("resource_loader_context")).toBe("semi_static_cacheable");
		});

		it("classifies current_date as dynamic_non_cacheable", () => {
			expect(classifySection("current_date")).toBe("dynamic_non_cacheable");
		});

		it("classifies current_directory as dynamic_non_cacheable", () => {
			expect(classifySection("current_directory")).toBe("dynamic_non_cacheable");
		});

		it("classifies project_context_files as dynamic_non_cacheable", () => {
			expect(classifySection("project_context_files")).toBe("dynamic_non_cacheable");
		});

		it("classifies skills_content as dynamic_non_cacheable", () => {
			expect(classifySection("skills_content")).toBe("dynamic_non_cacheable");
		});

		it("classifies extension_append as dynamic_non_cacheable", () => {
			expect(classifySection("extension_append")).toBe("dynamic_non_cacheable");
		});

		it("classifies recent_messages as dynamic_non_cacheable", () => {
			expect(classifySection("recent_messages")).toBe("dynamic_non_cacheable");
		});

		it("classifies unknown kinds as dynamic_non_cacheable (safe default)", () => {
			expect(classifySection("unknown_thing")).toBe("dynamic_non_cacheable");
		});

		it("SECTION_CACHEABILITY map contains all expected keys and no stale entries", () => {
			const expectedKinds = [
				"system_prompt",
				"tool_definitions",
				"safety_policy",
				"edit_strategy_policy",
				"completion_gate_rules",
				"execution_contract",
				"stable_project_conventions",
				"pinned_messages",
				"resource_loader_context",
				"current_date",
				"current_directory",
				"project_context_files",
				"skills_content",
				"extension_append",
				"recent_messages",
				"latest_tool_result",
				"retry_state",
				"current_diff",
			];

			for (const kind of expectedKinds) {
				expect(SECTION_CACHEABILITY).toHaveProperty(kind);
				const cacheability = SECTION_CACHEABILITY[kind];
				expect(["static_cacheable", "semi_static_cacheable", "dynamic_non_cacheable"]).toContain(cacheability);
			}

			// Verify no extra keys sneak in
			const actualKeys = Object.keys(SECTION_CACHEABILITY).sort();
			expect(actualKeys).toEqual([...expectedKinds].sort());
		});
	});

	// -------------------------------------------------------------------
	// AC2: Logs/timestamps/retry data stay out of prefix
	// -------------------------------------------------------------------
	describe("AC2: logs, timestamps, and retry data stay out of prefix", () => {
		it("retry_state is dynamic_non_cacheable", () => {
			expect(classifySection("retry_state")).toBe("dynamic_non_cacheable");
		});

		it("latest_tool_result is dynamic_non_cacheable", () => {
			expect(classifySection("latest_tool_result")).toBe("dynamic_non_cacheable");
		});

		it("current_date is dynamic_non_cacheable", () => {
			expect(classifySection("current_date")).toBe("dynamic_non_cacheable");
		});

		it("current_directory is dynamic_non_cacheable", () => {
			expect(classifySection("current_directory")).toBe("dynamic_non_cacheable");
		});

		it("recent_messages containing tool results/retries are dynamic", () => {
			const builder = new ContextBuilder();
			const context = makeContext({
				systemPrompt: makeSystemPrompt("2026-05-14", "/home/user/project"),
				messages: [
					makeUserMessage("initial request"),
					makeAssistantMessage("I'll run the command"),
					{
						role: "user",
						content: "Tool ran without errors or output",
					} as Message,
					{
						role: "assistant",
						content: "Retrying after error...",
					} as unknown as Message,
				],
			});

			const result = builder.build(context, { pinnedMessageCount: 0 });

			// All dynamic sections should be classified as dynamic
			const dynamicSections = result.sections.filter((s) => s.cacheability === "dynamic_non_cacheable");
			const dynamicKinds = dynamicSections.map((s) => s.kind);
			expect(dynamicKinds).toContain("current_date");
			expect(dynamicKinds).toContain("current_directory");

			// Recent messages (which include tool results and retries) are dynamic
			const recentSection = result.sections.find((s) => s.kind === "recent_messages");
			expect(recentSection).toBeDefined();
			expect(recentSection!.cacheability).toBe("dynamic_non_cacheable");
		});

		it("static sections do not contain date, cwd, or retry data", () => {
			const builder = new ContextBuilder();
			const context = makeContext({
				systemPrompt: makeSystemPrompt("2026-05-14", "/tmp/workspace"),
				messages: [
					makeUserMessage("pinned message"),
					{ role: "assistant", content: "retry result" } as unknown as Message,
				],
			});

			const result = builder.build(context, { pinnedMessageCount: 0 });

			// Static sections should NOT contain dynamic content
			const staticSections = result.sections.filter((s) => s.cacheability === "static_cacheable");
			for (const section of staticSections) {
				expect(section.content).not.toContain("Current date:");
				expect(section.content).not.toContain("Current working directory:");
				expect(section.kind).not.toBe("retry_state");
				expect(section.kind).not.toBe("latest_tool_result");
			}
		});

		it("per-turn tool results in recent messages are dynamic", () => {
			const builder = new ContextBuilder();
			const context = makeContext({
				systemPrompt: makeSystemPrompt("2026-05-14", "/home/user"),
				messages: [
					makeUserMessage("run the test"),
					{
						role: "assistant",
						content: [{ type: "text", text: "Tool execution result: passed" }],
						api: "faux",
						provider: "faux",
						model: "faux",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
						stopReason: "stop",
						timestamp: 1000,
					} as unknown as Message,
				],
			});

			const result = builder.build(context);

			// Recent messages with tool results are dynamic
			const recentSection = result.sections.find((s) => s.kind === "recent_messages");
			expect(recentSection).toBeDefined();
			expect(recentSection!.cacheability).toBe("dynamic_non_cacheable");

			// But the system prompt and tools are still static
			const staticSection = result.sections.find((s) => s.kind === "system_prompt");
			expect(staticSection).toBeDefined();
			expect(staticSection!.cacheability).toBe("static_cacheable");
		});
	});

	// -------------------------------------------------------------------
	// isCacheable / isStaticCacheable / isDynamic utility functions
	// -------------------------------------------------------------------
	describe("classification helper functions", () => {
		const makeSection = (cacheability: Cacheability): ContextSection => ({
			kind: "test",
			content: "content",
			cacheability,
			priority: 0,
			tokenEstimate: 10,
			source: "test",
			hash: "abc",
		});

		it("isCacheable returns true for static_cacheable", () => {
			expect(isCacheable(makeSection("static_cacheable"))).toBe(true);
		});

		it("isCacheable returns true for semi_static_cacheable", () => {
			expect(isCacheable(makeSection("semi_static_cacheable"))).toBe(true);
		});

		it("isCacheable returns false for dynamic_non_cacheable", () => {
			expect(isCacheable(makeSection("dynamic_non_cacheable"))).toBe(false);
		});

		it("isStaticCacheable returns true only for static_cacheable", () => {
			expect(isStaticCacheable(makeSection("static_cacheable"))).toBe(true);
			expect(isStaticCacheable(makeSection("semi_static_cacheable"))).toBe(false);
			expect(isStaticCacheable(makeSection("dynamic_non_cacheable"))).toBe(false);
		});

		it("isDynamic returns true only for dynamic_non_cacheable", () => {
			expect(isDynamic(makeSection("dynamic_non_cacheable"))).toBe(true);
			expect(isDynamic(makeSection("static_cacheable"))).toBe(false);
			expect(isDynamic(makeSection("semi_static_cacheable"))).toBe(false);
		});
	});

	// -------------------------------------------------------------------
	// Utility functions
	// -------------------------------------------------------------------
	describe("utility functions", () => {
		it("hashString produces deterministic output", () => {
			expect(hashString("hello")).toBe(hashString("hello"));
			expect(hashString("world")).toBe(hashString("world"));
		});

		it("hashString produces different output for different inputs", () => {
			expect(hashString("hello")).not.toBe(hashString("world"));
		});

		it("estimateTokenCount estimates 1 token per 4 chars", () => {
			expect(estimateTokenCount("abc")).toBe(1); // 3/4 ≈ 0.75 → 1
			expect(estimateTokenCount("abcd")).toBe(1); // 4/4 = 1
			expect(estimateTokenCount("abcde")).toBe(2); // 5/4 ≈ 1.25 → 2
		});

		it("estimateTokenCount returns 0 for empty string", () => {
			expect(estimateTokenCount("")).toBe(0);
		});

		it("summarizeMessageContent truncates string content", () => {
			const long = "a".repeat(200);
			expect(summarizeMessageContent(long)).toBe("a".repeat(80));
		});

		it("summarizeMessageContent handles content blocks", () => {
			const blocks = [{ type: "text" as const, text: "Hello world" }];
			expect(summarizeMessageContent(blocks)).toBe("Hello world");
		});

		it("summarizeMessageContent handles non-text blocks", () => {
			const blocks = [
				{ type: "text" as const, text: "Hello" },
				{ type: "tool_use" as const, id: "abc", name: "read", input: {} },
			];
			expect(summarizeMessageContent(blocks)).toBe("Hello");
		});

		it("summarizeMessageContent handles empty blocks", () => {
			expect(summarizeMessageContent([])).toBe("");
		});
	});
});

// -----------------------------------------------------------------------
// ContextBuilder Tests
// -----------------------------------------------------------------------

describe("ContextBuilder", () => {
	// -------------------------------------------------------------------
	// AC1: Context sections are classified by cacheability (integration)
	// -------------------------------------------------------------------
	describe("AC1: builds classified sections (integration)", () => {
		const builder = new ContextBuilder();

		it("build returns sections with cacheability for a full context", () => {
			const context = makeContext();
			const result = builder.build(context);

			expect(result.sections.length).toBeGreaterThanOrEqual(4); // sys_prompt, date, cwd, tools, messages

			for (const section of result.sections) {
				expect(section).toHaveProperty("kind");
				expect(section).toHaveProperty("content");
				expect(section).toHaveProperty("cacheability");
				expect(section).toHaveProperty("priority");
				expect(section).toHaveProperty("tokenEstimate");
				expect(section).toHaveProperty("source");
				expect(section).toHaveProperty("hash");
			}
		});

		it("system_prompt is classified as static_cacheable", () => {
			const result = builder.build(makeContext());
			const section = result.sections.find((s) => s.kind === "system_prompt");
			expect(section).toBeDefined();
			expect(section!.cacheability).toBe("static_cacheable");
		});

		it("tool_definitions is classified as static_cacheable", () => {
			const result = builder.build(makeContext());
			const section = result.sections.find((s) => s.kind === "tool_definitions");
			expect(section).toBeDefined();
			expect(section!.cacheability).toBe("static_cacheable");
		});

		it("current_date and current_directory are classified as dynamic", () => {
			const context = makeContext();
			const result = builder.build(context);

			const dateSection = result.sections.find((s) => s.kind === "current_date");
			expect(dateSection).toBeDefined();
			expect(dateSection!.cacheability).toBe("dynamic_non_cacheable");

			const cwdSection = result.sections.find((s) => s.kind === "current_directory");
			expect(cwdSection).toBeDefined();
			expect(cwdSection!.cacheability).toBe("dynamic_non_cacheable");
		});

		it("pinned messages are semi_static_cacheable", () => {
			const context = makeContext({
				messages: [makeUserMessage("pin1"), makeUserMessage("pin2"), makeUserMessage("recent")],
			});
			const result = builder.build(context, { pinnedMessageCount: 2 });

			const pinned = result.sections.find((s) => s.kind === "pinned_messages");
			expect(pinned).toBeDefined();
			expect(pinned!.cacheability).toBe("semi_static_cacheable");
		});

		it("recent messages are dynamic_non_cacheable", () => {
			const context = makeContext({
				messages: [makeUserMessage("pinned"), makeUserMessage("recent")],
			});
			const result = builder.build(context, { pinnedMessageCount: 1 });

			const recent = result.sections.find((s) => s.kind === "recent_messages");
			expect(recent).toBeDefined();
			expect(recent!.cacheability).toBe("dynamic_non_cacheable");
		});
	});

	// -------------------------------------------------------------------
	// AC3: Worker context report shows static/dynamic token split
	// -------------------------------------------------------------------
	describe("AC3: report shows static/dynamic token split", () => {
		const builder = new ContextBuilder();

		it("result includes staticTokens, semiStaticTokens, dynamicTokens", () => {
			const result = builder.build(makeContext());
			expect(typeof result.staticTokens).toBe("number");
			expect(typeof result.semiStaticTokens).toBe("number");
			expect(typeof result.dynamicTokens).toBe("number");
			expect(result.totalTokens).toBe(result.staticTokens + result.semiStaticTokens + result.dynamicTokens);
		});

		it("report string contains token split information", () => {
			const result = builder.build(makeContext());
			expect(result.report).toContain("Token Split:");
			expect(result.report).toContain("Static:");
			expect(result.report).toContain("Semi-Static:");
			expect(result.report).toContain("Dynamic:");
			expect(result.report).toContain("Total:");
		});

		it("report shows each section with cacheability tag and token count", () => {
			const result = builder.build(makeContext());
			expect(result.report).toContain("[STATIC]");
			expect(result.report).toContain("[DYNAMIC]");
			// Each section should have its token estimate in the report
			for (const section of result.sections) {
				expect(result.report).toContain(`~${section.tokenEstimate}t`);
			}
		});

		it("static + semi + dynamic = total for various contexts", () => {
			const contexts: Context[] = [
				makeContext({ systemPrompt: "Short.", tools: [], messages: [] }),
				makeContext({
					systemPrompt: makeSystemPrompt("2026-01-01", "/tmp"),
					tools: [makeTool("a"), makeTool("b"), makeTool("c"), makeTool("d"), makeTool("e")],
					messages: [
						makeUserMessage("m1"),
						makeAssistantMessage("a1"),
						makeUserMessage("m2"),
						makeAssistantMessage("a2"),
					],
				}),
				makeContext({ systemPrompt: "", tools: [], messages: [] }),
			];

			for (const context of contexts) {
				const result = builder.build(context);
				expect(result.totalTokens).toBe(result.staticTokens + result.semiStaticTokens + result.dynamicTokens);
			}
		});

		it("report includes Budget Check section", () => {
			const result = builder.build(makeContext());
			expect(result.report).toContain("Budget Check:");
			expect(result.report).toContain("PASS");
		});

		it("can generate report for empty context without error", () => {
			const result = builder.build({ systemPrompt: "", tools: [], messages: [] });
			expect(result.report).toContain("Context Classification Report");
		});

		it("report percentages are reasonable", () => {
			const result = builder.build(makeContext());
			// Static percentage should be meaningful for a typical context
			expect(result.staticTokens).toBeGreaterThan(0);
			expect(result.dynamicTokens).toBeGreaterThan(0);
		});
	});

	// -------------------------------------------------------------------
	// AC4: Token budget gateway still applies
	// -------------------------------------------------------------------
	describe("AC4: token budget gateway applies", () => {
		it("build returns budgetCheck with passed status", () => {
			const builder = new ContextBuilder();
			const result = builder.build(makeContext());
			expect(result.budgetCheck).toBeDefined();
			expect(result.budgetCheck.passed).toBe(true);
			expect(result.passesBudget).toBe(true);
		});

		it("over-budget context is blocked for worker role", () => {
			const enforcer = new ContextBudgetEnforcer();
			enforcer.updateSettings({ worker: 1 }); // Very tiny budget
			const builder = new ContextBuilder(enforcer);

			const result = builder.build(makeContext());
			expect(result.passesBudget).toBe(false);
			expect(result.budgetCheck.passed).toBe(false);
			expect(result.budgetCheck.reason).toContain("exceed");
		});

		it("buildOrThrow throws BudgetExceededError when over budget", () => {
			const enforcer = new ContextBudgetEnforcer();
			enforcer.updateSettings({ worker: 1 });
			const builder = new ContextBuilder(enforcer);

			expect(() => builder.buildOrThrow(makeContext())).toThrow(BudgetExceededError);
		});

		it("buildOrThrow returns result when within budget", () => {
			const builder = new ContextBuilder();
			const result = builder.buildOrThrow(makeContext());
			expect(result.passesBudget).toBe(true);
		});

		it("maxAuto still blocks without --expensive-context-1m flag", () => {
			const enforcer = new ContextBudgetEnforcer();
			const builder = new ContextBuilder(enforcer);

			// Build a context that exceeds maxAuto
			const largeSystemPrompt = "A".repeat(300000); // ~75000 tokens
			const context = makeContext({
				systemPrompt: largeSystemPrompt,
				messages: [],
				tools: [],
			});

			const result = builder.build(context);
			expect(result.passesBudget).toBe(false);
			expect(result.budgetCheck.requiresEscalation).toBe(true);
			expect(result.budgetCheck.reason).toContain("--expensive-context-1m");
		});

		it("maxAuto bypasses with millionContextEnabled", () => {
			const enforcer = new ContextBudgetEnforcer();
			enforcer.updateSettings({ millionContextEnabled: true });
			const builder = new ContextBuilder(enforcer);

			const largeSystemPrompt = "A".repeat(300000); // ~75000 tokens
			const context = makeContext({
				systemPrompt: largeSystemPrompt,
				messages: [],
				tools: [],
			});

			const result = builder.build(context);
			expect(result.passesBudget).toBe(true);
			expect(result.budgetCheck.requiresEscalation).toBe(true);
		});

		it("budget is role-aware", () => {
			const builder = new ContextBuilder();

			// Flash has lower budget than worker
			const largeContext = makeContext({
				systemPrompt: "A".repeat(20000), // ~5000 tokens
				messages: [],
				tools: [],
			});

			// Flash budget is 4000, so this should fail for flash
			const flashResult = builder.build(largeContext, { role: "flash" });
			// Worker budget is 12000, so this should pass for worker
			const workerResult = builder.build(largeContext, { role: "worker" });

			expect(flashResult.passesBudget).toBe(false);
			expect(workerResult.passesBudget).toBe(true);
		});
	});

	// -------------------------------------------------------------------
	// AC5: Context classification tests pass (integration scenarios)
	// -------------------------------------------------------------------
	describe("AC5: integration scenarios", () => {
		const builder = new ContextBuilder();

		it("full context with all section types produces correct classification", () => {
			const context: Context = {
				systemPrompt: makeSystemPrompt("2026-05-14", "/home/user/project"),
				tools: [makeTool("read"), makeTool("bash"), makeTool("edit")],
				messages: [
					makeUserMessage("pinned Q1"),
					makeAssistantMessage("pinned A1"),
					makeUserMessage("What is the status?"),
					makeAssistantMessage("The status is good."),
				],
			};

			const result = builder.build(context, { pinnedMessageCount: 2 });

			// Check all expected sections exist
			const kinds = result.sections.map((s) => s.kind);
			expect(kinds).toContain("system_prompt");
			expect(kinds).toContain("current_date");
			expect(kinds).toContain("current_directory");
			expect(kinds).toContain("tool_definitions");
			expect(kinds).toContain("pinned_messages");
			expect(kinds).toContain("recent_messages");

			// Verify cacheability assignments
			expect(result.sections.find((s) => s.kind === "system_prompt")!.cacheability).toBe("static_cacheable");
			expect(result.sections.find((s) => s.kind === "tool_definitions")!.cacheability).toBe("static_cacheable");
			expect(result.sections.find((s) => s.kind === "pinned_messages")!.cacheability).toBe("semi_static_cacheable");
			expect(result.sections.find((s) => s.kind === "current_date")!.cacheability).toBe("dynamic_non_cacheable");
			expect(result.sections.find((s) => s.kind === "current_directory")!.cacheability).toBe(
				"dynamic_non_cacheable",
			);
			expect(result.sections.find((s) => s.kind === "recent_messages")!.cacheability).toBe("dynamic_non_cacheable");

			// Verify token accounting
			expect(result.totalTokens).toBe(result.staticTokens + result.semiStaticTokens + result.dynamicTokens);
			expect(result.staticTokens).toBeGreaterThan(0);
			expect(result.dynamicTokens).toBeGreaterThan(0);
		});

		it("retry_state and latest_tool_result are always dynamic", () => {
			const section: ContextSection = {
				kind: "retry_state",
				content: "retry-count: 3",
				cacheability: classifySection("retry_state"),
				priority: 100,
				tokenEstimate: 5,
				source: "retry handler",
				hash: "abc",
			};

			expect(classifySection("retry_state")).toBe("dynamic_non_cacheable");
			expect(section.cacheability).toBe("dynamic_non_cacheable");

			const toolResultSection: ContextSection = {
				kind: "latest_tool_result",
				content: "tool output",
				cacheability: classifySection("latest_tool_result"),
				priority: 100,
				tokenEstimate: 5,
				source: "tool execution",
				hash: "def",
			};

			expect(classifySection("latest_tool_result")).toBe("dynamic_non_cacheable");
			expect(toolResultSection.cacheability).toBe("dynamic_non_cacheable");
		});

		it("sections are ordered by priority", () => {
			const result = builder.build(makeContext());

			const priorities = result.sections.map((s) => s.priority);
			for (let i = 1; i < priorities.length; i++) {
				expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
			}
		});

		it("empty context produces valid result", () => {
			const result = builder.build({ systemPrompt: "", tools: [], messages: [] });
			expect(result.sections).toHaveLength(0);
			expect(result.totalTokens).toBe(0);
			expect(result.staticTokens).toBe(0);
			expect(result.semiStaticTokens).toBe(0);
			expect(result.dynamicTokens).toBe(0);
			expect(result.passesBudget).toBe(true);
			expect(result.report).toBeTruthy();
		});

		it("updateBudgetSettings affects subsequent builds", () => {
			const builder = new ContextBuilder();
			const largeContext = makeContext({
				systemPrompt: "A".repeat(50000), // ~12500 tokens, exceeds worker budget
				tools: [],
				messages: [],
			});

			// First build: blocked by default worker budget
			const blockedResult = builder.build(largeContext, { role: "worker" });
			expect(blockedResult.passesBudget).toBe(false);

			// Increase worker budget
			builder.updateBudgetSettings({ worker: 20000 });

			// Second build: passes with higher budget
			const passedResult = builder.build(largeContext, { role: "worker" });
			expect(passedResult.passesBudget).toBe(true);
		});

		it("context with no dynamic sections still shows correct split", () => {
			const context: Context = {
				systemPrompt: "Static only. No date or cwd.",
				tools: [],
				messages: [],
			};

			const result = builder.build(context);
			expect(result.dynamicTokens).toBe(0);
			expect(result.staticTokens).toBeGreaterThan(0);
			expect(result.semiStaticTokens).toBe(0);
			expect(result.totalTokens).toBe(result.staticTokens);
		});
	});

	// -------------------------------------------------------------------
	// Edge cases
	// -------------------------------------------------------------------
	describe("edge cases", () => {
		const builder = new ContextBuilder();

		it("handles undefined system prompt", () => {
			const result = builder.build({ messages: [makeUserMessage("hi")] });
			expect(result.passesBudget).toBe(true);
		});

		it("handles undefined tools", () => {
			const result = builder.build({ systemPrompt: "Sys", messages: [] });
			expect(result.passesBudget).toBe(true);
		});

		it("handles undefined messages", () => {
			const result = builder.build({ systemPrompt: "Sys" } as Context);
			expect(result.passesBudget).toBe(true);
		});

		it("handles large pinnedMessageCount gracefully", () => {
			const result = builder.build(makeContext({ messages: [makeUserMessage("a"), makeUserMessage("b")] }), {
				pinnedMessageCount: 100,
			});

			// All messages become pinned
			const pinnedSection = result.sections.find((s) => s.kind === "pinned_messages");
			expect(pinnedSection).toBeDefined();
			expect(result.sections.find((s) => s.kind === "recent_messages")).toBeUndefined();
		});

		it("handles zero pinnedMessageCount", () => {
			const result = builder.build(makeContext({ messages: [makeUserMessage("a"), makeUserMessage("b")] }), {
				pinnedMessageCount: 0,
			});

			expect(result.sections.find((s) => s.kind === "pinned_messages")).toBeUndefined();
			const recentSection = result.sections.find((s) => s.kind === "recent_messages");
			expect(recentSection).toBeDefined();
		});

		it("handles null-like empty system prompt", () => {
			const result = builder.build({ systemPrompt: "", tools: [], messages: [] });
			expect(result.sections).toHaveLength(0);
			expect(result.totalTokens).toBe(0);
		});
	});
});
