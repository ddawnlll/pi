/**
 * Context Section Classification
 *
 * Core types and utilities for classifying prompt sections by cacheability.
 * Provides the canonical classification rules specifying which parts of the
 * prompt are static (cacheable), semi-static (partially cacheable), or
 * dynamic (non-cacheable).
 *
 * Logs, timestamps, retry data, and per-turn results are classified as
 * dynamic to keep them out of the cacheable prefix.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Cacheability level for a prompt section.
 *
 * - `static_cacheable`: Fully cacheable, stable across turns and worker calls.
 * - `semi_static_cacheable`: Stable within a session, may change across sessions.
 * - `dynamic_non_cacheable`: Changes every turn, not cacheable.
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
// Classification Rules
// ---------------------------------------------------------------------------

/**
 * Default cacheability classification for known section kinds.
 *
 * This is the single source of truth for what goes into the cacheable prefix
 * versus the dynamic suffix.
 */
export const SECTION_CACHEABILITY: Record<string, Cacheability> = {
	// === Cacheable: stable across turns and worker calls ===
	system_prompt: "static_cacheable",
	tool_definitions: "static_cacheable",
	safety_policy: "static_cacheable",
	edit_strategy_policy: "static_cacheable",
	completion_gate_rules: "static_cacheable",
	execution_contract: "static_cacheable",
	stable_project_conventions: "static_cacheable",

	// === Semi-cacheable: stable within a session but may change ===
	pinned_messages: "semi_static_cacheable",
	resource_loader_context: "semi_static_cacheable",

	// === Dynamic: changes every turn - logs, timestamps, retry data stay out of prefix ===
	current_date: "dynamic_non_cacheable",
	current_directory: "dynamic_non_cacheable",
	project_context_files: "dynamic_non_cacheable",
	skills_content: "dynamic_non_cacheable",
	extension_append: "dynamic_non_cacheable",
	recent_messages: "dynamic_non_cacheable",
	latest_tool_result: "dynamic_non_cacheable",
	retry_state: "dynamic_non_cacheable",
	current_diff: "dynamic_non_cacheable",
};

// ---------------------------------------------------------------------------
// Classification Functions
// ---------------------------------------------------------------------------

/**
 * Classify a section kind into a cacheability level.
 *
 * @param kind - Section kind identifier.
 * @returns Cacheability level for the section.
 */
export function classifySection(kind: string): Cacheability {
	return SECTION_CACHEABILITY[kind] ?? "dynamic_non_cacheable";
}

/**
 * Check if a section is cacheable (static or semi-static).
 *
 * @param section - The context section to check.
 * @returns True if the section is cacheable.
 */
export function isCacheable(section: ContextSection): boolean {
	return section.cacheability === "static_cacheable" || section.cacheability === "semi_static_cacheable";
}

/**
 * Check if a section is strictly static (fully cacheable).
 *
 * @param section - The context section to check.
 * @returns True if the section is static cacheable.
 */
export function isStaticCacheable(section: ContextSection): boolean {
	return section.cacheability === "static_cacheable";
}

/**
 * Check if a section is dynamic (not cacheable).
 *
 * @param section - The context section to check.
 * @returns True if the section is dynamic.
 */
export function isDynamic(section: ContextSection): boolean {
	return section.cacheability === "dynamic_non_cacheable";
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Compute a simple hash for a string (for change detection).
 *
 * @param str - String to hash.
 * @returns Short deterministic hash string.
 */
export function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash).toString(36);
}

/**
 * Estimate token count from text (~1 token per 4 chars).
 *
 * @param text - Text to estimate.
 * @returns Estimated token count.
 */
export function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Summarize message content for section logging (first 80 chars).
 *
 * @param content - Message content string or content blocks.
 * @returns Truncated content preview.
 */
export function summarizeMessageContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content.slice(0, 80);
	}
	const texts = content
		.filter((c): c is { type: "text"; text: string } => c.type === "text" && c.text !== undefined)
		.map((c) => c.text);
	return texts.join(" ").slice(0, 80);
}
