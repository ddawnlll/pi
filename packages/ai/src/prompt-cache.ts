/**
 * Prompt cache architecture: separates cacheable prefix from dynamic suffix.
 *
 * The prompt cache enables caching of stable prefix parts (system prompt,
 * tool definitions, pinned messages) while allowing dynamic suffix parts
 * (recent messages, user input) to change independently. The prefix hash
 * remains stable across equivalent calls so that the cache can be reused.
 * Safety/policy changes bump the prefix version to invalidate cached entries.
 */

import type { TSchema } from "typebox";
import type { Context, Message, Tool } from "./types.js";
import { shortHash } from "./utils/hash.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Current prefix version — bump this when safety/policy rules change. */
export const CACHE_PREFIX_VERSION = 1;

/** Serialisable representation of a tool for hashing. */
interface ToolSnapshot {
	name: string;
	description: string;
}

/** The result of splitting a Context into cacheable prefix and dynamic suffix. */
export interface PromptAssembly {
	/** Version that changes on safety/policy updates to invalidate cache. */
	version: number;
	/** All parts that are cacheable (stable across equivalent calls). */
	prefix: PromptPrefix;
	/** Messages that may vary between calls. */
	suffix: Message[];
}

/** The cacheable prefix portion of a prompt. */
export interface PromptPrefix {
	systemPrompt: string;
	tools: ToolSnapshot[];
	pinnedMessages: Message[];
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Assemble prompt into cacheable prefix and dynamic suffix.
 *
 * The prefix includes: system prompt, tool definitions, and pinned messages
 * (messages that are part of the stable conversation context).
 * The suffix includes the remaining recent messages that may change.
 *
 * @param context - The full prompt context.
 * @param options - Assembly options.
 * @returns The assembled prompt with separated prefix and suffix.
 */
export function assemblePrompt(context: Context, options?: PromptAssemblyOptions): PromptAssembly {
	const { pinnedMessageCount = 0 } = options ?? {};

	const tools = (context.tools ?? []).map(toolToSnapshot);

	const messages = context.messages ?? [];
	const pinnedMessages = messages.slice(0, Math.min(pinnedMessageCount, messages.length));
	const suffix = messages.slice(Math.min(pinnedMessageCount, messages.length));

	return {
		version: CACHE_PREFIX_VERSION,
		prefix: {
			systemPrompt: context.systemPrompt ?? "",
			tools,
			pinnedMessages,
		},
		suffix,
	};
}

/** Options for prompt assembly. */
export interface PromptAssemblyOptions {
	/** Number of leading messages to pin into the cacheable prefix. Default 0. */
	pinnedMessageCount?: number;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a stable hash of the cacheable prefix.
 *
 * The hash is computed from the version, system prompt, tool snapshots,
 * and pinned messages. Two calls with the same prefix content produce the
 * same hash regardless of suffix changes.
 *
 * @param prefix - The cacheable prefix to hash.
 * @returns A short deterministic hash string.
 */
export function computePrefixHash(prefix: PromptPrefix): string {
	const parts: string[] = [`v:${CACHE_PREFIX_VERSION}`, `sys:${prefix.systemPrompt}`];

	// Tools are sorted by name for deterministic ordering.
	const sortedTools = [...prefix.tools].sort((a, b) => a.name.localeCompare(b.name));
	for (const tool of sortedTools) {
		parts.push(`tool:${tool.name}:${tool.description}`);
	}

	// Pinned messages are included in prefix stability.
	for (const msg of prefix.pinnedMessages) {
		parts.push(`msg:${serializeMessage(msg)}`);
	}

	return shortHash(parts.join("|"));
}

/**
 * Compute the prefix hash directly from a Context, optionally pinning some
 * leading messages into the cacheable prefix.
 *
 * @param context - The full prompt context.
 * @param options - Assembly options.
 * @returns The stable prefix hash.
 */
export function computeContextPrefixHash(context: Context, options?: PromptAssemblyOptions): string {
	const assembly = assemblePrompt(context, options);
	return computePrefixHash(assembly.prefix);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Verify that changing the dynamic suffix does not change the prefix hash.
 *
 * @param contextA - First context (e.g., baseline).
 * @param contextB - Second context with a different suffix but same prefix.
 * @param options - Assembly options.
 * @returns True if prefix hashes match.
 */
export function prefixHashStableAcrossSuffixChange(
	contextA: Context,
	contextB: Context,
	options?: PromptAssemblyOptions,
): boolean {
	return computeContextPrefixHash(contextA, options) === computeContextPrefixHash(contextB, options);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Tool to a stable snapshot for hashing.
 *
 * Only name and description are used because the parameters schema may
 * contain non-deterministic field orderings. This keeps the hash stable.
 */
function toolToSnapshot(tool: Tool<TSchema>): ToolSnapshot {
	return {
		name: tool.name,
		description: tool.description,
	};
}

/**
 * Serialize a Message to a deterministic string for hashing.
 *
 * Only role and text content are included; timestamps and other volatile
 * fields are excluded to maintain hash stability.
 */
function serializeMessage(msg: Message): string {
	const role = msg.role;
	if (role === "user") {
		const content =
			typeof msg.content === "string"
				? msg.content
				: msg.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("");
		return `user:${content}`;
	}
	if (role === "assistant") {
		const parts = msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text);
		return `assistant:${parts.join("")}`;
	}
	if (role === "toolResult") {
		const parts = msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text);
		return `toolResult:${msg.toolCallId}:${msg.toolName}:${parts.join("")}:${msg.isError}`;
	}
	return `unknown:${role}`;
}
