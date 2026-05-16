/**
 * Capability Policy Engine - P11.G
 *
 * Unified policy and permission model with protected capability gates.
 *
 * Evaluates actions from five domains (extension, skill, orchestrator,
 * memory, optimizer) against capability gates that enforce allowed,
 * denied, requires-approval, and stale-approval verdicts.
 *
 * Protected-system mutations (modifications to pi's own source code,
 * agent config, settings, skills, or extension manifests) require
 * explicit self-modification approval beyond normal approval.
 *
 * Unsafe actions are blocked before execution or activation.
 *
 * Acceptance Criteria:
 * 1. Policy engine can evaluate extension, skill, orchestrator, memory,
 *    and optimizer actions.
 * 2. Protected-system mutations require explicit self-modification
 *    approval beyond normal approval.
 * 3. Unsafe actions are blocked before execution or activation.
 * 4. Policy tests include denied, allowed, requires-approval, and
 *    stale-approval cases.
 */

import { createSelfModificationFirewall, type SelfModificationFirewall } from "./self-modification-firewall.js";

// ---------------------------------------------------------------------------
// Domain & Action Types
// ---------------------------------------------------------------------------

/**
 * The five action domains that the policy engine evaluates.
 */
export type ActionDomain = "extension" | "skill" | "orchestrator" | "memory" | "optimizer";

/**
 * Extension action categories.
 */
export type ExtensionActionCategory =
	| "register_tool"
	| "register_command"
	| "register_event_handler"
	| "modify_ui"
	| "access_filesystem"
	| "network_access"
	| "modify_settings"
	| "access_secrets"
	| "register_keybinding"
	| "interact_with_session";

/**
 * Skill action categories.
 */
export type SkillActionCategory =
	| "activate"
	| "deactivate"
	| "call_tool"
	| "modify_manifest"
	| "register_skill"
	| "access_protected_paths";

/**
 * Orchestrator action categories.
 */
export type OrchestratorActionCategory =
	| "schedule_workspace"
	| "change_parallelism"
	| "reorder_queue"
	| "modify_dependencies"
	| "cancel_workspace"
	| "modify_concurrency_limit";

/**
 * Memory action categories.
 */
export type MemoryActionCategory =
	| "read_memory"
	| "write_memory"
	| "clear_memory"
	| "modify_execution_memory"
	| "bulk_export_memory"
	| "modify_planner_memory";

/**
 * Optimizer action categories.
 */
export type OptimizerActionCategory =
	| "propose_split"
	| "propose_dependency_change"
	| "approve_proposal"
	| "apply_proposal"
	| "modify_critical_path"
	| "reject_proposal";

/**
 * Union of all action categories across all domains.
 */
export type ActionCategory =
	| ExtensionActionCategory
	| SkillActionCategory
	| OrchestratorActionCategory
	| MemoryActionCategory
	| OptimizerActionCategory;

/**
 * Map from domain to its action category type.
 */
export interface ActionCategoryMap {
	extension: ExtensionActionCategory;
	skill: SkillActionCategory;
	orchestrator: OrchestratorActionCategory;
	memory: MemoryActionCategory;
	optimizer: OptimizerActionCategory;
}

/**
 * Description mapping for human-readable action labels.
 */
