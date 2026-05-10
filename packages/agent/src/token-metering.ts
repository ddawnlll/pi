/**
 * Token Metering Core - P1 Workstream 7.A
 *
 * Provides token estimation and usage tracking for Pi agent requests.
 * Uses conservative chars/4 heuristic for estimation.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentMessage } from "./types.js";

/**
 * Role types for token budget tracking
 */
export type TokenRole = "flash" | "worker" | "lead" | "reviewer" | "debug" | "unknown";

/**
 * Structured token usage record
 */
export interface TokenUsage {
	/** Estimated input tokens before request */
	estimatedInput: number;
	/** Actual input tokens from provider response */
	actualInput?: number;
	/** Actual output tokens from provider response */
	actualOutput?: number;
	/** Total tokens (input + output) from provider */
	totalTokens?: number;
	/** Model ID */
	model: string;
	/** Provider name */
	provider: string;
	/** Role type for budget tracking */
	role: TokenRole;
	/** Unique request identifier */
	requestId: string;
	/** Timestamp when usage was recorded */
	timestamp: number;
}

/**
 * Estimate token count for a string using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 *
 * @param content - String content to estimate
 * @returns Estimated token count
 */
export function estimateTokensFromString(content: string): number {
	return Math.ceil(content.length / 4);
}

/**
 * Estimate token count for an agent message using chars/4 heuristic.
 * This is conservative (overestimates tokens).
 *
 * Based on existing implementation in compaction/compaction.ts but extracted
 * for reuse across the codebase.
 *
 * @param message - Agent message to estimate
 * @returns Estimated token count
 */
export function estimateTokensFromMessage(message: AgentMessage): number {
	let chars = 0;

	switch (message.role) {
		case "user": {
			const content = (message as { content: string | Array<{ type: string; text?: string }> }).content;
			if (typeof content === "string") {
				chars = content.length;
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === "text" && block.text) {
						chars += block.text.length;
					}
					// Images are estimated separately
					if (block.type === "image") {
						chars += 4800; // ~1200 tokens per image
					}
				}
			}
			return Math.ceil(chars / 4);
		}
		case "assistant": {
			const assistant = message as AssistantMessage;
			for (const block of assistant.content) {
				if (block.type === "text") {
					chars += block.text.length;
				} else if (block.type === "thinking") {
					chars += block.thinking.length;
				} else if (block.type === "toolCall") {
					chars += block.name.length + JSON.stringify(block.arguments).length;
				}
			}
			return Math.ceil(chars / 4);
		}
		case "custom":
		case "toolResult": {
			if (typeof message.content === "string") {
				chars = message.content.length;
			} else {
				for (const block of message.content) {
					if (block.type === "text" && block.text) {
						chars += block.text.length;
					}
					if (block.type === "image") {
						chars += 4800; // ~1200 tokens per image
					}
				}
			}
			return Math.ceil(chars / 4);
		}
		case "bashExecution": {
			chars = message.command.length + message.output.length;
			return Math.ceil(chars / 4);
		}
		case "branchSummary":
		case "compactionSummary": {
			chars = message.summary.length;
			return Math.ceil(chars / 4);
		}
	}

	return 0;
}

/**
 * Estimate total token count for an array of messages
 *
 * @param messages - Array of agent messages
 * @returns Total estimated token count
 */
export function estimateTokensFromMessages(messages: AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += estimateTokensFromMessage(message);
	}
	return total;
}

/**
 * Token usage recorder for tracking estimated and actual usage
 */
export class TokenUsageRecorder {
	private usageMap = new Map<string, TokenUsage>();

	/**
	 * Record estimated token usage before a request
	 *
	 * @param requestId - Unique request identifier
	 * @param estimatedInput - Estimated input tokens
	 * @param model - Model ID
	 * @param provider - Provider name
	 * @param role - Role type for budget tracking
	 */
	recordEstimate(
		requestId: string,
		estimatedInput: number,
		model: string,
		provider: string,
		role: TokenRole = "unknown",
	): void {
		this.usageMap.set(requestId, {
			estimatedInput,
			model,
			provider,
			role,
			requestId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Record actual token usage from provider response
	 *
	 * @param requestId - Unique request identifier
	 * @param actualInput - Actual input tokens from provider
	 * @param actualOutput - Actual output tokens from provider
	 * @param totalTokens - Total tokens from provider (optional)
	 */
	recordActual(requestId: string, actualInput?: number, actualOutput?: number, totalTokens?: number): void {
		const existing = this.usageMap.get(requestId);
		if (existing) {
			existing.actualInput = actualInput;
			existing.actualOutput = actualOutput;
			existing.totalTokens = totalTokens;
		} else {
			// If no estimate was recorded, create a new entry with actual values only
			this.usageMap.set(requestId, {
				estimatedInput: 0,
				actualInput,
				actualOutput,
				totalTokens,
				model: "unknown",
				provider: "unknown",
				role: "unknown",
				requestId,
				timestamp: Date.now(),
			});
		}
	}

	/**
	 * Get token usage for a specific request
	 *
	 * @param requestId - Unique request identifier
	 * @returns Token usage record or undefined if not found
	 */
	getUsage(requestId: string): TokenUsage | undefined {
		return this.usageMap.get(requestId);
	}

	/**
	 * Get all recorded token usage
	 *
	 * @returns Array of all token usage records
	 */
	getAllUsage(): TokenUsage[] {
		return Array.from(this.usageMap.values());
	}

	/**
	 * Clear all recorded usage
	 */
	clear(): void {
		this.usageMap.clear();
	}

	/**
	 * Get total estimated input tokens across all requests
	 */
	getTotalEstimatedInput(): number {
		let total = 0;
		for (const usage of this.usageMap.values()) {
			total += usage.estimatedInput;
		}
		return total;
	}

	/**
	 * Get total actual input tokens across all requests
	 */
	getTotalActualInput(): number {
		let total = 0;
		for (const usage of this.usageMap.values()) {
			if (usage.actualInput !== undefined) {
				total += usage.actualInput;
			}
		}
		return total;
	}

	/**
	 * Get total actual output tokens across all requests
	 */
	getTotalActualOutput(): number {
		let total = 0;
		for (const usage of this.usageMap.values()) {
			if (usage.actualOutput !== undefined) {
				total += usage.actualOutput;
			}
		}
		return total;
	}
}
