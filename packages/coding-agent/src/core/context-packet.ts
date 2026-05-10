/**
 * Compact Context Packet Builder - P1 Workstream 7.C
 *
 * Provides compact task packet format for future multi-agent execution.
 * P1 only creates the schema and builder, not the executor (P2).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokensFromString, type TokenRole } from "./token-metering.js";

/**
 * Acceptance criteria for a workspace task
 */
export interface AcceptanceCriterion {
	/** Criterion description */
	description: string;
	/** Whether this criterion has been verified */
	verified?: boolean;
}

/**
 * Code snippet relevant to the workspace task
 */
export interface RelevantSnippet {
	/** File path */
	file: string;
	/** Snippet content */
	content: string;
	/** Optional line range */
	lines?: { start: number; end: number };
}

/**
 * Compact workspace packet for multi-agent execution
 *
 * This packet contains only the essential context needed for a worker
 * to complete a specific task, without full plan, full chat history,
 * or full repository context.
 */
export interface WorkspacePacket {
	/** Phase identifier (e.g., "P1") */
	phaseId: string;
	/** Workspace identifier (e.g., "7.C") */
	workspaceId: string;
	/** Role for budget tracking */
	role: TokenRole;
	/** Task goal/objective */
	goal: string;
	/** Files that can be read/modified */
	allowedFiles: string[];
	/** Files that must not be touched */
	forbiddenFiles: string[];
	/** Acceptance criteria for task completion */
	acceptanceCriteria: AcceptanceCriterion[];
	/** Optional command to run after completion */
	targetCommand: string | null;
	/** Brief summary of prior state/context */
	stateSummary: string;
	/** Relevant code snippets for context */
	relevantSnippets: RelevantSnippet[];
	/** Expected output format/contract */
	outputContract: string;
	/** Token budget information */
	budget: {
		/** Maximum input tokens allowed */
		maxInputTokens: number;
		/** Estimated input tokens for this packet */
		estimatedInputTokens: number;
	};
	/** Optional metadata */
	metadata?: {
		/** When packet was created */
		createdAt?: number;
		/** Who/what created the packet */
		createdBy?: string;
		/** Dependencies on other workspaces */
		dependencies?: string[];
		/** Priority level */
		priority?: "low" | "medium" | "high";
	};
}

/**
 * Specification for building a workspace packet
 */
export interface WorkspaceSpec {
	phaseId: string;
	workspaceId: string;
	role: TokenRole;
	goal: string;
	allowedFiles?: string[];
	forbiddenFiles?: string[];
	acceptanceCriteria?: string[] | AcceptanceCriterion[];
	targetCommand?: string | null;
	stateSummary?: string;
	relevantSnippets?: RelevantSnippet[];
	outputContract?: string;
	maxInputTokens?: number;
	metadata?: WorkspacePacket["metadata"];
}

/**
 * Compact context packet builder
 *
 * Builds workspace packets that exclude:
 * - Full implementation plans
 * - Full chat history
 * - Full repository context
 *
 * Includes only:
 * - Current workspace context
 * - Summarized prior state
 * - Relevant code snippets
 * - Acceptance criteria
 */
export class PacketBuilder {
	/**
	 * Build a workspace packet from a specification
	 *
	 * @param spec - Workspace specification
	 * @returns Compact workspace packet
	 */
	build(spec: WorkspaceSpec): WorkspacePacket {
		// Normalize acceptance criteria
		const acceptanceCriteria: AcceptanceCriterion[] = (spec.acceptanceCriteria || []).map((ac) =>
			typeof ac === "string" ? { description: ac, verified: false } : ac,
		);

		// Build the packet
		const packet: WorkspacePacket = {
			phaseId: spec.phaseId,
			workspaceId: spec.workspaceId,
			role: spec.role,
			goal: spec.goal,
			allowedFiles: spec.allowedFiles || [],
			forbiddenFiles: spec.forbiddenFiles || [],
			acceptanceCriteria,
			targetCommand: spec.targetCommand ?? null,
			stateSummary: spec.stateSummary || "",
			relevantSnippets: spec.relevantSnippets || [],
			outputContract: spec.outputContract || "VERDICT: COMPLETE | BLOCKED | FAILED",
			budget: {
				maxInputTokens: spec.maxInputTokens || 12000, // Default to worker budget
				estimatedInputTokens: 0, // Will be calculated
			},
			metadata: spec.metadata,
		};

		// Estimate token count for the packet
		packet.budget.estimatedInputTokens = this.estimatePacketTokens(packet);

		return packet;
	}