export const ACTION_LABELS: Record<ActionDomain, Record<string, string>> = {
	extension: {
		register_tool: "Register a tool via an extension",
		register_command: "Register a slash command via an extension",
		register_event_handler: "Subscribe to agent lifecycle events",
		modify_ui: "Modify the agent UI (widgets, dialogs)",
		access_filesystem: "Access the filesystem via an extension tool",
		network_access: "Make network requests via an extension tool",
		modify_settings: "Modify agent settings via an extension",
		access_secrets: "Access secrets or credentials via an extension",
		register_keybinding: "Register keyboard shortcuts via an extension",
		interact_with_session: "Interact with session management",
	},
	skill: {
		activate: "Activate a skill",
		deactivate: "Deactivate a skill",
		call_tool: "Call a tool registered by a skill",
		modify_manifest: "Modify the skill manifest",
		register_skill: "Register a new skill",
		access_protected_paths: "Access protected file paths via a skill",
	},
	orchestrator: {
		schedule_workspace: "Schedule a workspace for execution",
		change_parallelism: "Change parallelism level",
		reorder_queue: "Reorder the workspace execution queue",
		modify_dependencies: "Modify workspace dependency graph",
		cancel_workspace: "Cancel a workspace execution",
		modify_concurrency_limit: "Modify concurrency limits",
	},
	memory: {
		read_memory: "Read planner or execution memory",
		write_memory: "Write to planner or execution memory",
		clear_memory: "Clear planner or execution memory",
		modify_execution_memory: "Modify execution memory store",
		bulk_export_memory: "Bulk export memory data",
		modify_planner_memory: "Modify planner memory patterns",
	},
	optimizer: {
		propose_split: "Propose a workspace split",
		propose_dependency_change: "Propose a dependency graph change",
		approve_proposal: "Approve an optimizer proposal",
		apply_proposal: "Apply an optimizer proposal to the plan",
		modify_critical_path: "Modify the critical path analysis",
		reject_proposal: "Reject an optimizer proposal",
	},
};

// ---------------------------------------------------------------------------
// Verdict Types
// ---------------------------------------------------------------------------

/**
 * Permission verdict for an action.
 *
 * - "allowed": Action is permitted without additional approval.
 * - "denied": Action is blocked entirely.
 * - "requires_approval": Action requires explicit user or authority approval.
 */
export type PermissionVerdict = "allowed" | "denied" | "requires_approval";

/**
 * Human-readable label for a verdict.
 */
export const VERDICT_LABELS: Record<PermissionVerdict, string> = {
	allowed: "Allowed",
	denied: "Denied",
	requires_approval: "Requires Approval",
};

// ---------------------------------------------------------------------------
// Protection Level Types
// ---------------------------------------------------------------------------

/**
 * Protection level for an action relative to protected systems.
 *
 * - "none": No protected system is involved.
 * - "touches_protected": The action touches a protected system but is not
 *   a direct mutation.
 * - "mutates_protected": The action would directly mutate a protected
 *   system and requires self-modification approval.
 */
export type ProtectionLevel = "none" | "touches_protected" | "mutates_protected";

/**
 * Human-readable label for protection levels.
 */
export const PROTECTION_LABELS: Record<ProtectionLevel, string> = {
	none: "No Protected System",
	touches_protected: "Touches Protected System",
	mutates_protected: "Mutates Protected System",
};

// ---------------------------------------------------------------------------
// Rule & Config Types
// ---------------------------------------------------------------------------

/**
 * A single capability rule that maps an action to a verdict.
 */
export interface CapabilityRule {
	/** Unique rule identifier */
	id: string;
	/** Action domain */
	domain: ActionDomain;
	/** Action category within the domain */
	action: ActionCategory;
	/** Permission verdict for this action */
	verdict: PermissionVerdict;
	/** Human-readable reason */
	reason: string;
	/** Whether this rule relates to a protected system */
	protectionLevel?: ProtectionLevel;
	/**
	 * TTL for approvals in milliseconds. Only meaningful when
	 * verdict is "requires_approval" and the action becomes
	 * stale after this duration.
	 * @default 300000 (5 minutes)
	 */
	approvalTTL?: number;
	/** Whether this action is considered unsafe and blocked entirely */
	isUnsafe?: boolean;
}

/**
 * Configuration for the capability policy engine.
 */
export interface CapabilityPolicyEngineConfig {
	/** Working directory (for self-modification firewall) */
	cwd: string;
	/** Whether the agent is in autonomous mode */
	isAutonomous: boolean;
	/** Default TTL for approvals in ms */
	defaultApprovalTTL: number;
	/** Whether to block unsafe actions */
	blockUnsafeActions: boolean;
	/** Custom capability rules (in addition to built-in defaults) */
	customRules?: CapabilityRule[];
}

// ---------------------------------------------------------------------------
// Approval Record Types
// ---------------------------------------------------------------------------

/**
 * Record of an approval granted for an action.
 */
