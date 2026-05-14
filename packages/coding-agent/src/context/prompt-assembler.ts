/**
 * Prompt assembler for the coding agent.
 *
 * Assembles a prompt into cacheable prefix and dynamic suffix, using
 * the prompt cache policy to classify what belongs where. The assembler
 * bridges the coding agent's data structures with the @earendil-works/pi-ai
 * prompt-cache primitives.
 *
 * Usage:
 *   const assembler = new PromptAssembler();
 *   const result = assembler.assemble(context, { pinnedMessageCount: 2 });
 *   console.log(result.prefixHash, result.suffix.length);
 */

import type { Context } from "@earendil-works/pi-ai";
import {
	assemblePrompt as aiAssemblePrompt,
	computePrefixHash as aiComputePrefixHash,
	type PromptAssemblyOptions,
} from "@earendil-works/pi-ai";
import { type ContextSection, PromptCachePolicy } from "./prompt-cache-policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of assembling a prompt with cache metadata.
 */
export interface PromptAssemblyResult {
	/** The full original context. */
	context: Context;
	/** Assembly options used. */
	options: PromptAssemblyOptions;
	/** Stable hash of the cacheable prefix. */
	prefixHash: string;
	/** Number of messages in the cacheable prefix (pinned). */
	pinnedMessageCount: number;
	/** Number of messages in the dynamic suffix. */
	suffixMessageCount: number;
	/** Total tokens (rough estimate: ~1 token per 4 chars). */
	totalTokenEstimate: number;
	/** Tokens in the cacheable prefix. */
	cacheableTokenEstimate: number;
	/** Tokens in the dynamic suffix. */
	dynamicTokenEstimate: number;
	/** Classified sections for debugging / reporting. */
	sections: ContextSection[];
	/** Current cache prefix version. */
	version: number;
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Coding-agent prompt assembler.
 *
 * Separates a prompt context into a cacheable prefix (system prompt, tools,
 * pinned messages) and a dynamic suffix (recent messages). Provides metadata
 * about the split for cache diagnostics and reporting.
 */
export class PromptAssembler {
	private policy: PromptCachePolicy;

	constructor(policy?: PromptCachePolicy) {
		this.policy = policy ?? new PromptCachePolicy();
	}

	/**
	 * Assemble the prompt with caching metadata.
	 *
	 * @param context - The full prompt context with system prompt, tools, and messages.
	 * @param options - Assembly options (pinnedMessageCount).
	 * @returns PromptAssemblyResult with hash, estimates, and section classifications.
	 */
	assemble(context: Context, options?: PromptAssemblyOptions): PromptAssemblyResult {
		const { pinnedMessageCount = 0 } = options ?? {};

		// Use the ai package's assemblePrompt to get the split.
		const assembly = aiAssemblePrompt(context, options);

		// Compute the stable prefix hash.
		const prefixHash = aiComputePrefixHash(assembly.prefix);

		// Build classified sections for the report.
		const sections = this.policy.buildContextReport(context, options);

		// Token estimates.
		const totalTokenEstimate = this.estimateTokens(context);
		const cacheableTokenEstimate = this.policy.estimateTokensForSections(sections, "static_cacheable");
		const dynamicTokenEstimate = this.policy.estimateTokensForSections(sections, "dynamic_non_cacheable");

		return {
			context,
			options: { pinnedMessageCount },
			prefixHash,
			pinnedMessageCount,
			suffixMessageCount: assembly.suffix.length,
			totalTokenEstimate,
			cacheableTokenEstimate,
			dynamicTokenEstimate,
			sections,
			version: assembly.version,
		};
	}

	/**
	 * Assemble and return the raw ai package assembly.
	 *
	 * Useful when you just need the split without metadata.
	 */
	assembleRaw(context: Context, options?: PromptAssemblyOptions) {
		return aiAssemblePrompt(context, options);
	}

	/**
	 * Compute the prefix hash directly.
	 */
	computePrefixHash(context: Context, options?: PromptAssemblyOptions): string {
		const assembly = aiAssemblePrompt(context, options);
		return aiComputePrefixHash(assembly.prefix);
	}

	/**
	 * Check whether the prefix hash is stable across two contexts.
	 *
	 * Returns true if both contexts produce the same prefix hash,
	 * meaning their cacheable prefixes are equivalent.
	 */
	isPrefixStable(a: Context, b: Context, options?: PromptAssemblyOptions): boolean {
		return this.computePrefixHash(a, options) === this.computePrefixHash(b, options);
	}

	/**
	 * Get the current policy instance.
	 */
	getPolicy(): PromptCachePolicy {
		return this.policy;
	}

	/**
	 * Rough token estimate for a context (~1 token per 4 chars).
	 */
	private estimateTokens(context: Context): number {
		let total = 0;

		if (context.systemPrompt) {
			total += context.systemPrompt.length;
		}

		if (context.tools) {
			for (const tool of context.tools) {
				total += tool.name.length + tool.description.length;
			}
		}

		if (context.messages) {
			for (const msg of context.messages) {
				if (typeof msg.content === "string") {
					total += msg.content.length;
				} else {
					for (const block of msg.content) {
						if (block.type === "text") {
							total += block.text.length;
						}
					}
				}
			}
		}

		return Math.ceil(total / 4);
	}
}
