/**
 * Prompt cache policy for the coding agent.
 *
 * Defines what sections of the agent prompt are cacheable (static prefix)
 * versus dynamic (suffix). The policy controls how the prompt assembler
 * splits the prompt into cacheable and non-cacheable parts.
 *
 * Cacheable prefix parts:
 *   - system prompt (without date/cwd which are dynamic)
 *   - tool definitions
 *   - safety policy
 *   - edit strategy policy
 *   - stable project conventions
 *
 * Dynamic suffix parts:
 *   - current date
 *   - current working directory
 *   - per-turn extension modifications
 *   - recent messages
 *   - project context files
 *   - skills content
 */

import type { Context, Message, Tool } from "@earendil-works/pi-ai";
import {
	assemblePrompt as aiAssemblePrompt,
	computePrefixHash as aiComputePrefixHash,
	CACHE_PREFIX_VERSION,
	type PromptAssembly,
	type PromptAssemblyOptions,
	type PromptPrefix,
} from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";

// Re-export the version constant so consumers can check it.
export { CACHE_PREFIX_VERSION };

// ---------------------------------------------------------------------------
// Cacheability classification
// ---------------------------------------------------------------------------

/**
 * Cacheability level for a prompt section.
 */
export type Cacheability = "static_cacheable" | "semi_static_cacheable" | "dynamic_non_cacheable";

/**
 * Classification of a single prompt section.
 */
export interface ContextSection {
	/** Section kind identifier (e.g. "system_prompt", "tool_definitions"). */
	kind: string;
	/** The content of this section. */
	content: string;
	/** Whether this section is cacheable, semi-cacheable, or dynamic. */
	cacheability: Cacheability;
	/** Priority order within the prompt (lower numbers appear first). */
	priority: number;
	/** Estimated token count for this section (rough: 1 token ~= 4 chars). */
	tokenEstimate: number;
	/** Source description (e.g. "system prompt", "extension append"). */
	source: string;
	/** Section hash for change detection. */
	hash: string;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Prompt cache policy.
 *
 * Provides methods to classify prompt sections and compute cache metadata.
 */
export class PromptCachePolicy {
	/**
	 * Current policy version. Bump this when safety/policy rules change to
	 * invalidate all cached prefix entries.
	 */
	readonly version: number;

	constructor(version = CACHE_PREFIX_VERSION) {
		this.version = version;
	}

	/**
	 * Classify a section by its kind into a cacheability level.
	 *
	 * This is the single source of truth for what goes into the prefix
	 * versus the suffix. Change this method when the caching policy evolves.
	 */
	classifySection(kind: string): Cacheability {
		switch (kind) {
			// === Cacheable: stable across turns and worker calls ===
			case "system_prompt":
			case "tool_definitions":
			case "safety_policy":
			case "edit_strategy_policy":
			case "completion_gate_rules":
			case "execution_contract":
			case "stable_project_conventions":
				return "static_cacheable";

			// === Semi-cacheable: stable within a session but may change ===
			case "pinned_messages":
			case "resource_loader_context":
				return "semi_static_cacheable";

			// === Dynamic: changes every turn ===
			case "current_date":
			case "current_directory":
			case "project_context_files":
			case "skills_content":
			case "extension_append":
			case "recent_messages":
			case "latest_tool_result":
			case "retry_state":
			case "current_diff":
				return "dynamic_non_cacheable";

			// Unknown kinds are treated as dynamic (safe default).
			default:
				return "dynamic_non_cacheable";
		}
	}

	/**
	 * Extract the cacheable prefix from a Context.
	 *
	 * Returns a new Context whose system prompt contains only the cacheable
	 * parts of the original system prompt, and whose messages are sliced
	 * to only include pinned messages.
	 *
	 * @param context - Full prompt context.
	 * @param options - Assembly options (pinnedMessageCount).
	 * @returns The cacheable prefix portion.
	 */
	extractCacheablePrefix(context: Context, options?: PromptAssemblyOptions): PromptPrefix {
		const assembly = aiAssemblePrompt(context, options);
		return assembly.prefix;
	}

	/**
	 * Compute a stable hash of the cacheable prefix.
	 *
	 * The hash is deterministic: same prefix content always yields the same
	 * hash, regardless of suffix changes.
	 *
	 * @param prefix - The cacheable prefix to hash.
	 * @returns Short deterministic hash string.
	 */
	computePrefixHash(prefix: PromptPrefix): string {
		return aiComputePrefixHash(prefix);
	}

	/**
	 * Compute the context prefix hash directly from a Context.
	 *
	 * @param context - Full prompt context.
	 * @param options - Assembly options.
	 * @returns Stable prefix hash.
	 */
	computeContextPrefixHash(context: Context, options?: PromptAssemblyOptions): string {
		return this.computePrefixHash(this.extractCacheablePrefix(context, options));
	}