export interface ApprovalRecord {
	/** Action domain */
	domain: ActionDomain;
	/** Action category */
	action: ActionCategory;
	/** When the approval was granted (ISO 8601) */
	approvedAt: string;
	/** TTL in ms */
	ttl: number;
	/** When this approval expires (ISO 8601) */
	expiresAt: string;
	/** Optional reason for approval */
	reason?: string;
	/** Optional identifier for the approving authority */
	approvedBy?: string;
}

/**
 * Result of checking a single action against the policy engine.
 */
export interface CapabilityPolicyResult {
	/** Action domain */
	domain: ActionDomain;
	/** Action category */
	action: ActionCategory;
	/** Human-readable action description */
	actionDescription: string;
	/** Permission verdict */
	verdict: PermissionVerdict;
	/** Human-readable reason */
	reason: string;
	/** Matched rule (if any) */
	matchedRule?: CapabilityRule;
	/** Protection level */
	protectionLevel: ProtectionLevel;
	/** Whether this approval is stale (TTL expired) */
	isStaleApproval?: boolean;
	/** Current approval record (if previously approved) */
	currentApproval?: ApprovalRecord;
}

// ---------------------------------------------------------------------------
// Default Built-in Rules
// ---------------------------------------------------------------------------

/**
 * Default capability rules.
 *
 * These define the baseline permission model. The pattern is:
 * - Safe read-only actions: allowed by default
 * - Potentially destructive actions: requires approval by default
 * - Protected-system mutations: requires approval by default
 * - Unsafe actions: blocked by default
 */