	/**
	 * Estimate token count for a workspace packet
	 *
	 * @param packet - Workspace packet
	 * @returns Estimated token count
	 */
	estimatePacketTokens(packet: WorkspacePacket): number {
		let tokens = 0;

		// Goal
		tokens += estimateTokensFromString(packet.goal);

		// State summary
		tokens += estimateTokensFromString(packet.stateSummary);

		// Acceptance criteria
		for (const ac of packet.acceptanceCriteria) {
			tokens += estimateTokensFromString(ac.description);
		}

		// Relevant snippets
		for (const snippet of packet.relevantSnippets) {
			tokens += estimateTokensFromString(snippet.file);
			tokens += estimateTokensFromString(snippet.content);
		}

		// File lists (minimal overhead)
		tokens += estimateTokensFromString(packet.allowedFiles.join(", "));
		tokens += estimateTokensFromString(packet.forbiddenFiles.join(", "));

		// Output contract
		tokens += estimateTokensFromString(packet.outputContract);

		// Add overhead for packet structure (~100 tokens)
		tokens += 100;

		return tokens;
	}

	/**
	 * Build a packet from messages (extract context from conversation)
	 *
	 * This is a helper for converting existing conversation context
	 * into a compact packet format.
	 *
	 * @param spec - Base workspace specification
	 * @param messages - Messages to extract context from
	 * @param maxSnippetTokens - Maximum tokens to include from messages
	 * @returns Compact workspace packet
	 */
	buildFromMessages(spec: WorkspaceSpec, messages: AgentMessage[], maxSnippetTokens = 2000): WorkspacePacket {
		// Extract relevant snippets from recent messages
		const snippets: RelevantSnippet[] = [];
		let snippetTokens = 0;

		// Walk messages in reverse (most recent first)
		for (let i = messages.length - 1; i >= 0 && snippetTokens < maxSnippetTokens; i--) {
			const message = messages[i];

			// Extract file references from tool results
			if (message.role === "toolResult") {
				const content = Array.isArray(message.content)
					? message.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")
					: message.content;

				if (typeof content === "string" && content.length > 0) {
					const tokens = estimateTokensFromString(content);
					if (snippetTokens + tokens <= maxSnippetTokens) {
						snippets.unshift({
							file: message.toolName || "unknown",
							content: content.slice(0, 500), // Limit snippet size
						});
						snippetTokens += tokens;
					}
				}
			}
		}

		// Build packet with extracted snippets
		return this.build({
			...spec,
			relevantSnippets: [...snippets, ...(spec.relevantSnippets || [])],
		});
	}

	/**
	 * Validate that a packet is within budget
	 *
	 * @param packet - Workspace packet
	 * @returns True if packet is within budget
	 */
	isWithinBudget(packet: WorkspacePacket): boolean {
		return packet.budget.estimatedInputTokens <= packet.budget.maxInputTokens;
	}

	/**
	 * Compact a packet by removing snippets until it fits within budget
	 *
	 * @param packet - Workspace packet
	 * @returns Compacted packet within budget
	 */
	compactToFitBudget(packet: WorkspacePacket): WorkspacePacket {
		if (this.isWithinBudget(packet)) {
			return packet;
		}

		// Create a copy to modify
		const compacted: WorkspacePacket = { ...packet };

		// Remove snippets one by one until within budget
		while (compacted.relevantSnippets.length > 0 && !this.isWithinBudget(compacted)) {
			compacted.relevantSnippets = compacted.relevantSnippets.slice(0, -1);
			compacted.budget.estimatedInputTokens = this.estimatePacketTokens(compacted);
		}

		// If still over budget, truncate state summary
		if (!this.isWithinBudget(compacted)) {
			const maxSummaryTokens = Math.floor(compacted.budget.maxInputTokens * 0.3);
			const summaryChars = maxSummaryTokens * 4; // Reverse of chars/4 heuristic
			compacted.stateSummary = compacted.stateSummary.slice(0, summaryChars);
			compacted.budget.estimatedInputTokens = this.estimatePacketTokens(compacted);
		}

		return compacted;
	}

	/**
	 * Serialize packet to JSON string
	 *
	 * @param packet - Workspace packet
	 * @param pretty - Whether to pretty-print JSON
	 * @returns JSON string
	 */
	serialize(packet: WorkspacePacket, pretty = false): string {
		return JSON.stringify(packet, null, pretty ? 2 : 0);
	}

	/**
	 * Deserialize packet from JSON string
	 *
	 * @param json - JSON string
	 * @returns Workspace packet
	 */
	deserialize(json: string): WorkspacePacket {
		return JSON.parse(json) as WorkspacePacket;
	}
}

/**
 * Create a packet builder instance
 *
 * @returns Packet builder
 */
export function createPacketBuilder(): PacketBuilder {
	return new PacketBuilder();
}
