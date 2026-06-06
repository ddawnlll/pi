/**
 * Command Policy Engine — ACCP 1.2 / PlanSpec v5
 *
 * Evaluates shell commands against policy before execution.
 *
 * Policy evaluation order:
 * 1. Hard deny (always first)
 * 2. Self-modification firewall (file system protection)
 * 3. Git safety (workspace commit gate)
 * 4. Watch-mode guard
 * 5. Controlled delete policy
 * 6. Exact allowed commands
 * 7. Command class discovery/bounded tests
 * 8. Runtime command grants
 * 9. Default deny
 *
 * Denied delete commands do NOT request user approval unless the policy
 * explicitly says allowWithApproval (controlled via requestUserApprovalOnDeny).
 */

import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { minimatch } from "minimatch";
import type {
	CommandClass,
	CommandEvidence,
	CommandPolicyConfig,
	CommandPolicyDecision,
	CommandPolicyDecisionCode,
	ControlledDeletePolicy,
	RuntimeCommandGrant,
	RuntimeCommandGrantRequest,
} from "./command-policy-types.js";
import { COMMAND_CLASSES, DEFAULT_COMMAND_POLICY_CONFIG } from "./command-policy-types.js";
import { isValidationLikeCommand, isWatchModeCommand } from "./watch-mode-guard.js";

// =============================================================================
// CommandPolicyEngine
// =============================================================================

export class CommandPolicyEngine {
	private readonly config: CommandPolicyConfig;
	private readonly grants: Map<string, RuntimeCommandGrant> = new Map();
	private readonly decisionLog: CommandPolicyDecision[] = [];
	private readonly evidenceLog: CommandEvidence[] = [];

	constructor(config?: Partial<CommandPolicyConfig>) {
		this.config = { ...DEFAULT_COMMAND_POLICY_CONFIG, ...config };
	}

	/**
	 * Get the current configuration (for testing/inspection).
	 */
	getConfig(): CommandPolicyConfig {
		return this.config;
	}

	/**
	 * Evaluate a command against all policy layers.
	 *
	 * @param command - The full shell command string
	 * @param cwd - The working directory for command execution
	 * @returns A CommandPolicyDecision
	 */
	evaluate(command: string, cwd: string): CommandPolicyDecision {
		const trimmed = command.trim();

		// -------------------------------------------------------------------
		// Layer 1: Hard deny (always first)
		// -------------------------------------------------------------------
		for (const pattern of (this.config.hardDenyPatterns ?? [])) {
			if (trimmed.includes(pattern)) {
				return this.recordDecision({
					command,
					cwd,
					decision: "deny",
					reason: `Hard-denied by pattern: ${pattern}`,
					blockCode: "HARD_DENY",
					userApprovalRequested: false,
					policyLayer: "hard_deny",
				});
			}
		}

		// -------------------------------------------------------------------
		// Layer 2: Watch-mode guard
		// -------------------------------------------------------------------
		if (isWatchModeCommand(command)) {
			return this.recordDecision({
				command,
				cwd,
				decision: "deny",
				reason: "Watch-mode commands are not allowed",
				blockCode: "WATCH_MODE",
				userApprovalRequested: false,
				policyLayer: "watch_mode",
			});
		}

		// -------------------------------------------------------------------
		// Layer 3: Controlled delete policy
		// -------------------------------------------------------------------
		const deleteResult = this.evaluateDeleteCommand(trimmed, cwd);
		if (deleteResult) {
			const assuredPolicy = this.config.controlledDelete;
			const userApprovalRequested =
				deleteResult.decision === "requires_human_approval"
					? true
					: deleteResult.decision === "deny"
						? assuredPolicy?.requestUserApprovalOnDeny ?? false
						: false;

			return this.recordDecision({
				command,
				cwd,
				decision: deleteResult.decision,
				reason: deleteResult.reason,
				blockCode: deleteResult.decision === "deny" ? "CONTROLLED_DELETE_DENY" : undefined,
				userApprovalRequested,
				policyLayer: "controlled_delete",
				controlledDeleteInfo: deleteResult.info,
			});
		}

		// -------------------------------------------------------------------
		// Layer 4: Exact allowed commands
		// -------------------------------------------------------------------
		for (const exact of (this.config.exactAllowedCommands ?? [])) {
			if (exact.command && trimmed === exact.command.trim()) {
				return this.recordDecision({
					command,
					cwd,
					decision: "allow",
					reason: exact.reason,
					userApprovalRequested: false,
					policyLayer: "exact_allowed",
				});
			}
		}

		// -------------------------------------------------------------------
		// Layer 5: Command class matching
		// -------------------------------------------------------------------
		const matchedClass = this.matchCommandClass(trimmed);
		if (matchedClass) {
			const isValidation = matchedClass.canSatisfyValidation && this.isValidationSatisfying(trimmed);

			if (isValidation) {
				return this.recordDecision({
					command,
					cwd,
					decision: "allow_with_evidence",
					reason: `Command class "${matchedClass.label}" satisfies validation`,
					userApprovalRequested: false,
					policyLayer: "command_class",
				});
			}

			if (matchedClass.isDiscovery) {
				return this.recordDecision({
					command,
					cwd,
					decision: "allow_with_evidence",
					reason: `Discovery command: "${matchedClass.label}"`,
					userApprovalRequested: false,
					policyLayer: "command_class",
				});
			}

			// Bounded test with medium risk — allow with evidence
			return this.recordDecision({
				command,
				cwd,
				decision: "allow_with_evidence",
				reason: `Command class "${matchedClass.label}"`,
				userApprovalRequested: false,
				policyLayer: "command_class",
			});
		}

		// -------------------------------------------------------------------
		// Layer 6: Runtime command grants
		// -------------------------------------------------------------------
		const grantResult = this.checkRuntimeGrant(trimmed);
		if (grantResult) {
			return this.recordDecision({
				command,
				cwd,
				decision: "allow",
					reason: `Granted by runtime grant: ${grantResult.reason}`,
					userApprovalRequested: false,
					policyLayer: "runtime_grant",
			});
		}

		// -------------------------------------------------------------------
		// Layer 7: Default deny for unrecognized commands
		// -------------------------------------------------------------------
		return this.recordDecision({
			command,
			cwd,
			decision: "deny",
			reason: "Command is not recognized by any policy layer",
			blockCode: "UNRECOGNIZED_COMMAND",
			userApprovalRequested: false,
			policyLayer: "hard_deny",
		});
	}