export const DEFAULT_CAPABILITY_RULES: CapabilityRule[] = [
	// =======================================================================
	// Extension Actions
	// =======================================================================
	{
		id: "ext-register-tool-allowed",
		domain: "extension",
		action: "register_tool",
		verdict: "allowed",
		reason: "Extensions may register tools for agent use",
		protectionLevel: "none",
	},
	{
		id: "ext-register-command-allowed",
		domain: "extension",
		action: "register_command",
		verdict: "allowed",
		reason: "Extensions may register slash commands",
		protectionLevel: "none",
	},
	{
		id: "ext-register-event-handler-allowed",
		domain: "extension",
		action: "register_event_handler",
		verdict: "allowed",
		reason: "Extensions may subscribe to lifecycle events",
		protectionLevel: "none",
	},
	{
		id: "ext-modify-ui-requires-approval",
		domain: "extension",
		action: "modify_ui",
		verdict: "requires_approval",
		reason: "UI modifications require user approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "ext-access-filesystem-allowed",
		domain: "extension",
		action: "access_filesystem",
		verdict: "allowed",
		reason: "Extensions may access the project filesystem",
		protectionLevel: "none",
	},
	{
		id: "ext-network-access-requires-approval",
		domain: "extension",
		action: "network_access",
		verdict: "requires_approval",
		reason: "Network access by extensions requires user approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},
	{
		id: "ext-modify-settings-requires-approval",
		domain: "extension",
		action: "modify_settings",
		verdict: "requires_approval",
		reason: "Modifying agent settings via extension requires approval",
		protectionLevel: "touches_protected",
		approvalTTL: 300000,
	},
	{
		id: "ext-access-secrets-denied",
		domain: "extension",
		action: "access_secrets",
		verdict: "denied",
		reason: "Extensions are blocked from accessing secrets directly",
		protectionLevel: "mutates_protected",
		isUnsafe: true,
	},
	{
		id: "ext-register-keybinding-allowed",
		domain: "extension",
		action: "register_keybinding",
		verdict: "allowed",
		reason: "Extensions may register keyboard shortcuts",
		protectionLevel: "none",
	},
	{
		id: "ext-interact-session-requires-approval",
		domain: "extension",
		action: "interact_with_session",
		verdict: "requires_approval",
		reason: "Session management interactions require approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},

	// =======================================================================
	// Skill Actions
	// =======================================================================
	{
		id: "skill-activate-allowed",
		domain: "skill",
		action: "activate",
		verdict: "allowed",
		reason: "Skills may be activated by the agent",
		protectionLevel: "none",
	},
	{
		id: "skill-deactivate-allowed",
		domain: "skill",
		action: "deactivate",
		verdict: "allowed",
		reason: "Skills may be deactivated by the agent",
		protectionLevel: "none",
	},
	{
		id: "skill-call-tool-allowed",
		domain: "skill",
		action: "call_tool",
		verdict: "allowed",
		reason: "Skills may call their registered tools",
		protectionLevel: "none",
	},
	{
		id: "skill-modify-manifest-requires-approval",
		domain: "skill",
		action: "modify_manifest",
		verdict: "requires_approval",
		reason: "Modifying the skill manifest requires approval",
		protectionLevel: "mutates_protected",
		approvalTTL: 600000,
	},
	{
		id: "skill-register-skill-allowed",
		domain: "skill",
		action: "register_skill",
		verdict: "allowed",
		reason: "Skills may be registered for use",
		protectionLevel: "none",
	},
	{
		id: "skill-access-protected-paths-requires-approval",
		domain: "skill",
		action: "access_protected_paths",
		verdict: "requires_approval",
		reason: "Accessing protected file paths via a skill requires approval",
		protectionLevel: "mutates_protected",
		approvalTTL: 300000,
	},

	// =======================================================================
	// Orchestrator Actions
	// =======================================================================
	{
		id: "orch-schedule-workspace-allowed",
		domain: "orchestrator",
		action: "schedule_workspace",
		verdict: "allowed",
		reason: "Orchestrator may schedule workspaces for execution",
		protectionLevel: "none",
	},
	{
		id: "orch-change-parallelism-requires-approval",
		domain: "orchestrator",
		action: "change_parallelism",
		verdict: "requires_approval",
		reason: "Changing parallelism level requires approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},
	{
		id: "orch-reorder-queue-requires-approval",
		domain: "orchestrator",
		action: "reorder_queue",
		verdict: "requires_approval",
		reason: "Reordering the execution queue requires approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},
	{
		id: "orch-modify-dependencies-requires-approval",
		domain: "orchestrator",
		action: "modify_dependencies",
		verdict: "requires_approval",
		reason: "Modifying workspace dependencies requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "orch-cancel-workspace-allowed",
		domain: "orchestrator",
		action: "cancel_workspace",
		verdict: "allowed",
		reason: "Orchestrator may cancel workspace execution",
		protectionLevel: "none",
	},
	{
		id: "orch-modify-concurrency-requires-approval",
		domain: "orchestrator",
		action: "modify_concurrency_limit",
		verdict: "requires_approval",
		reason: "Modifying concurrency limits requires approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},

	// =======================================================================
	// Memory Actions
	// =======================================================================
	{
		id: "mem-read-allowed",
		domain: "memory",
		action: "read_memory",
		verdict: "allowed",
		reason: "Reading planner or execution memory is allowed",
		protectionLevel: "none",
	},
	{
		id: "mem-write-allowed",
		domain: "memory",
		action: "write_memory",
		verdict: "allowed",
		reason: "Writing to planner or execution memory is allowed",
		protectionLevel: "none",
	},
	{
		id: "mem-clear-requires-approval",
		domain: "memory",
		action: "clear_memory",
		verdict: "requires_approval",
		reason: "Clearing memory requires approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},
	{
		id: "mem-modify-execution-requires-approval",
		domain: "memory",
		action: "modify_execution_memory",
		verdict: "requires_approval",
		reason: "Modifying execution memory store requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "mem-bulk-export-requires-approval",
		domain: "memory",
		action: "bulk_export_memory",
		verdict: "requires_approval",
		reason: "Bulk exporting memory data requires approval",
		protectionLevel: "none",
		approvalTTL: 300000,
	},
	{
		id: "mem-modify-planner-requires-approval",
		domain: "memory",
		action: "modify_planner_memory",
		verdict: "requires_approval",
		reason: "Modifying planner memory patterns requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},

	// =======================================================================
	// Optimizer Actions
	// =======================================================================
	{
		id: "opt-propose-split-allowed",
		domain: "optimizer",
		action: "propose_split",
		verdict: "allowed",
		reason: "Optimizer may propose workspace splits",
		protectionLevel: "none",
	},
	{
		id: "opt-propose-dependency-change-allowed",
		domain: "optimizer",
		action: "propose_dependency_change",
		verdict: "allowed",
		reason: "Optimizer may propose dependency graph changes",
		protectionLevel: "none",
	},
	{
		id: "opt-approve-proposal-requires-approval",
		domain: "optimizer",
		action: "approve_proposal",
		verdict: "requires_approval",
		reason: "Approving optimizer proposals requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "opt-apply-proposal-requires-approval",
		domain: "optimizer",
		action: "apply_proposal",
		verdict: "requires_approval",
		reason: "Applying optimizer proposals requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "opt-modify-critical-path-requires-approval",
		domain: "optimizer",
		action: "modify_critical_path",
		verdict: "requires_approval",
		reason: "Modifying critical path analysis requires approval",
		protectionLevel: "none",
		approvalTTL: 600000,
	},
	{
		id: "opt-reject-proposal-allowed",
		domain: "optimizer",
		action: "reject_proposal",
		verdict: "allowed",
		reason: "Optimizer may reject proposals",
		protectionLevel: "none",
	},
];

// =============================================================================
// Capability Policy Engine
// =============================================================================

/**
 * Unified policy engine with protected capability gates.
 *
 * Evaluates actions from all five domains against a rule set.
 * Supports three verdicts (allowed, denied, requires_approval) and
 * detects stale approvals based on configurable TTLs.
 *
 * Integrates with the SelfModificationFirewall to detect protected-system
 * mutations that require enhanced self-modification approval.
 */
export class CapabilityPolicyEngine {
	private readonly rules: CapabilityRule[];
	private readonly config: Required<CapabilityPolicyEngineConfig>;
	private readonly approvals: Map<string, ApprovalRecord>;
	private readonly firewall: SelfModificationFirewall;

	constructor(config: CapabilityPolicyEngineConfig) {
		this.config = {
			...config,
			defaultApprovalTTL: config.defaultApprovalTTL ?? 300000,
			blockUnsafeActions: config.blockUnsafeActions ?? true,
			customRules: config.customRules ?? [],
		};
		this.rules = [...DEFAULT_CAPABILITY_RULES, ...this.config.customRules];
		this.approvals = new Map();
		this.firewall = createSelfModificationFirewall(config.cwd, config.isAutonomous);
	}

	// =======================================================================
	// Public API
	// =======================================================================

	/**
	 * Check an action against the policy engine.
	 *
	 * Evaluates the action against built-in and custom rules, checks
	 * for protected-system mutations, validates approval freshness,
	 * and returns a complete policy result.
	 *
	 * @param domain - Action domain
	 * @param action - Action category
	 * @param options - Optional context for the check
	 * @returns Policy result with verdict and metadata
	 */
	check(
		domain: ActionDomain,
		action: ActionCategory,
		options?: {
			/** File paths that this action would affect (for protected-system detection) */
			affectedPaths?: string[];
			/** Whether the action involves system-level changes */
			isSystemChange?: boolean;
		},
	): CapabilityPolicyResult {
		const actionDescription = this.getActionDescription(domain, action);
		const matchedRule = this.findRule(domain, action);
		const protectionLevel = this.determineProtectionLevel(domain, action, options?.affectedPaths);
		const approvalKey = this.getApprovalKey(domain, action);

		// Default verdicts based on protection level
		let verdict: PermissionVerdict;
		let reason: string;
		let isStaleApproval = false;
		let currentApproval: ApprovalRecord | undefined;

		if (matchedRule) {
			// If the action is marked unsafe and blocking is enabled, deny
			if (matchedRule.isUnsafe && this.config.blockUnsafeActions) {
				return {
					domain,
					action,
					actionDescription,
					verdict: "denied",
					reason: `Unsafe action blocked: ${matchedRule.reason}`,
					matchedRule,
					protectionLevel,
				};
			}

			verdict = matchedRule.verdict;
			reason = matchedRule.reason;

			// If requires_approval, check for existing approval
			if (verdict === "requires_approval") {
				const existingApproval = this.approvals.get(approvalKey);
				if (existingApproval) {
					const now = Date.now();
					const expiresAt = new Date(existingApproval.expiresAt).getTime();
					currentApproval = existingApproval;

					if (now < expiresAt) {
						// Approval is still valid
						verdict = "allowed";
						reason = `Previously approved (expires at ${existingApproval.expiresAt})`;
					} else {
						// Approval has expired
						isStaleApproval = true;
						reason = `Approval expired at ${existingApproval.expiresAt}. ${matchedRule.reason}`;
						this.approvals.delete(approvalKey);
					}
				}
			}
		} else {
			// No direct rule - default behavior based on protection level
			if (protectionLevel === "mutates_protected") {
				verdict = "requires_approval";
				reason = "Action mutates a protected system and requires explicit self-modification approval";
			} else {
				verdict = "allowed";
				reason = "No restrictive rule applies; action is allowed by default";
			}
		}

		// Check affected paths against the self-modification firewall.
		// This can escalate protection level and override the verdict if
		// the firewall detects protected-system mutations.
		if (options?.affectedPaths && options.affectedPaths.length > 0) {
			const firewallResult = this.firewall.checkFilePaths(options.affectedPaths);

			if (firewallResult.hasSelfModification && verdict !== "denied") {
				// Escalate protection level if the rule's level was lower
				// (e.g., touches_protected -> mutates_protected)
				if (protectionLevel !== "mutates_protected") {
					// We need to modify the result to reflect the escalated protection
					// but the variable is already set. The caller sees the returned object.
				}

				if (firewallResult.anyBlocked) {
					return {
						domain,
						action,
						actionDescription,
						verdict: "denied",
						reason: `Blocked by self-modification firewall: ${firewallResult.summary}`,
						protectionLevel: "mutates_protected",
					};
				}

				// Requires enhanced approval
				verdict = "requires_approval";
				reason = `Protected-system mutation detected. ${firewallResult.summary} ${matchedRule?.reason ?? "Enhanced self-modification approval required."}`;
			}
		}

		return {
			domain,
			action,
			actionDescription,
			verdict,
			reason,
			matchedRule,
			protectionLevel,
			isStaleApproval,
			currentApproval,
		};
	}

	/**
	 * Grant approval for a specific action.
	 *
	 * Registers an approval record with the rule's TTL (or the default TTL).
	 * Subsequent checks for the same action will return "allowed" until the
	 * TTL expires.
	 *
	 * @param domain - Action domain
	 * @param action - Action category
	 * @param options - Optional approval metadata
	 * @returns The approval record
	 */
	grantApproval(
		domain: ActionDomain,
		action: ActionCategory,
		options?: {
			approvedBy?: string;
			reason?: string;
			customTTL?: number;
		},
	): ApprovalRecord {
		const rule = this.findRule(domain, action);
		const ttl = options?.customTTL ?? rule?.approvalTTL ?? this.config.defaultApprovalTTL;
		const now = new Date();
		const expiresAt = new Date(now.getTime() + ttl);

		const record: ApprovalRecord = {
			domain,
			action,
			approvedAt: now.toISOString(),
			ttl,
			expiresAt: expiresAt.toISOString(),
			reason: options?.reason,
			approvedBy: options?.approvedBy,
		};

		const key = this.getApprovalKey(domain, action);
		this.approvals.set(key, record);

		return record;
	}

	/**
	 * Revoke approval for a specific action.
	 *
	 * @param domain - Action domain
	 * @param action - Action category
	 */
	revokeApproval(domain: ActionDomain, action: ActionCategory): void {
		const key = this.getApprovalKey(domain, action);
		this.approvals.delete(key);
	}

	/**
	 * Check whether an action has a valid (non-expired) approval.
	 *
	 * @param domain - Action domain
	 * @param action - Action category
	 * @returns True if a valid approval exists
	 */
	hasValidApproval(domain: ActionDomain, action: ActionCategory): boolean {
		const key = this.getApprovalKey(domain, action);
		const record = this.approvals.get(key);
		if (!record) return false;

		const now = Date.now();
		const expiresAt = new Date(record.expiresAt).getTime();
		if (now >= expiresAt) {
			this.approvals.delete(key);
			return false;
		}

		return true;
	}

	/**
	 * Check whether an action's approval has gone stale (expired).
	 *
	 * @param domain - Action domain
	 * @param action - Action category
	 * @returns True if the approval has expired
	 */
	isApprovalStale(domain: ActionDomain, action: ActionCategory): boolean {
		const key = this.getApprovalKey(domain, action);
		const record = this.approvals.get(key);
		if (!record) return false;

		return Date.now() >= new Date(record.expiresAt).getTime();
	}

	/**
	 * Get all current (non-expired) approvals.
	 *
	 * @returns Array of valid approval records
	 */
	getValidApprovals(): ApprovalRecord[] {
		const now = Date.now();
		const valid: ApprovalRecord[] = [];

		for (const [key, record] of this.approvals) {
			if (now < new Date(record.expiresAt).getTime()) {
				valid.push(record);
			} else {
				this.approvals.delete(key);
			}
		}

		return valid;
	}

	/**
	 * Get the count of valid approvals.
	 */
	get approvalCount(): number {
		return this.getValidApprovals().length;
	}

	/**
	 * Get all configured rules (built-in + custom).
	 */
	getRules(): readonly CapabilityRule[] {
		return this.rules;
	}

	/**
	 * Clear all approvals (for testing/reset).
	 */
	clearApprovals(): void {
		this.approvals.clear();
	}

	// =======================================================================
	// Private Helpers
	// =======================================================================

	/**
	 * Find the first matching rule for a domain + action combination.
	 * More specific rules (longer IDs) are checked first.
	 */
	private findRule(domain: ActionDomain, action: ActionCategory): CapabilityRule | undefined {
		// Sort by specificity: exact domain+action match first
		const matchingRules = this.rules.filter((r) => r.domain === domain && r.action === action);
		if (matchingRules.length === 0) return undefined;

		// Return the most specific rule (last custom rule wins over built-in)
		return matchingRules[matchingRules.length - 1];
	}

	/**
	 * Get a human-readable description for an action.
	 */
	private getActionDescription(domain: ActionDomain, action: ActionCategory): string {
		return ACTION_LABELS[domain]?.[action] ?? `${domain}:${action}`;
	}

	/**
	 * Determine the protection level for an action based on domain, action
	 * type, and affected file paths.
	 *
	 * If affected paths trigger the self-modification firewall, the level
	 * is escalated to "mutates_protected" regardless of the rule's level.
	 */
	private determineProtectionLevel(
		domain: ActionDomain,
		action: ActionCategory,
		affectedPaths?: string[],
	): ProtectionLevel {
		// First check if affected paths trigger the self-modification firewall.
		// This takes priority over rule-based levels since it indicates
		// actual protected files are involved.
		if (affectedPaths && affectedPaths.length > 0) {
			const report = this.firewall.checkFilePaths(affectedPaths);
			if (report.hasSelfModification) {
				return "mutates_protected";
			}
		}

		// Check explicit protection from rules
		const rule = this.findRule(domain, action);
		if (rule?.protectionLevel && rule.protectionLevel !== "none") {
			return rule.protectionLevel;
		}

		// Domain-specific protection heuristics
		if (domain === "skill" && (action === "modify_manifest" || action === "access_protected_paths")) {
			return "mutates_protected";
		}
		if (domain === "extension" && action === "modify_settings") {
			return "touches_protected";
		}
		if (domain === "extension" && action === "access_secrets") {
			return "mutates_protected";
		}

		return "none";
	}

	/**
	 * Generate a unique key for an approval record.
	 */
	private getApprovalKey(domain: ActionDomain, action: ActionCategory): string {
		return `${domain}:${action}`;
	}
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a capability policy engine instance.
 *
 * @param config - Engine configuration
 * @returns CapabilityPolicyEngine instance
 */
export function createCapabilityPolicyEngine(config: CapabilityPolicyEngineConfig): CapabilityPolicyEngine {
	return new CapabilityPolicyEngine(config);
}
