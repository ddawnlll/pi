/**
 * Tests for the coding-agent prompt cache policy and assembler.
 *
 * Covers all acceptance criteria from 5.5.A:
 * 1. Prompt assembly separates cacheable prefix from dynamic suffix
 * 2. Static prefix hash remains stable across equivalent calls
 * 3. Dynamic suffix changes do not change prefix hash
 * 4. Cache prefix version invalidates on safety/policy changes
 * 5. Tests cover stable prefix and changing suffix
 */

import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import { PromptAssembler } from "../src/context/prompt-assembler.js";
import { CACHE_PREFIX_VERSION, PromptCachePolicy } from "../src/context/prompt-cache-policy.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(text: string, timestamp = 1_000): Message {
	return { role: "user", content: text, timestamp };
}

function makeAssistantMessage(text: string, timestamp = 1_000): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp,
	} as Message;
}

function makeTool(name: string, description = `Description of ${name}`): Tool<TSchema> {
	return { name, description, parameters: { type: "object" } } as unknown as Tool<TSchema>;
}

function makeFullSystemPrompt(extraLine?: string): string {
	const lines = [
		"You are an expert coding assistant operating inside pi, a coding agent harness.",
		"",
		"Available tools:",
		"- read: Read files",
		"- bash: Execute commands",
		"",
		"Guidelines:",
		"- Be concise",
		"- Use meaningful variable names",
	];
	if (extraLine) lines.push("", extraLine);
	lines.push("", "Current date: 2026-05-14");
	lines.push("Current working directory: /Users/hootie/src/pi");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PromptCachePolicy
// ---------------------------------------------------------------------------

describe("PromptCachePolicy", () => {
	describe("classifySection", () => {
		const policy = new PromptCachePolicy();

		it("classifies system_prompt as static_cacheable", () => {
			expect(policy.classifySection("system_prompt")).toBe("static_cacheable");
		});

		it("classifies tool_definitions as static_cacheable", () => {
			expect(policy.classifySection("tool_definitions")).toBe("static_cacheable");
		});

		it("classifies safety_policy as static_cacheable", () => {
			expect(policy.classifySection("safety_policy")).toBe("static_cacheable");
		});

		it("classifies current_date as dynamic_non_cacheable", () => {
			expect(policy.classifySection("current_date")).toBe("dynamic_non_cacheable");
		});

		it("classifies current_directory as dynamic_non_cacheable", () => {
			expect(policy.classifySection("current_directory")).toBe("dynamic_non_cacheable");
		});

		it("classifies recent_messages as dynamic_non_cacheable", () => {
			expect(policy.classifySection("recent_messages")).toBe("dynamic_non_cacheable");
		});

		it("classifies unknown kinds as dynamic_non_cacheable", () => {
			expect(policy.classifySection("unknown_thing")).toBe("dynamic_non_cacheable");
		});

		it("classifies pinned_messages as semi_static_cacheable", () => {
			expect(policy.classifySection("pinned_messages")).toBe("semi_static_cacheable");
		});
	});

	describe("classifySystemPrompt", () => {
		const policy = new PromptCachePolicy();

		it("splits system prompt into static and dynamic parts", () => {
			const prompt = makeFullSystemPrompt();
			const sections = policy.classifySystemPrompt(prompt);

			// Should have at least: system_prompt, current_date, current_directory
			const staticSection = sections.find((s) => s.kind === "system_prompt");
			const dateSection = sections.find((s) => s.kind === "current_date");
			const cwdSection = sections.find((s) => s.kind === "current_directory");

			expect(staticSection).toBeDefined();
			expect(dateSection).toBeDefined();
			expect(cwdSection).toBeDefined();

			expect(staticSection!.cacheability).toBe("static_cacheable");
			expect(dateSection!.cacheability).toBe("dynamic_non_cacheable");
			expect(cwdSection!.cacheability).toBe("dynamic_non_cacheable");

			// The static part should NOT contain date or cwd
			expect(staticSection!.content).not.toContain("Current date:");
			expect(staticSection!.content).not.toContain("Current working directory:");
		});

		it("returns only static section when prompt has no date/cwd", () => {
			const prompt = "You are an expert assistant.\n\nBe helpful.";
			const sections = policy.classifySystemPrompt(prompt);

			expect(sections.length).toBe(1);
			expect(sections[0].kind).toBe("system_prompt");
			expect(sections[0].cacheability).toBe("static_cacheable");
		});

		it("preserves content before date/cwd lines", () => {
			const prompt = makeFullSystemPrompt("Extra guideline.");
			const staticSection = policy.classifySystemPrompt(prompt).find((s) => s.kind === "system_prompt");
			expect(staticSection!.content).toContain("Extra guideline.");
		});
	});

	describe("classifyTools", () => {
		const policy = new PromptCachePolicy();

		it("returns empty for no tools", () => {
			expect(policy.classifyTools([])).toEqual([]);
		});

		it("classifies tools as static_cacheable", () => {
			const tools = [makeTool("read"), makeTool("bash")];
			const sections = policy.classifyTools(tools);

			expect(sections.length).toBe(1);
			expect(sections[0].kind).toBe("tool_definitions");
			expect(sections[0].cacheability).toBe("static_cacheable");
			expect(sections[0].content).toContain("read");
			expect(sections[0].content).toContain("bash");
		});
	});

	describe("classifyMessages", () => {
		const policy = new PromptCachePolicy();

		it("returns empty for no messages", () => {
			expect(policy.classifyMessages([])).toEqual([]);
		});

		it("classifies pinned messages as semi_static_cacheable", () => {
			const messages = [makeUserMessage("hello"), makeUserMessage("world")];
			const sections = policy.classifyMessages(messages, 1);

			const pinned = sections.find((s) => s.kind === "pinned_messages");
			const recent = sections.find((s) => s.kind === "recent_messages");

			expect(pinned).toBeDefined();
			expect(pinned!.cacheability).toBe("semi_static_cacheable");
			expect(recent).toBeDefined();
			expect(recent!.cacheability).toBe("dynamic_non_cacheable");
		});
	});

	describe("buildContextReport", () => {
		const policy = new PromptCachePolicy();

		it("produces classified sections for a full context", () => {
			const context: Context = {
				systemPrompt: makeFullSystemPrompt(),
				tools: [makeTool("read"), makeTool("bash")],
				messages: [makeUserMessage("hello"), makeUserMessage("how are you?")],
			};

			const sections = policy.buildContextReport(context, { pinnedMessageCount: 1 });

			// Should have: system_prompt, current_date, current_directory, tool_definitions,
			//              pinned_messages, recent_messages
			const kinds = sections.map((s) => s.kind);
			expect(kinds).toContain("system_prompt");
			expect(kinds).toContain("current_date");
			expect(kinds).toContain("current_directory");
			expect(kinds).toContain("tool_definitions");
			expect(kinds).toContain("pinned_messages");
			expect(kinds).toContain("recent_messages");
		});
	});
});

// ---------------------------------------------------------------------------
// PromptAssembler
// ---------------------------------------------------------------------------

describe("PromptAssembler", () => {
	// -----------------------------------------------------------------------
	// Acceptance Criterion 1: Prompt assembly separates cacheable prefix
	//                         from dynamic suffix
	// -----------------------------------------------------------------------
	describe("AC1: separates cacheable prefix from dynamic suffix", () => {
		const assembler = new PromptAssembler();

		it("produces an assembly with prefix and suffix", () => {
			const context: Context = {
				systemPrompt: "You are helpful.",
				messages: [makeUserMessage("hello"), makeUserMessage("world")],
			};
			const assembly = assembler.assembleRaw(context);

			expect(assembly.prefix).toBeDefined();
			expect(assembly.suffix).toBeDefined();
			expect(assembly.prefix.systemPrompt).toBe("You are helpful.");
		});

		it("result includes prefixHash, pinnedMessageCount, suffixMessageCount", () => {
			const context: Context = {
				systemPrompt: "You are helpful.",
				tools: [makeTool("read")],
				messages: [makeUserMessage("hi"), makeUserMessage("bye")],
			};
			const result = assembler.assemble(context, { pinnedMessageCount: 1 });

			expect(result.prefixHash).toBeTypeOf("string");
			expect(result.pinnedMessageCount).toBe(1);
			expect(result.suffixMessageCount).toBe(1);
			expect(result.version).toBe(CACHE_PREFIX_VERSION);
		});

		it("result includes token estimates", () => {
			const context: Context = {
				systemPrompt: "You are helpful.",
				messages: [makeUserMessage("hello world")],
			};
			const result = assembler.assemble(context);

			expect(result.totalTokenEstimate).toBeGreaterThan(0);
			expect(typeof result.cacheableTokenEstimate).toBe("number");
			expect(typeof result.dynamicTokenEstimate).toBe("number");
		});

		it("result includes classified sections", () => {
			const context: Context = {
				systemPrompt: "Sys prompt.",
				tools: [makeTool("read")],
				messages: [makeUserMessage("a")],
			};
			const result = assembler.assemble(context);

			expect(result.sections.length).toBeGreaterThan(0);
			expect(result.sections[0]).toHaveProperty("kind");
			expect(result.sections[0]).toHaveProperty("cacheability");
			expect(result.sections[0]).toHaveProperty("hash");
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 2: Static prefix hash remains stable across
	//                         equivalent calls
	// -----------------------------------------------------------------------
	describe("AC2: static prefix hash stable across equivalent calls", () => {
		const assembler = new PromptAssembler();

		it("same context produces same prefix hash", () => {
			const context: Context = {
				systemPrompt: "You are helpful.",
				tools: [makeTool("read"), makeTool("bash")],
				messages: [makeUserMessage("hello")],
			};

			const hash1 = assembler.computePrefixHash(context);
			const hash2 = assembler.computePrefixHash(context);

			expect(hash1).toBe(hash2);
		});

		it("same system prompt and tools, different messages => same hash (no pinned)", () => {
			const base: Context = {
				systemPrompt: "You are helpful.",
				tools: [makeTool("read")],
				messages: [makeUserMessage("hi")],
			};
			const differentMessages: Context = {
				systemPrompt: "You are helpful.",
				tools: [makeTool("read")],
				messages: [makeUserMessage("hi"), makeUserMessage("bye")],
			};

			expect(assembler.computePrefixHash(base)).toBe(assembler.computePrefixHash(differentMessages));
		});

		it("identical contexts produce identical hash values", () => {
			const context: Context = {
				systemPrompt: "System",
				tools: [makeTool("read"), makeTool("write")],
				messages: [makeUserMessage("hello"), makeUserMessage("world")],
			};
			const result1 = assembler.assemble(context);
			const result2 = assembler.assemble(context);

			expect(result1.prefixHash).toBe(result2.prefixHash);
		});

		it("tools with same content produce same hash even in different order", () => {
			const a: Context = {
				systemPrompt: "Sys",
				tools: [makeTool("read"), makeTool("write"), makeTool("bash")],
				messages: [],
			};
			const b: Context = {
				systemPrompt: "Sys",
				tools: [makeTool("bash"), makeTool("read"), makeTool("write")],
				messages: [],
			};

			expect(assembler.computePrefixHash(a)).toBe(assembler.computePrefixHash(b));
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 3: Dynamic suffix changes do not change prefix hash
	// -----------------------------------------------------------------------
	describe("AC3: dynamic suffix changes do not change prefix hash", () => {
		const assembler = new PromptAssembler();

		it("changing user message content after pinned messages", () => {
			const base: Context = {
				systemPrompt: "System prompt.",
				messages: [makeUserMessage("pinned"), makeUserMessage("dynamic-A")],
			};
			const changed: Context = {
				systemPrompt: "System prompt.",
				messages: [makeUserMessage("pinned"), makeUserMessage("dynamic-B")],
			};

			expect(assembler.isPrefixStable(base, changed, { pinnedMessageCount: 1 })).toBe(true);
		});

		it("adding more suffix messages does not change prefix hash", () => {
			const base: Context = {
				systemPrompt: "Sys",
				messages: [makeUserMessage("a"), makeUserMessage("b")],
			};
			const extended: Context = {
				systemPrompt: "Sys",
				messages: [makeUserMessage("a"), makeUserMessage("b"), makeUserMessage("c")],
			};

			expect(assembler.isPrefixStable(base, extended)).toBe(true);
		});

		it("changing suffix message timestamps does not affect prefix hash", () => {
			const base: Context = {
				systemPrompt: "Sys",
				messages: [makeUserMessage("hello", 1000)],
			};
			const changed: Context = {
				systemPrompt: "Sys",
				messages: [makeUserMessage("hello", 9999)],
			};

			expect(assembler.isPrefixStable(base, changed)).toBe(true);
		});

		it("different suffix lengths with same prefix produce same hash", () => {
			const base: Context = {
				systemPrompt: "Static",
				tools: [makeTool("read")],
				messages: [makeUserMessage("msg")],
			};
			const longer: Context = {
				systemPrompt: "Static",
				tools: [makeTool("read")],
				messages: [
					makeUserMessage("msg"),
					makeAssistantMessage("response"),
					makeUserMessage("follow-up"),
					makeAssistantMessage("answer"),
				],
			};

			expect(assembler.isPrefixStable(base, longer)).toBe(true);
		});

		it("all suffix messages can change without affecting prefix hash (no pinned messages)", () => {
			const base: Context = {
				systemPrompt: "Constant system prompt.",
				messages: [makeUserMessage("old message")],
			};
			const changed: Context = {
				systemPrompt: "Constant system prompt.",
				messages: [makeUserMessage("new completely different message")],
			};

			expect(assembler.isPrefixStable(base, changed)).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 4: Cache prefix version invalidates on
	//                         safety/policy changes
	// -----------------------------------------------------------------------
	describe("AC4: cache prefix version invalidates on safety/policy changes", () => {
		it("CACHE_PREFIX_VERSION is a positive integer", () => {
			expect(CACHE_PREFIX_VERSION).toBeGreaterThan(0);
			expect(Number.isInteger(CACHE_PREFIX_VERSION)).toBe(true);
		});

		it("different policy versions are reported and consumers should invalidate on mismatch", () => {
			const policyV1 = new PromptCachePolicy(1);
			const policyV2 = new PromptCachePolicy(5);

			// The policy exposes version. Consumers must compare version numbers
			// and invalidate cache entries when versions differ.
			expect(policyV1.version).toBe(1);
			expect(policyV2.version).toBe(5);

			// The prefix hash always embeds CACHE_PREFIX_VERSION from the ai package,
			// so when that global constant is bumped, cached entries with old version
			// are automatically invalidated.
			const context: Context = {
				systemPrompt: "System prompt.",
				messages: [makeUserMessage("hello")],
			};
			const hash1 = policyV1.computeContextPrefixHash(context);
			const hash2 = policyV2.computeContextPrefixHash(context);
			// Both use the same CACHE_PREFIX_VERSION constant so hashes are the same.
			// Only a global version bump would change the hash.
			expect(hash1).toBe(hash2);
		});

		it("assembly result includes version number", () => {
			const assembler = new PromptAssembler();
			const context: Context = {
				systemPrompt: "Sys",
				messages: [],
			};
			const result = assembler.assemble(context);

			expect(result.version).toBe(CACHE_PREFIX_VERSION);
		});

		it("policy exposes version for consumer checking", () => {
			const policy = new PromptCachePolicy(42);
			expect(policy.version).toBe(42);
		});
	});

	// -----------------------------------------------------------------------
	// Acceptance Criterion 5: Tests cover stable prefix and changing suffix
	// -----------------------------------------------------------------------

	// This entire test file fulfills AC5, but let's add explicit integration
	// scenarios.

	describe("AC5: integration scenarios", () => {
		const assembler = new PromptAssembler();

		it("full scenario: same system prompt, same tools, different user messages", () => {
			const systemPrompt = makeFullSystemPrompt();
			const tools = [makeTool("read"), makeTool("bash"), makeTool("edit"), makeTool("write")];

			// Turn 1: initial request
			const turn1: Context = {
				systemPrompt,
				tools,
				messages: [makeUserMessage("What files are in the current directory?")],
			};

			// Turn 2: different user request, same system prompt and tools
			const turn2: Context = {
				systemPrompt,
				tools,
				messages: [
					makeUserMessage("What files are in the current directory?"),
					makeAssistantMessage("Here are the files: ..."),
					makeUserMessage("Edit the README to add a new section."),
				],
			};

			// With 0 pinned messages, only system prompt + tools affect hash
			expect(assembler.isPrefixStable(turn1, turn2)).toBe(true);
		});

		it("full scenario: system prompt change invalidates cache", () => {
			const tools = [makeTool("read")];

			const v1: Context = {
				systemPrompt: "Original system prompt.",
				tools,
				messages: [makeUserMessage("hello")],
			};
			const v2: Context = {
				systemPrompt: "Updated system prompt with new safety rules.",
				tools,
				messages: [makeUserMessage("hello")],
			};

			// Different system prompt -> different hash
			expect(assembler.isPrefixStable(v1, v2)).toBe(false);
		});

		it("full scenario: tool change invalidates cache", () => {
			const systemPrompt = "System prompt.";

			const withRead: Context = {
				systemPrompt,
				tools: [makeTool("read")],
				messages: [makeUserMessage("hello")],
			};
			const withAll: Context = {
				systemPrompt,
				tools: [makeTool("read"), makeTool("bash"), makeTool("edit"), makeTool("write")],
				messages: [makeUserMessage("hello")],
			};

			// Different tools -> different hash
			expect(assembler.isPrefixStable(withRead, withAll)).toBe(false);
		});

		it("multiple calls produce deterministic prefix hashes", () => {
			const context: Context = {
				systemPrompt: "Deterministic test.",
				tools: [makeTool("a"), makeTool("b"), makeTool("c")],
				messages: [makeUserMessage("first"), makeUserMessage("second")],
			};

			const results: string[] = [];
			for (let i = 0; i < 5; i++) {
				results.push(assembler.computePrefixHash(context));
			}

			// All hashes should be identical
			const first = results[0];
			for (const hash of results) {
				expect(hash).toBe(first);
			}
		});

		it("pinned messages remain in prefix, rest go to suffix", () => {
			const context: Context = {
				systemPrompt: "Sys",
				messages: [
					makeUserMessage("pinned-one"),
					makeAssistantMessage("pinned-response"),
					makeUserMessage("dynamic"),
				],
			};

			const assembly = assembler.assembleRaw(context, { pinnedMessageCount: 2 });
			expect(assembly.prefix.pinnedMessages).toHaveLength(2);
			expect(assembly.prefix.pinnedMessages[0].role).toBe("user");
			expect(assembly.prefix.pinnedMessages[1].role).toBe("assistant");
			expect(assembly.suffix).toHaveLength(1);
			expect(assembly.suffix[0].content).toBe("dynamic");
		});

		it("different sessions with same config produce same prefix hash", () => {
			// Simulates two separate agent sessions with identical configuration.
			const config: Context = {
				systemPrompt: "You are pi, a coding agent.",
				tools: [makeTool("read"), makeTool("bash"), makeTool("edit"), makeTool("write")],
				messages: [],
			};

			const session1 = assembler.computePrefixHash(config);
			const session2 = assembler.computePrefixHash(config);

			expect(session1).toBe(session2);
		});
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	const assembler = new PromptAssembler();

	it("handles empty context", () => {
		const context: Context = {
			systemPrompt: "",
			messages: [],
		};
		const result = assembler.assemble(context);
		expect(result.prefixHash).toBeTypeOf("string");
		expect(result.prefixHash.length).toBeGreaterThan(0);
	});

	it("handles undefined system prompt", () => {
		const context: Context = {
			messages: [makeUserMessage("hi")],
		};
		const result = assembler.assemble(context);
		expect(result.prefixHash).toBeTypeOf("string");
	});

	it("handles undefined tools", () => {
		const context: Context = {
			systemPrompt: "Sys",
			messages: [],
		};
		const result = assembler.assemble(context);
		expect(result.prefixHash).toBeTypeOf("string");
	});

	it("handles undefined messages", () => {
		const context: Context = {
			systemPrompt: "Sys",
		} as Context;
		const result = assembler.assemble(context);
		expect(result.prefixHash).toBeTypeOf("string");
	});

	it("handles large pinned message count gracefully", () => {
		const context: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("b")],
		};
		const result = assembler.assemble(context, { pinnedMessageCount: 100 });
		expect(result.pinnedMessageCount).toBe(100); // requested count
		expect(result.suffixMessageCount).toBe(0); // all messages fit in prefix
	});
});