	/**
	 * Classify a full system prompt into cacheable and dynamic sections.
	 *
	 * Scans the system prompt text for known dynamic suffixes (date, cwd)
	 * and returns classified sections.
	 *
	 * @param systemPrompt - The full system prompt text.
	 * @returns Array of classified ContextSections.
	 */
	classifySystemPrompt(systemPrompt: string): ContextSection[] {
		const sections: ContextSection[] = [];

		// The main system prompt content (everything before known dynamic appendages).
		// Dynamic parts are: "Current date: YYYY-MM-DD" and "Current working directory: <path>"
		const datePrefix = "Current date: ";
		const cwdPrefix = "Current working directory: ";

		// Split off the dynamic suffix lines from the bottom of the prompt.
		let staticPart = systemPrompt;
		const _dynamicLines: string[] = [];

		const lines = systemPrompt.split("\n");
		const extracted: string[] = [];

		// Walk from the end to find the date/cwd lines.
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			if (line.startsWith(datePrefix) || line.startsWith(cwdPrefix)) {
				extracted.unshift(line);
			} else {
				// Once we hit a non-date/cwd line, stop.
				break;
			}
		}

		if (extracted.length > 0) {
			staticPart = lines.slice(0, lines.length - extracted.length).join("\n");
		}

		// Static cacheable part
		sections.push({
			kind: "system_prompt",
			content: staticPart,
			cacheability: "static_cacheable",
			priority: 0,
			tokenEstimate: Math.ceil(staticPart.length / 4),
			source: "system prompt",
			hash: this.hashString(staticPart),
		});

		// Dynamic parts
		for (const line of extracted) {
			const kind = line.startsWith(datePrefix) ? "current_date" : "current_directory";
			sections.push({
				kind,
				content: line,
				cacheability: "dynamic_non_cacheable",
				priority: 999,
				tokenEstimate: Math.ceil(line.length / 4),
				source: "system prompt (dynamic)",
				hash: this.hashString(line),
			});
		}

		return sections;
	}

	/**
	 * Classify tool definitions into ContextSections.
	 */
	classifyTools(tools: Tool<TSchema>[]): ContextSection[] {
		if (tools.length === 0) return [];

		const content = tools.map((t) => `${t.name}: ${t.description}`).join("\n");
		return [
			{
				kind: "tool_definitions",
				content,
				cacheability: "static_cacheable",
				priority: 1,
				tokenEstimate: Math.ceil(content.length / 4),
				source: "tool registry",
				hash: this.hashString(content),
			},
		];
	}

	/**
	 * Classify messages into pinned (cacheable) and recent (dynamic) sections.
	 *
	 * @param messages - All messages.
	 * @param pinnedMessageCount - Number of leading messages to treat as pinned.
	 * @returns Array of classified ContextSections.
	 */
	classifyMessages(messages: Message[], pinnedMessageCount = 0): ContextSection[] {
		const sections: ContextSection[] = [];

		if (messages.length === 0) return sections;

		const pinned = messages.slice(0, Math.min(pinnedMessageCount, messages.length));
		const recent = messages.slice(Math.min(pinnedMessageCount, messages.length));

		if (pinned.length > 0) {
			const content = pinned.map((m) => `${m.role}: ${this.summarizeMessage(m)}`).join("\n");
			sections.push({
				kind: "pinned_messages",
				content,
				cacheability: "semi_static_cacheable",
				priority: 50,
				tokenEstimate: Math.ceil(content.length / 4),
				source: "pinned conversation history",
				hash: this.hashString(content),
			});
		}

		if (recent.length > 0) {
			const content = recent.map((m) => `${m.role}: ${this.summarizeMessage(m)}`).join("\n");
			sections.push({
				kind: "recent_messages",
				content,
				cacheability: "dynamic_non_cacheable",
				priority: 100,
				tokenEstimate: Math.ceil(content.length / 4),
				source: "recent conversation history",
				hash: this.hashString(content),
			});
		}

		return sections;
	}

	/**
	 * Build a full context report with classified sections.
	 *
	 * @param context - Full prompt context.
	 * @param options - Assembly options.
	 * @returns Array of classified ContextSections.
	 */
	buildContextReport(context: Context, options?: PromptAssemblyOptions): ContextSection[] {
		const sections: ContextSection[] = [];
		const { pinnedMessageCount = 0 } = options ?? {};

		// Classify system prompt
		sections.push(...this.classifySystemPrompt(context.systemPrompt ?? ""));

		// Classify tools
		sections.push(...this.classifyTools(context.tools ?? []));

		// Classify messages
		sections.push(...this.classifyMessages(context.messages ?? [], pinnedMessageCount));

		return sections;
	}

	/**
	 * Compute total token estimate for a set of sections filtered by cacheability.
	 */
	estimateTokensForSections(sections: ContextSection[], cacheability?: Cacheability): number {
		const filtered = cacheability ? sections.filter((s) => s.cacheability === cacheability) : sections;
		return filtered.reduce((sum, s) => sum + s.tokenEstimate, 0);
	}

	/**
	 * Quick string hash for section change detection.
	 */
	private hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash |= 0; // Convert to 32bit integer
		}
		return Math.abs(hash).toString(36);
	}

	/**
	 * Summarize a message for section classification (content preview).
	 */
	private summarizeMessage(msg: Message): string {
		if (typeof msg.content === "string") {
			return msg.content.slice(0, 80);
		}
		const texts = msg.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text);
		return texts.join(" ").slice(0, 80);
	}
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export type { PromptAssembly, PromptAssemblyOptions, PromptPrefix };
