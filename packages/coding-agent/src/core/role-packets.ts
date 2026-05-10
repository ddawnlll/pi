/**
 * Agent Role Packet Builders - P2 Workstream 7.E
 *
 * Generates compact, role-specific context packets for worker agents.
 * Enforces P1 budget limits and prevents full repo/plan/chat injection.
 */

import * as crypto from "node:crypto";
import type { TokenRole } from "@earendil-works/pi-agent-core";
import { estimateTokensFromString } from "@earendil-works/pi-agent-core";
import type { Workspace } from "./workspace-schema.js";
import type { WorkspaceState } from "./plan-state.js";
import { PacketBuilder, type WorkspacePacket } from "./context-packet.js";

/**
 * Role-specific packet configuration
 */
export interface RolePacketConfig {
	/** Role type */
	role: TokenRole;
	/** Maximum input tokens for this role */
	maxInputTokens: number;
	/** Whether to include detailed context */
	includeDetailedContext: boolean;
	/** Whether to include prior state summary */
	includePriorState: boolean;
	/** Maximum snippet tokens */
	maxSnippetTokens: number;
}

/**
 * Default role configurations
 */
export const ROLE_CONFIGS: Record<string, RolePacketConfig> = {
	worker: {
		role: "worker",
		maxInputTokens: 12000,
		includeDetailedContext: true,
		includePriorState: true,
		maxSnippetTokens: 2000,
	},
	flash: {
		role: "flash",
		maxInputTokens: 4000,
		includeDetailedContext: false,
		includePriorState: false,
		maxSnippetTokens: 500,
	},
	lead: {
		role: "lead",
		maxInputTokens: 24000,
		includeDetailedContext: true,
		includePriorState: true,
		maxSnippetTokens: 4000,
	},
	reviewer: {
		role: "reviewer",
		maxInputTokens: 16000,
		includeDetailedContext: true,
		includePriorState: true,
		maxSnippetTokens: 3000,
	},
};

/**
 * Packet with hash for consistency tracking
 */
export interface HashedPacket {
	/** Workspace packet */
	packet: WorkspacePacket;
	/** SHA-256 hash of packet content */
	hash: string;
	/** Timestamp when packet was created */
	createdAt: number;
}

/**
 * Role packet builder
 *
 * Creates compact, role-specific packets that:
 * - Exclude full plan markdown
 * - Exclude full chat history
 * - Exclude full repository context
 * - Stay within role budget limits
 * - Include only workspace-scoped context
 */
export class RolePacketBuilder {
	private packetBuilder: PacketBuilder;

	constructor() {
		this.packetBuilder = new PacketBuilder();
	}

	/**
	 * Build worker packet
	 *
	 * Worker packets include:
	 * - Workspace goal and acceptance criteria
	 * - Allowed/forbidden files
	 * - Prior state summary (brief)
	 * - Relevant code snippets (limited)
	 *
	 * @param workspace - Workspace specification
	 * @param state - Current workspace state
	 * @param priorStateSummary - Brief summary of prior execution state
	 * @returns Hashed packet
	 */
	buildWorkerPacket(workspace: Workspace, state: WorkspaceState, priorStateSummary = ""): HashedPacket {
		const config = ROLE_CONFIGS.worker;

		const packet = this.packetBuilder.build({
			phaseId: "P2", // Will be parameterized in full implementation
			workspaceId: workspace.id,
			role: config.role,
			goal: workspace.title,
			allowedFiles: workspace.capabilities?.canEdit || [],
			forbiddenFiles: workspace.capabilities?.cannotEdit || [],
			acceptanceCriteria: workspace.acceptanceCriteria || [],
			targetCommand: workspace.targetCommand,
			stateSummary: this.truncateSummary(priorStateSummary, 500),
			relevantSnippets: [], // Will be populated from context in full implementation
			outputContract: "VERDICT: COMPLETE | BLOCKED | FAILED",
			maxInputTokens: config.maxInputTokens,
		});

		return this.hashPacket(packet);
	}

	/**
	 * Build flash packet (minimal context for quick fixes)
	 *
	 * Flash packets include:
	 * - Minimal goal description
	 * - Specific file/line to fix
	 * - Error message or test failure
	 *
	 * @param workspace - Workspace specification
	 * @param state - Current workspace state
	 * @param errorContext - Error message or failure details
	 * @returns Hashed packet
	 */
	buildFlashPacket(workspace: Workspace, state: WorkspaceState, errorContext: string): HashedPacket {
		const config = ROLE_CONFIGS.flash;

		// Flash packets are extremely minimal
		const packet = this.packetBuilder.build({
			phaseId: "P2",
			workspaceId: workspace.id,
			role: config.role,
			goal: `Quick fix for ${workspace.id}: ${this.truncateSummary(errorContext, 200)}`,
			allowedFiles: workspace.capabilities?.canEdit || [],
			forbiddenFiles: workspace.capabilities?.cannotEdit || [],
			acceptanceCriteria: ["Fix the immediate error", "Tests pass"],
			targetCommand: workspace.targetCommand,
			stateSummary: `Attempt ${state.attempts + 1} of ${workspace.maxRetries}`,
			relevantSnippets: [],
			outputContract: "VERDICT: FIXED | FAILED",
			maxInputTokens: config.maxInputTokens,
		});

		return this.hashPacket(packet);
	}