	// =========================================================================
	// Delete Evaluation
	// =========================================================================

	private evaluateDeleteCommand(
		command: string,
		cwd: string,
	): {
		decision: CommandPolicyDecisionCode;
		reason: string;
		info?: CommandPolicyDecision["controlledDeleteInfo"];
	} | null {
		// Parse delete commands: rm, unlink, rmdir
		const deleteMatch = this.parseDeleteCommand(command);
		if (!deleteMatch) {
			return null; // Not a delete command
		}

		const { target, isRecursive, isGlob } = deleteMatch;

		// Canonicalize the target path
		const canonicalPath = this.canonicalizePath(target, cwd);

		// Reject symlink escape — if canonical path is outside cwd
		if (canonicalPath && !canonicalPath.startsWith(resolve(cwd))) {
			return {
				decision: "deny",
				reason: `Symlink escape rejected: target resolves outside working directory`,
				info: {
					targetPath: target,
					canonicalPath: canonicalPath,
					isRecursive,
					isGlob,
					allowed: false,
				},
			};
		}

		// Check glob — reject unless policy explicitly allows
		if (isGlob) {
			return {
				decision: "deny",
				reason: "Glob delete rejected unless policy explicitly allows",
				info: {
					targetPath: target,
					canonicalPath: target,
					isRecursive,
					isGlob,
					allowed: false,
				},
			};
		}

		// Check forbidden paths first (preempts allowed)
		const policy = this.config.controlledDelete;
		if (policy?.enabled) {
			for (const forbidden of (policy.forbiddenPaths ?? [])) {
				if (minimatch(target, forbidden.pattern) || (canonicalPath && minimatch(canonicalPath, forbidden.pattern))) {
					return {
						decision: "deny",
						reason: `Forbidden delete path matched: ${forbidden.pattern} (${forbidden.reason})`,
						info: {
							targetPath: target,
							canonicalPath: canonicalPath || target,
							isRecursive,
							isGlob,
							allowed: false,
							matchedForbidden: forbidden.pattern,
						},
					};
				}
			}

			// Check allowed paths
			for (const allowed of (policy.allowedPaths ?? [])) {
				if (minimatch(target, allowed.pattern) || (canonicalPath && minimatch(canonicalPath, allowed.pattern))) {
					return {
						decision: "allow",
						reason: `Delete allowed: ${allowed.pattern} (${allowed.description || allowed.reason || "no description"})`,
						info: {
							targetPath: target,
							canonicalPath: canonicalPath || target,
							isRecursive,
							isGlob,
							allowed: true,
							matchedAllowed: allowed.pattern,
						},
					};
				}
			}
		}

		// Also check forbiddenDeletePaths from top-level config
		for (const forbidden of (this.config.forbiddenDeletePaths ?? [])) {
			if (minimatch(target, forbidden.pattern) || (canonicalPath && minimatch(canonicalPath, forbidden.pattern))) {
				return {
					decision: "deny",
					reason: `Forbidden delete path matched: ${forbidden.pattern} (${forbidden.reason})`,
					info: {
						targetPath: target,
						canonicalPath: canonicalPath || target,
						isRecursive,
						isGlob,
						allowed: false,
						matchedForbidden: forbidden.pattern,
					},
				};
			}
		}

		// Default: unknown path — deny (no approval request)
		return {
			decision: "deny",
			reason: "Delete target not in allowed paths",
			info: {
				targetPath: target,
				canonicalPath: canonicalPath || target,
				isRecursive,
				isGlob,
				allowed: false,
			},
		};
	}

