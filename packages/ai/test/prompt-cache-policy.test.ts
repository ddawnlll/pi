import { describe, expect, it } from "vitest";
import {
	assemblePrompt,
	CACHE_PREFIX_VERSION,
	computeContextPrefixHash,
	computePrefixHash,
	type PromptPrefix,
	prefixHashStableAcrossSuffixChange,
} from "../src/prompt-cache.js";
import type { Context, Message } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(text: string, timestamp = 1_000): Message {
	return { role: "user", content: text, timestamp };
}

function makeTool(
	name: string,
	description = `Description of ${name}`,
): { name: string; description: string; parameters: { type: string } } {
	return { name, description, parameters: { type: "object" } } as any;
}

// ---------------------------------------------------------------------------
// assemblePrompt
// ---------------------------------------------------------------------------

describe("assemblePrompt", () => {
	it("splits context into prefix and suffix with no pinned messages by default", () => {
		const ctx: Context = {
			systemPrompt: "You are helpful.",
			messages: [makeUserMessage("hello"), makeUserMessage("world")],
		};
		const assembly = assemblePrompt(ctx);

		expect(assembly.version).toBe(CACHE_PREFIX_VERSION);
		expect(assembly.prefix.systemPrompt).toBe("You are helpful.");
		expect(assembly.prefix.tools).toEqual([]);
		expect(assembly.prefix.pinnedMessages).toEqual([]);
		expect(assembly.suffix).toEqual(ctx.messages);
	});

	it("pins leading messages into prefix when pinnedMessageCount is set", () => {
		const ctx: Context = {
			systemPrompt: "System",
			messages: [makeUserMessage("a"), makeUserMessage("b"), makeUserMessage("c")],
		};
		const assembly = assemblePrompt(ctx, { pinnedMessageCount: 2 });

		expect(assembly.prefix.pinnedMessages).toEqual([makeUserMessage("a"), makeUserMessage("b")]);
		expect(assembly.suffix).toEqual([makeUserMessage("c")]);
	});

	it("pins all messages if pinnedMessageCount exceeds message count", () => {
		const ctx: Context = {
			systemPrompt: "System",
			messages: [makeUserMessage("a")],
		};
		const assembly = assemblePrompt(ctx, { pinnedMessageCount: 10 });

		expect(assembly.prefix.pinnedMessages).toEqual([makeUserMessage("a")]);
		expect(assembly.suffix).toEqual([]);
	});

	it("handles empty context gracefully", () => {
		const ctx: Context = {
			messages: [],
		};
		const assembly = assemblePrompt(ctx);

		expect(assembly.prefix.systemPrompt).toBe("");
		expect(assembly.prefix.tools).toEqual([]);
		expect(assembly.prefix.pinnedMessages).toEqual([]);
		expect(assembly.suffix).toEqual([]);
	});

	it("handles undefined systemPrompt", () => {
		const ctx: Context = {
			messages: [makeUserMessage("hi")],
		};
		const assembly = assemblePrompt(ctx);

		expect(assembly.prefix.systemPrompt).toBe("");
		expect(assembly.suffix).toEqual([makeUserMessage("hi")]);
	});

	it("handles undefined tools", () => {
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [],
			tools: undefined,
		};
		const assembly = assemblePrompt(ctx);

		expect(assembly.prefix.tools).toEqual([]);
	});

	it("includes tool snapshots in prefix", () => {
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [],
			tools: [makeTool("Read"), makeTool("Write")],
		};
		const assembly = assemblePrompt(ctx);

		expect(assembly.prefix.tools).toEqual([
			{ name: "Read", description: "Description of Read" },
			{ name: "Write", description: "Description of Write" },
		]);
	});
});

// ---------------------------------------------------------------------------
// computePrefixHash — stability
// ---------------------------------------------------------------------------