	/**
	 * Build reviewer packet
	 *
	 * Reviewer packets include:
	 * - Workspace goal and acceptance criteria
	 * - Changed files (diffs only, not full content)
	 * - Test results
	 * - Worker report
	 *
	 * @param workspace - Workspace specification
	 * @param state - Current workspace state
	 * @param workerReport - Report from worker execution
	 * @returns Hashed packet
	 */
	buildReviewerPacket(workspace: Workspace, state: WorkspaceState, workerReport: string): HashedPacket {
		const config = ROLE_CONFIGS.reviewer;

		const packet = this.packetBuilder.build({
			phaseId: "P2",
			workspaceId: workspace.id,
			role: config.role,
			goal: `Review ${workspace.id}: ${workspace.title}`,
			allowedFiles: [], // Reviewer doesn't edit
			forbiddenFiles: [],
			acceptanceCriteria: workspace.acceptanceCriteria || [],
			targetCommand: null,
			stateSummary: this.truncateSummary(workerReport, 1000),
			relevantSnippets: [],
			outputContract: "VERDICT: APPROVED | REJECTED | NEEDS_REVISION",
			maxInputTokens: config.maxInputTokens,
		});

		return this.hashPacket(packet);
	}

	/**
	 * Build lead packet (for complex planning/coordination)
	 *
	 * Lead packets include:
	 * - Workspace goal and dependencies
	 * - Prior workspace results (summaries only)
	 * - Acceptance criteria
	 * - Larger context budget
	 *
	 * @param workspace - Workspace specification
	 * @param state - Current workspace state
	 * @param dependencyResults - Summaries of completed dependencies
	 * @returns Hashed packet
	 */
	buildLeadPacket(
		workspace: Workspace,
		state: WorkspaceState,
		dependencyResults: Record<string, string>,
	): HashedPacket {
		const config = ROLE_CONFIGS.lead;

		// Build dependency context
		const depSummary = Object.entries(dependencyResults)
			.map(([id, result]) => `${id}: ${this.truncateSummary(result, 200)}`)
			.join("\n");

		const packet = this.packetBuilder.build({
			phaseId: "P2",
			workspaceId: workspace.id,
			role: config.role,
			goal: workspace.title,
			allowedFiles: workspace.capabilities?.canEdit || [],
			forbiddenFiles: workspace.capabilities?.cannotEdit || [],
			acceptanceCriteria: workspace.acceptanceCriteria || [],
			targetCommand: workspace.targetCommand,
			stateSummary: `Dependencies completed:\n${depSummary}`,
			relevantSnippets: [],
			outputContract: "VERDICT: COMPLETE | BLOCKED | FAILED",
			maxInputTokens: config.maxInputTokens,
		});

		return this.hashPacket(packet);
	}

	/**
	 * Hash a packet for consistency tracking
	 *
	 * @param packet - Workspace packet
	 * @returns Hashed packet
	 */
	private hashPacket(packet: WorkspacePacket): HashedPacket {
		const content = JSON.stringify(packet, null, 0);
		const hash = crypto.createHash("sha256").update(content).digest("hex");

		return {
			packet,
			hash,
			createdAt: Date.now(),
		};
	}

	/**
	 * Truncate summary to fit within token budget
	 *
	 * @param summary - Summary text
	 * @param maxTokens - Maximum tokens
	 * @returns Truncated summary
	 */
	private truncateSummary(summary: string, maxTokens: number): string {
		const estimatedTokens = estimateTokensFromString(summary);
		if (estimatedTokens <= maxTokens) {
			return summary;
		}

		// Truncate to approximate character count
		const maxChars = maxTokens * 4; // Reverse of chars/4 heuristic
		return summary.slice(0, maxChars) + "... [truncated]";
	}

	/**
	 * Validate packet is within budget
	 *
	 * @param packet - Workspace packet
	 * @returns True if within budget
	 */
	validatePacketBudget(packet: WorkspacePacket): boolean {
		return this.packetBuilder.isWithinBudget(packet);
	}

	/**
	 * Compact packet to fit within budget
	 *
	 * @param packet - Workspace packet
	 * @returns Compacted packet
	 */
	compactPacket(packet: WorkspacePacket): WorkspacePacket {
		return this.packetBuilder.compactToFitBudget(packet);
	}
}

/**
 * Create a role packet builder instance
 *
 * @returns Role packet builder
 */
export function createRolePacketBuilder(): RolePacketBuilder {
	return new RolePacketBuilder();
}

/**
 * Verify packet hash
 *
 * @param hashedPacket - Hashed packet to verify
 * @returns True if hash is valid
 */
export function verifyPacketHash(hashedPacket: HashedPacket): boolean {
	const content = JSON.stringify(hashedPacket.packet, null, 0);
	const computedHash = crypto.createHash("sha256").update(content).digest("hex");
	return computedHash === hashedPacket.hash;
}