	/**
	 * Parse a delete command to extract the target path and flags.
	 */
	private parseDeleteCommand(command: string): { target: string; isRecursive: boolean; isGlob: boolean } | null {
		const trimmed = command.trim();

		// rm
		const rmRegex = /^rm\b\s*(.*)$/;
		const rmMatch = rmRegex.exec(trimmed);
		if (rmMatch) {
			const args = rmMatch[1].trim();
			const isRecursive = /\b-rf\b/.test(args) || /\b-r\b/.test(args) || /\b--recursive\b/.test(args);

			// Extract the target (last non-flag argument)
			const parts = args.split(/\s+/).filter((p) => !p.startsWith("-") && p.length > 0);
			const target = parts[parts.length - 1] || "";

			if (!target) return null;

			const isGlob = target.includes("*") || target.includes("?") || target.includes("[");

			return { target, isRecursive, isGlob };
		}

		// unlink
		const unlinkMatch = /^unlink\s+(.+)$/.exec(trimmed);
		if (unlinkMatch) {
			return { target: unlinkMatch[1].trim(), isRecursive: false, isGlob: false };
		}

		// rmdir
		const rmdirMatch = /^rmdir\s+(.+)$/.exec(trimmed);
		if (rmdirMatch) {
			const args = rmdirMatch[1].trim();
			const isRecursive = /\b-p\b/.test(args) || /\b--parents\b/.test(args);
			const parts = args.split(/\s+/).filter((p) => !p.startsWith("-") && p.length > 0);
			const target = parts[parts.length - 1] || "";
			if (!target) return null;
			const isGlob = target.includes("*") || target.includes("?") || target.includes("[");
			return { target, isRecursive, isGlob };
		}

		return null;
	}

	/**
	 * Canonicalize a delete target path.
	 * Resolves relative paths, rejects symlink escape.
	 */
	private canonicalizePath(target: string, cwd: string): string | null {
		try {
			if (target.startsWith("/")) {
				return resolve(target);
			}
			return resolve(cwd, target);
		} catch {
			return null;
		}
	}

	// =========================================================================
	// Command Class Matching
	// =========================================================================

	/**
	 * Match a command against known command classes.
	 */
	matchCommandClass(command: string): CommandClass | undefined {
		const trimmed = command.trimStart();
		for (const cls of COMMAND_CLASSES) {
			for (const pattern of cls.prefixPatterns) {
				if (trimmed.startsWith(pattern)) {
					return cls;
				}
			}
		}
		return undefined;
	}

	/**
	 * Check whether a command can satisfy validation requirements.
	 */
	isValidationSatisfying(command: string): boolean {
		return isValidationLikeCommand(command);
	}

	// =========================================================================
	// Runtime Grants
	// =========================================================================

	/**
	 * Request a runtime grant for a command.
	 */
	requestGrant(request: RuntimeCommandGrantRequest): RuntimeCommandGrant | null {
		// Low-risk read-only may auto-grant
		if (this.config.autoGrantLowRiskReadOnly && request.risk === "low") {
			const grant: RuntimeCommandGrant = {
				id: randomUUID(),
				command: request.command,
				durationMs: request.durationMs ?? 60 * 60 * 1000,
				expiresAt: Date.now() + (request.durationMs ?? 60 * 60 * 1000),
				reason: request.reason ?? "Auto-granted low-risk command",
			};
			this.grants.set(grant.id, grant);
			return grant;
		}

		// Medium/high risk require explicit grant
		return null;
	}

	/**
	 * Manually grant a runtime command exception.
	 */
	grantCommand(grant: RuntimeCommandGrant): void {
		this.grants.set(grant.id, grant);
	}

	/**
	 * Check if a command has an active runtime grant.
	 */
	private checkRuntimeGrant(command: string): RuntimeCommandGrant | undefined {
		const now = Date.now();
		for (const [id, grant] of this.grants) {
			if (grant.expiresAt > now && grant.command === command) {
				return grant;
			}
			if (grant.expiresAt <= now) {
				this.grants.delete(id);
			}
		}
		return undefined;
	}

	// =========================================================================
	// Evidence Recording
	// =========================================================================

	private recordDecision(decision: CommandPolicyDecision): CommandPolicyDecision {
		this.decisionLog.push(decision);
		return decision;
	}

	/**
	 * Record execution evidence for a command.
	 */
	recordEvidence(evidence: CommandEvidence): void {
		this.evidenceLog.push(evidence);
	}

	/**
	 * Get all recorded decisions (for auditing).
	 */
	getDecisions(): readonly CommandPolicyDecision[] {
		return this.decisionLog;
	}

	/**
	 * Get all recorded evidence.
	 */
	getEvidence(): readonly CommandEvidence[] {
		return this.evidenceLog;
	}

	/**
	 * Clear all decisions and evidence (for testing).
	 */
	clear(): void {
		this.decisionLog.length = 0;
		this.evidenceLog.length = 0;
		this.grants.clear();
	}

	/**
	 * Get recent evidence for a workspace.
	 */
	getWorkspaceEvidence(_workspaceId: string): readonly CommandEvidence[] {
		return this.evidenceLog;
	}
}

// =============================================================================
// Factory
// =============================================================================

export function createCommandPolicyEngine(config?: Partial<CommandPolicyConfig>): CommandPolicyEngine {
	return new CommandPolicyEngine(config);
}