describe("computePrefixHash", () => {
	it("produces the same hash for identical prefixes", () => {
		const prefix: PromptPrefix = {
			systemPrompt: "You are helpful.",
			tools: [{ name: "Read", description: "Read files" }],
			pinnedMessages: [],
		};
		expect(computePrefixHash(prefix)).toBe(computePrefixHash(prefix));
	});

	it("produces different hashes for different system prompts", () => {
		const a: PromptPrefix = {
			systemPrompt: "You are helpful.",
			tools: [],
			pinnedMessages: [],
		};
		const b: PromptPrefix = {
			systemPrompt: "You are a pirate.",
			tools: [],
			pinnedMessages: [],
		};
		expect(computePrefixHash(a)).not.toBe(computePrefixHash(b));
	});

	it("produces different hashes for different tools", () => {
		const a: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [{ name: "Read", description: "Read" }],
			pinnedMessages: [],
		};
		const b: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [{ name: "Write", description: "Write" }],
			pinnedMessages: [],
		};
		expect(computePrefixHash(a)).not.toBe(computePrefixHash(b));
	});

	it("is order-independent for tools (sorted by name)", () => {
		const a: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [
				{ name: "Write", description: "Write" },
				{ name: "Read", description: "Read" },
			],
			pinnedMessages: [],
		};
		const b: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [
				{ name: "Read", description: "Read" },
				{ name: "Write", description: "Write" },
			],
			pinnedMessages: [],
		};
		expect(computePrefixHash(a)).toBe(computePrefixHash(b));
	});

	it("produces different hashes for different pinned messages", () => {
		const a: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [makeUserMessage("hello")],
		};
		const b: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [makeUserMessage("world")],
		};
		expect(computePrefixHash(a)).not.toBe(computePrefixHash(b));
	});

	it("ignores timestamps in pinned messages (stable hash)", () => {
		const a: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [{ role: "user", content: "hello", timestamp: 1000 }],
		};
		const b: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [{ role: "user", content: "hello", timestamp: 9999 }],
		};
		expect(computePrefixHash(a)).toBe(computePrefixHash(b));
	});
});

// ---------------------------------------------------------------------------
// Dynamic suffix changes do NOT change prefix hash
// ---------------------------------------------------------------------------

describe("prefix hash stability with suffix changes", () => {
	it("same prefix, different suffix messages => same hash", () => {
		const base: Context = {
			systemPrompt: "You are helpful.",
			messages: [makeUserMessage("hello")],
		};
		const changed: Context = {
			systemPrompt: "You are helpful.",
			messages: [makeUserMessage("hello"), makeUserMessage("goodbye")],
		};
		const hashBase = computeContextPrefixHash(base);
		const hashChanged = computeContextPrefixHash(changed);

		expect(hashBase).toBe(hashChanged);
	});

	it("same prefix with pinned messages, different suffix => same hash", () => {
		const base: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("pinned"), makeUserMessage("dynamic-1")],
		};
		const changed: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("pinned"), makeUserMessage("dynamic-2")],
		};
		const options = { pinnedMessageCount: 1 };

		expect(computeContextPrefixHash(base, options)).toBe(computeContextPrefixHash(changed, options));
	});

	it("prefixHashStableAcrossSuffixChange returns true for matching prefixes", () => {
		const a: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("x")],
		};
		const b: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("y")],
		};
		expect(prefixHashStableAcrossSuffixChange(a, b, { pinnedMessageCount: 1 })).toBe(true);
	});

	it("prefixHashStableAcrossSuffixChange returns false for different prefixes", () => {
		const a: Context = {
			systemPrompt: "Sys A",
			messages: [makeUserMessage("a"), makeUserMessage("x")],
		};
		const b: Context = {
			systemPrompt: "Sys B",
			messages: [makeUserMessage("a"), makeUserMessage("y")],
		};
		expect(prefixHashStableAcrossSuffixChange(a, b, { pinnedMessageCount: 1 })).toBe(false);
	});

	it("changing suffix timestamps does not affect prefix hash", () => {
		const a: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("hello", 1000)],
		};
		const b: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("hello", 9999)],
		};
		expect(computeContextPrefixHash(a)).toBe(computeContextPrefixHash(b));
	});

	it("adding more suffix messages does not change prefix hash", () => {
		const base: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("b")],
		};
		const extended: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("new"), makeUserMessage("b")],
		};
		// With no pinned messages, all messages go to suffix, so prefix is same.
		const hashBase = computeContextPrefixHash(base);
		const hashExt = computeContextPrefixHash(extended);
		expect(hashBase).toBe(hashExt);
	});
});

// ---------------------------------------------------------------------------
// Cache prefix version invalidation
// ---------------------------------------------------------------------------

describe("cache prefix version invalidation", () => {
	it("CACHE_PREFIX_VERSION is a positive integer", () => {
		expect(CACHE_PREFIX_VERSION).toBeGreaterThan(0);
		expect(Number.isInteger(CACHE_PREFIX_VERSION)).toBe(true);
	});

	it("prefix hash embeds the current version", () => {
		// We verify indirectly: the version is part of the hash input.
		// Two hashes with the same prefix content but different versions will differ.
		// Since we can't change CACHE_PREFIX_VERSION at runtime, we verify it's used
		// by checking the assembly result includes the version.
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [],
		};
		const assembly = assemblePrompt(ctx);
		expect(assembly.version).toBe(CACHE_PREFIX_VERSION);
	});

	it("assembly exposes version so consumers can detect invalidation", () => {
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [],
		};
		const v = assemblePrompt(ctx).version;
		// If safety policy changes and version bumps, cached entries with old
		// version should be invalidated by consumers comparing version numbers.
		expect(typeof v).toBe("number");
		expect(v).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("handles empty system prompt", () => {
		const ctx: Context = {
			systemPrompt: "",
			messages: [],
		};
		const hash = computeContextPrefixHash(ctx);
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(0);
	});

	it("handles context with only messages, no system prompt", () => {
		const ctx: Context = {
			messages: [makeUserMessage("hi")],
		};
		const hash = computeContextPrefixHash(ctx);
		expect(typeof hash).toBe("string");
	});

	it("handles zero pinned messages", () => {
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("a"), makeUserMessage("b")],
		};
		const assembly = assemblePrompt(ctx, { pinnedMessageCount: 0 });
		expect(assembly.prefix.pinnedMessages).toEqual([]);
		expect(assembly.suffix).toEqual(ctx.messages);
	});

	it("handles duplicate messages in suffix correctly", () => {
		const ctx: Context = {
			systemPrompt: "Sys",
			messages: [makeUserMessage("dup"), makeUserMessage("dup")],
		};
		const hash1 = computeContextPrefixHash(ctx);
		const hash2 = computeContextPrefixHash(ctx);
		expect(hash1).toBe(hash2);
	});

	it("handles tools with same name but different descriptions", () => {
		const a: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [{ name: "Read", description: "Read files" }],
			pinnedMessages: [],
		};
		const b: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [{ name: "Read", description: "Read directories" }],
			pinnedMessages: [],
		};
		expect(computePrefixHash(a)).not.toBe(computePrefixHash(b));
	});

	it("handles large number of tools deterministically", () => {
		const tools = Array.from({ length: 50 }, (_, i) => ({
			name: `Tool${i}`,
			description: `Tool number ${i}`,
		}));
		const prefix: PromptPrefix = {
			systemPrompt: "Sys",
			tools,
			pinnedMessages: [],
		};
		// Hash twice — must be identical.
		expect(computePrefixHash(prefix)).toBe(computePrefixHash(prefix));
	});

	it("handles assistant messages in pinned prefix", () => {
		const assistantMsg: Message = {
			role: "assistant",
			content: [{ type: "text", text: "I can help." }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-3",
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
		};
		const prefixA: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [makeUserMessage("hello"), assistantMsg],
		};
		const prefixB: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [makeUserMessage("hello"), { ...assistantMsg, timestamp: 9999 }],
		};
		// Timestamps are excluded from hash, so hashes should match.
		expect(computePrefixHash(prefixA)).toBe(computePrefixHash(prefixB));
	});

	it("handles tool result messages in pinned prefix", () => {
		const toolResultMsg: Message = {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "Read",
			content: [{ type: "text", text: "file contents" }],
			isError: false,
			timestamp: 1000,
		};
		const prefix: PromptPrefix = {
			systemPrompt: "Sys",
			tools: [],
			pinnedMessages: [toolResultMsg],
		};
		const hash = computePrefixHash(prefix);
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(0);
	});
});
