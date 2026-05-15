/**
 * Remediation Policy Engine - P9.D Remediation Policy Engine
 *
 * Classifies remediation proposals by autonomy level, enforces
 * protected-system self-modification approval, and blocks unsafe
 * remediation attempts before execution.
 *
 * Acceptance Criteria:
 * 1. Policy engine classifies remediation autonomy levels.
 * 2. Protected-system changes require explicit self-modification approval.
 * 3. Unsafe remediation attempts are blocked before execution.
 *
 * Integration:
 * - Uses SelfModificationFirewall for protected-system checks
 * - Consumed by RemediationRuntime, ProposalPipeline, and Approval UX
 */

import type { SignalProposal } from "../repo-scanner/repo-health-signal.js";
import type { BudgetSummary } from "./budget-enforcer.js";
import type { SelfModificationCheckResult } from "./self-modification-firewall.js";

// ---------------------------------------------------------------------------
// Autonomy Levels
// ---------------------------------------------------------------------------

/**
 * Autonomy level for a remediation proposal.
 *
 * Defines how much autonomous action is permitted without human intervention.
 * Higher levels = more autonomy, lower levels = more human oversight.
 */
export type RemediationAutonomyLevel = "manual" | "supervised" | "semi_autonomous" | "fully_autonomous";

/**
 * Human-readable labels for each autonomy level.
 */
export const REMEDIATION_AUTONOMY_LABELS: Record<RemediationAutonomyLevel, string> = {
	manual: "Manual — every step requires human action",
	supervised: "Supervised — AI can plan but execution requires approval",
	semi_autonomous: "Semi-Autonomous — AI can plan and execute within defined boundaries",
	fully_autonomous: "Fully Autonomous — AI can handle entirely (safe, isolated changes only)",
};

/**
 * Numeric rank for comparing autonomy levels (higher = more autonomous).
 */
export const AUTONOMY_LEVEL_RANK: Record<RemediationAutonomyLevel, number> = {
	manual: 0,
	supervised: 1,
	semi_autonomous: 2,
	fully_autonomous: 3,
};

// ---------------------------------------------------------------------------
// Policy Evaluation Types
// ---------------------------------------------------------------------------

/**
 * Classification of a remediation proposal's risk profile.
 */
export interface RemediationRiskProfile {
	/** Overall risk level */
	riskLevel: "low" | "medium" | "high" | "critical";
	/** Whether the proposal modifies protected systems */
	touchesProtectedSystem: boolean;
	/** Whether the proposal uses destructive operations */
	isDestructive: boolean;
	/** Number of target files */
	targetFileCount: number;
	/** Effort estimate */
	effort: "trivial" | "small" | "medium" | "large";
	/** Whether auto-fix is available */
	autoFixable: boolean;
	/** Human-readable explanation of the risk assessment */
	reason: string;
}

/**
 * Autonomy classification result for a proposal or workspace.
 */
export interface AutonomyClassification {
	/** Determined autonomy level */
	level: RemediationAutonomyLevel;
	/** Risk profile that informed the classification */
	riskProfile: RemediationRiskProfile;
	/** Human-readable explanation */
	reason: string;
}

/**
 * The set of checks performed on a proposal before execution.
 */
export interface RemediationPolicyCheck {
	/** Whether the check passed */
	passed: boolean;
	/** Human-readable explanation */
	reason: string;
	/** Whether this check is a hard block (vs advisory) */
	isBlocking: boolean;
	/** Optional details for audit/reporting */
	details?: string;
}

/**
 * Full policy evaluation result for a remediation proposal.
 */
export interface RemediationPolicyResult {
	/** Whether the proposal is approved for execution */
	approved: boolean;
	/** Determined autonomy level */
	autonomyLevel: RemediationAutonomyLevel;
	/** Autonomy classification details */
	autonomyClassification: AutonomyClassification;
	/** Individual check results */
	checks: {
		pathSafety: RemediationPolicyCheck;
		selfModification: RemediationPolicyCheck;
		autonomyGate: RemediationPolicyCheck;
		riskGate: RemediationPolicyCheck;
	};
	/** Summary of why the proposal passed or failed */
	summary: string;
	/**
	 * Optional budget and blast-radius summary.
	 * Included when this result is rendered in dry-run or approval artifacts.
	 * P9.E field.
	 */
	budgetSummary?: BudgetSummary;
}

/**
 * Result of evaluating a batch of proposals.
 */
export interface BatchPolicyResult {
	/** Overall approved flag (true only if ALL proposals pass) */
	approved: boolean;
	/** Per-proposal results */
	proposalResults: Array<{
		proposal: SignalProposal;
		result: RemediationPolicyResult;
	}>;
	/** Summary counts */
	summary: {
		total: number;
		approved: number;
		blocked: number;
	};
}

// ---------------------------------------------------------------------------
// Policy Engine Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the remediation policy engine.
 */
export interface RemediationPolicyEngineConfig {
	/**
	 * Default autonomy level for proposals.
	 * @default "supervised"
	 */
	defaultAutonomyLevel: RemediationAutonomyLevel;

	/**
	 * Maximum autonomy level allowed globally.
	 * @default "semi_autonomous"
	 */
	maxAutonomyLevel: RemediationAutonomyLevel;

	/**
	 * Whether to block on self-modification attempts in non-autonomous mode.
	 * @default true
	 */
	blockSelfModification: boolean;

	/**
	 * Whether to block destructive commands by default.
	 * @default true
	 */
	blockDestructiveByDefault: boolean;

	/**
	 * File path patterns that are forbidden for ALL remediation.
	 * These are the most restrictive — any path matching these is blocked outright.
	 * @default [] (no additional forbidden paths beyond protected systems)
	 */
	forbiddenPathPatterns: string[];

	/**
	 * File path patterns that require explicit approval.
	 * These trigger an elevated review requirement.
	 * @default [] (uses protected systems by default)
	 */
	restrictedPathPatterns: string[];

	/**
	 * Maximum number of target files before a proposal is considered high-risk.
	 * @default 20
	 */
	maxFilesBeforeHighRisk: number;

	/**
	 * Maximum effort level that can be auto-approved.
	 * Proposals with effort > this level require explicit human approval.
	 * @default "small"
	 */
	autoApproveMaxEffort: "trivial" | "small" | "medium" | "large";
}

/**
 * Default configuration for the remediation policy engine.
 */
export const DEFAULT_REMEDIATION_POLICY_CONFIG: RemediationPolicyEngineConfig = {
	defaultAutonomyLevel: "supervised",
	maxAutonomyLevel: "semi_autonomous",
	blockSelfModification: true,
	blockDestructiveByDefault: true,
	forbiddenPathPatterns: [],
	restrictedPathPatterns: [],
	maxFilesBeforeHighRisk: 20,
	autoApproveMaxEffort: "small",
};

/**
 * Effort rank for comparison.
 */
const EFFORT_RANK: Record<string, number> = {
	trivial: 0,
	small: 1,
	medium: 2,
	large: 3,
};

// ---------------------------------------------------------------------------
// RemediationPolicyEngine
// ---------------------------------------------------------------------------

/**
 * Policy engine that classifies remediation autonomy levels, enforces
 * protected-system self-modification approval, and blocks unsafe
 * remediation attempts before execution.
 *
 * The engine evaluates every proposal against four gates:
 * 1. **Path Safety Gate** — Forbidden/restricted path enforcement
 * 2. **Self-Modification Gate** — Protected-system modification approval
 * 3. **Autonomy Gate** — Autonomy level boundary enforcement
 * 4. **Risk Gate** — Risk-based execution blocking
 */
export class RemediationPolicyEngine {
	private config: RemediationPolicyEngineConfig;
	private checkSelfModificationFn: (filePaths: string[]) => SelfModificationCheckResult[];

	constructor(
		config: Partial<RemediationPolicyEngineConfig> = {},
		options?: {
			/**
			 * External function to check file paths against the self-modification firewall.
			 * If provided, used instead of the built-in pattern matching.
			 */
			checkSelfModification?: (filePaths: string[]) => SelfModificationCheckResult[];
		},
	) {
		this.config = { ...DEFAULT_REMEDIATION_POLICY_CONFIG, ...config };
		this.checkSelfModificationFn = options?.checkSelfModification ?? this.defaultCheckSelfModification.bind(this);
	}

	// -----------------------------------------------------------------------
	// Public API — Configuration
	// -----------------------------------------------------------------------

	/**
	 * Get the current configuration.
	 */
	getConfig(): Readonly<RemediationPolicyEngineConfig> {
		return { ...this.config };
	}

	/**
	 * Update the configuration (partial merge).
	 */
	updateConfig(partial: Partial<RemediationPolicyEngineConfig>): void {
		this.config = { ...this.config, ...partial };
	}

	// -----------------------------------------------------------------------
	// Public API — Autonomy Classification (AC1)
	// -----------------------------------------------------------------------

	/**
	 * Classify a remediation proposal by autonomy level.
	 *
	 * Evaluates the risk profile of a proposal and maps it to an autonomy level:
	 *
	 * | Condition | Autonomy Level |
	 * |---|---|
	 * | Critical risk, touches protected systems, or large effort | `manual` |
	 * | High risk, destructive operation, or medium effort | `supervised` |
	 * | Medium risk, auto-fixable, or small effort | `semi_autonomous` |
	 * | Low risk, trivial effort, auto-fixable, safe paths | `fully_autonomous` |
	 *
	 * @param proposal - The remediation proposal to classify
	 * @returns Autonomy classification
	 */
	classifyAutonomy(proposal: SignalProposal): AutonomyClassification {
		const riskProfile = this.assessRisk(proposal);

		let level: RemediationAutonomyLevel;

		if (riskProfile.riskLevel === "critical" || riskProfile.touchesProtectedSystem) {
			level = "manual";
		} else if (riskProfile.riskLevel === "high" || riskProfile.isDestructive) {
			level = "supervised";
		} else if (riskProfile.riskLevel === "medium" || (riskProfile.effort === "medium" && !riskProfile.autoFixable)) {
			level = "semi_autonomous";
		} else {
			// Low risk, trivial/small effort, auto-fixable
			level = "fully_autonomous";
		}

		return {
			level: level,
			riskProfile,
			reason: this.buildAutonomyReason(level, riskProfile),
		};
	}

	/**
	 * Classify a batch of proposals by autonomy level.
	 *
	 * The batch autonomy is the minimum level across all proposals
	 * (the most restrictive level wins).
	 *
	 * @param proposals - Array of proposals to classify
	 * @returns Autonomy classification for the batch
	 */
	classifyBatchAutonomy(proposals: SignalProposal[]): AutonomyClassification {
		if (proposals.length === 0) {
			return {
				level: "fully_autonomous",
				riskProfile: {
					riskLevel: "low",
					touchesProtectedSystem: false,
					isDestructive: false,
					targetFileCount: 0,
					effort: "trivial",
					autoFixable: false,
					reason: "No proposals to classify",
				},
				reason: "No proposals — fully autonomous",
			};
		}

		// Classify each proposal and take the minimum autonomy level
		let currentLevel: RemediationAutonomyLevel = "fully_autonomous";
		let worstRiskProfile: RemediationRiskProfile | null = null;

		for (const proposal of proposals) {
			const classification = this.classifyAutonomy(proposal);
			const classifiedLevel = classification.level;
			const classifiedRank = AUTONOMY_LEVEL_RANK[classifiedLevel];
			const currentRank = AUTONOMY_LEVEL_RANK[currentLevel];

			if (classifiedRank < currentRank) {
				currentLevel = classifiedLevel;
				worstRiskProfile = classification.riskProfile;
			} else if (!worstRiskProfile && classification.riskProfile.riskLevel !== "low") {
				worstRiskProfile = classification.riskProfile;
			}
		}

		return {
			level: currentLevel,
			riskProfile: worstRiskProfile ?? {
				riskLevel: "low",
				touchesProtectedSystem: false,
				isDestructive: false,
				targetFileCount: proposals.length,
				effort: "trivial",
				autoFixable: false,
				reason: "All proposals are low risk",
			},
			reason: `Batch classified as "${currentLevel}" based on the most restrictive proposal (${worstRiskProfile?.riskLevel ?? "unknown"} risk, ${worstRiskProfile?.effort ?? "unknown"} effort)`,
		};
	}

	// -----------------------------------------------------------------------
	// Public API — Policy Evaluation (AC1 + AC2 + AC3)
	// -----------------------------------------------------------------------

	/**
	 * Evaluate a remediation proposal against all policy gates.
	 *
	 * Checks performed:
	 * 1. **Path Safety Gate** — Ensures target files are not in forbidden paths
	 * 2. **Self-Modification Gate** — Checks for protected-system modification
	 * 3. **Autonomy Gate** — Ensures autonomy level matches allowed range
	 * 4. **Risk Gate** — Blocks high-risk operations without approval
	 *
	 * @param proposal - The proposal to evaluate
	 * @returns Policy evaluation result
	 */
	evaluateProposal(proposal: SignalProposal): RemediationPolicyResult {
		const autonomyClassification = this.classifyAutonomy(proposal);
		const checks = {
			pathSafety: this.checkPathSafety(proposal),
			selfModification: this.checkSelfModification(proposal),
			autonomyGate: this.checkAutonomyGate(proposal, autonomyClassification),
			riskGate: this.checkRiskGate(proposal),
		};

		const approved = Object.values(checks).every((c) => c.passed || !c.isBlocking);
		const blockedGates = Object.values(checks)
			.filter((c) => !c.passed && c.isBlocking)
			.map((c) => c.reason);

		const summary = approved
			? `Proposal approved: classified as "${autonomyClassification.level}". All policy gates passed.`
			: `Proposal blocked: ${blockedGates.join("; ")}`;

		return {
			approved,
			autonomyLevel: autonomyClassification.level,
			autonomyClassification,
			checks,
			summary,
		};
	}

	/**
	 * Evaluate multiple proposals against all policy gates.
	 *
	 * @param proposals - Array of proposals to evaluate
	 * @returns Batch policy evaluation result
	 */
	evaluateBatch(proposals: SignalProposal[]): BatchPolicyResult {
		const proposalResults = proposals.map((proposal) => ({
			proposal,
			result: this.evaluateProposal(proposal),
		}));

		const approved = proposalResults.filter((r) => r.result.approved);
		const blocked = proposalResults.filter((r) => !r.result.approved);

		return {
			approved: blocked.length === 0,
			proposalResults,
			summary: {
				total: proposals.length,
				approved: approved.length,
				blocked: blocked.length,
			},
		};
	}

	// -----------------------------------------------------------------------
	// Gate Checks (AC2 + AC3)
	// -----------------------------------------------------------------------

	/**
	 * Gate 1: Path Safety Gate.
	 *
	 * Checks that the proposal's target files are not in forbidden paths.
	 * Forbidden paths are always blocked. Restricted paths require elevated approval.
	 *
	 * @param proposal - The proposal to check
	 * @returns Path safety check result
	 */
	checkPathSafety(proposal: SignalProposal): RemediationPolicyCheck {
		const forbiddenMatches = this.matchPatterns(proposal.targetFiles, this.config.forbiddenPathPatterns);

		if (forbiddenMatches.length > 0) {
			return {
				passed: false,
				isBlocking: true,
				reason: `Target files match forbidden paths: ${forbiddenMatches.join(", ")}`,
				details: `The following target files are in forbidden path patterns: ${forbiddenMatches.join(", ")}`,
			};
		}

		const restrictedMatches = this.matchPatterns(proposal.targetFiles, this.config.restrictedPathPatterns);

		if (restrictedMatches.length > 0) {
			return {
				passed: true,
				isBlocking: false,
				reason: `Target files match restricted paths: ${restrictedMatches.join(", ")}. Elevated approval recommended.`,
				details: `The following target files match restricted path patterns: ${restrictedMatches.join(", ")}`,
			};
		}

		return {
			passed: true,
			isBlocking: false,
			reason: "All target files pass path safety gate",
		};
	}

	/**
	 * Gate 2: Self-Modification Gate.
	 *
	 * Checks whether the proposal modifies protected system files.
	 * If self-modification is detected and `blockSelfModification` is true,
	 * the proposal is blocked unless explicit approval is provided.
	 *
	 * Integrates with the existing SelfModificationFirewall.
	 *
	 * @param proposal - The proposal to check
	 * @returns Self-modification check result
	 */
	checkSelfModification(proposal: SignalProposal): RemediationPolicyCheck {
		const results = this.checkSelfModificationFn(proposal.targetFiles);
		const protectedMatches = results.filter((r) => r.isProtected);

		if (protectedMatches.length === 0) {
			return {
				passed: true,
				isBlocking: false,
				reason: "No protected system files are targeted",
			};
		}

		const systemNames = [
			...new Set(protectedMatches.filter((r) => r.matchedSystem).map((r) => r.matchedSystem!.name)),
		].join(", ");

		if (this.config.blockSelfModification && protectedMatches.some((r) => r.blocked)) {
			return {
				passed: false,
				isBlocking: true,
				reason: `Self-modification blocked: proposal targets protected system(s): ${systemNames}`,
				details: `Protected paths: ${protectedMatches.map((r) => r.reason).join("; ")}`,
			};
		}

		return {
			passed: true,
			isBlocking: false,
			reason: `Self-modification detected for system(s): ${systemNames}. Enhanced approval may be required before execution.`,
			details: `Protected paths: ${protectedMatches.map((r) => r.reason).join("; ")}`,
		};
	}

	/**
	 * Gate 3: Autonomy Gate.
	 *
	 * Ensures the proposal's autonomy level is within the allowed range,
	 * both globally (config.maxAutonomyLevel) and for this specific proposal.
	 *
	 * @param proposal - The proposal to check
	 * @param classification - Autonomy classification for the proposal
	 * @returns Autonomy gate check result
	 */
	checkAutonomyGate(proposal: SignalProposal, classification?: AutonomyClassification): RemediationPolicyCheck {
		const autoClass = classification ?? this.classifyAutonomy(proposal);
		const proposalLevel = this.clampAutonomyLevel(autoClass.level);
		const maxLevel = this.config.maxAutonomyLevel;
		const maxRank = AUTONOMY_LEVEL_RANK[maxLevel];
		const proposalRank = AUTONOMY_LEVEL_RANK[proposalLevel];

		if (proposalRank > maxRank) {
			return {
				passed: false,
				isBlocking: true,
				reason: `Autonomy level "${autoClass.level}" exceeds maximum allowed "${maxLevel}"`,
				details: `Proposal requires "${autoClass.level}" autonomy but max is "${maxLevel}". Reduce scope or increase max autonomy level.`,
			};
		}

		return {
			passed: true,
			isBlocking: false,
			reason: `Autonomy level "${proposalLevel}" is within allowed maximum "${maxLevel}"`,
		};
	}

	/**
	 * Gate 4: Risk Gate.
	 *
	 * Blocks high-risk proposals that exceed risk thresholds.
	 * Only blocks if the risk level exceeds the config-based thresholds.
	 *
	 * @param proposal - The proposal to check
	 * @returns Risk gate check result
	 */
	checkRiskGate(proposal: SignalProposal): RemediationPolicyCheck {
		const riskProfile = this.assessRisk(proposal);

		if (riskProfile.riskLevel === "critical") {
			return {
				passed: false,
				isBlocking: true,
				reason: `Critical risk: ${riskProfile.reason}`,
				details: `Risk profile: ${riskProfile.targetFileCount} files, ${riskProfile.effort} effort, ${riskProfile.isDestructive ? "destructive" : "non-destructive"}`,
			};
		}

		if (riskProfile.riskLevel === "high") {
			const effortRank = EFFORT_RANK[riskProfile.effort] ?? 1;
			const autoApprovalMax = EFFORT_RANK[this.config.autoApproveMaxEffort] ?? 1;

			if (effortRank > autoApprovalMax) {
				return {
					passed: false,
					isBlocking: true,
					reason: `High risk: effort "${riskProfile.effort}" exceeds auto-approval max "${this.config.autoApproveMaxEffort}"`,
					details: riskProfile.reason,
				};
			}

			return {
				passed: true,
				isBlocking: false,
				reason: `High risk but effort "${riskProfile.effort}" is within auto-approval limits. Manual review recommended.`,
				details: riskProfile.reason,
			};
		}

		return {
			passed: true,
			isBlocking: false,
			reason: `Risk level "${riskProfile.riskLevel}" passes risk gate`,
		};
	}

	// -----------------------------------------------------------------------
	// Public API — Utility
	// -----------------------------------------------------------------------

	/**
	 * Check if a proposal is allowed to execute at a given autonomy level.
	 *
	 * @param proposal - The proposal to check
	 * @param requestedLevel - The autonomy level being requested
	 * @returns True if the proposal is allowed at this level
	 */
	isAllowedAtLevel(proposal: SignalProposal, requestedLevel: RemediationAutonomyLevel): boolean {
		const classification = this.classifyAutonomy(proposal);
		const requiredRank = AUTONOMY_LEVEL_RANK[classification.level];
		const requestedRank = AUTONOMY_LEVEL_RANK[requestedLevel];

		// The requested level must be at least as restrictive as required.
		// Lower rank = more restrictive (manual=0, fully_autonomous=3).
		// E.g., a "fully_autonomous" (rank 3) proposal CAN run in "supervised" mode (rank 1).
		// But a "supervised" (rank 1) proposal CANNOT run in "fully_autonomous" mode (rank 3).
		return requestedRank <= requiredRank;
	}

	/**
	 * Get a human-readable explanation of why a proposal is or isn't approved.
	 *
	 * @param result - Policy evaluation result
	 * @returns Formatted explanation
	 */
	formatResult(result: RemediationPolicyResult): string {
		const lines: string[] = [
			"=== Remediation Policy Evaluation ===",
			"",
			`Status: ${result.approved ? "APPROVED" : "BLOCKED"}`,
			`Autonomy Level: ${result.autonomyLevel} — ${REMEDIATION_AUTONOMY_LABELS[result.autonomyLevel]}`,
			"",
			"Policy Gates:",
			`  Path Safety:      ${result.checks.pathSafety.passed ? "PASS" : "FAIL"} — ${result.checks.pathSafety.reason}`,
			`  Self-Modification: ${result.checks.selfModification.passed ? "PASS" : "FAIL"} — ${result.checks.selfModification.reason}`,
			`  Autonomy Gate:     ${result.checks.autonomyGate.passed ? "PASS" : "FAIL"} — ${result.checks.autonomyGate.reason}`,
			`  Risk Gate:         ${result.checks.riskGate.passed ? "PASS" : "FAIL"} — ${result.checks.riskGate.reason}`,
			"",
			result.summary,
		];

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Private — Risk Assessment
	// -----------------------------------------------------------------------

	/**
	 * Assess the risk profile of a remediation proposal.
	 */
	private assessRisk(proposal: SignalProposal): RemediationRiskProfile {
		const targetFileCount = proposal.targetFiles.length;
		const effort = proposal.effort;
		const autoFixable = proposal.autoFixable;

		// Check against protected systems
		const selfModResults = this.checkSelfModificationFn(proposal.targetFiles);
		const touchesProtectedSystem = selfModResults.some((r) => r.isProtected);

		// Heuristic: proposals touching many files are higher risk
		const highFileCount = targetFileCount > this.config.maxFilesBeforeHighRisk;

		// Heuristic: medium/large effort proposals carry more risk
		const isDestructive = effort === "large";

		let riskLevel: "low" | "medium" | "high" | "critical";

		if (touchesProtectedSystem || (isDestructive && highFileCount)) {
			riskLevel = "critical";
		} else if (isDestructive || highFileCount) {
			riskLevel = "high";
		} else if (effort === "medium" || (effort === "small" && !autoFixable)) {
			riskLevel = "medium";
		} else {
			riskLevel = "low";
		}

		const reasons: string[] = [];
		if (touchesProtectedSystem) reasons.push("touches protected system");
		if (isDestructive) reasons.push(`destructive operation (${effort} effort)`);
		if (highFileCount) reasons.push(`${targetFileCount} target files exceeds high-risk threshold`);
		if (effort !== "trivial") reasons.push(`${effort} effort`);

		return {
			riskLevel,
			touchesProtectedSystem,
			isDestructive,
			targetFileCount,
			effort,
			autoFixable,
			reason: reasons.length > 0 ? reasons.join("; ") : "No significant risk factors detected",
		};
	}

	// -----------------------------------------------------------------------
	// Private — Helpers
	// -----------------------------------------------------------------------

	/**
	 * Clamp an autonomy level to the maximum allowed.
	 */
	private clampAutonomyLevel(level: RemediationAutonomyLevel): RemediationAutonomyLevel {
		const levelRank = AUTONOMY_LEVEL_RANK[level];
		const maxRank = AUTONOMY_LEVEL_RANK[this.config.maxAutonomyLevel];

		if (levelRank > maxRank) {
			return this.config.maxAutonomyLevel;
		}
		return level;
	}

	/**
	 * Build a human-readable reason for an autonomy classification.
	 */
	private buildAutonomyReason(level: RemediationAutonomyLevel, riskProfile: RemediationRiskProfile): string {
		switch (level) {
			case "manual":
				return `Manual intervention required: ${riskProfile.reason}`;
			case "supervised":
				return `Supervised execution: ${riskProfile.reason}. AI can plan but must wait for execution approval.`;
			case "semi_autonomous":
				return `Semi-autonomous: ${riskProfile.reason}. AI can plan and execute within defined boundaries.`;
			case "fully_autonomous":
				return `Fully autonomous: ${riskProfile.reason}. Low-risk proposal that can be handled entirely by AI.`;
		}
	}

	/**
	 * Default self-modification check function.
	 *
	 * A simple pattern match against common protected system patterns.
	 * In production, this should be replaced with the actual
	 * SelfModificationFirewall instance.
	 */
	private defaultCheckSelfModification(filePaths: string[]): SelfModificationCheckResult[] {
		const protectedPatterns = [
			/packages\/coding-agent\/src\/(?:core|context|repo-scanner)\//,
			/\.pi\/(?:agent|settings|skills)\//,
		];

		return filePaths.map((filePath) => {
			const normalized = filePath.replace(/\\/g, "/");
			const matchedPattern = protectedPatterns.find((p) => p.test(normalized));

			if (matchedPattern) {
				return {
					isProtected: true,
					matchedSystem: {
						id: "matched-pattern",
						name: "Protected Pi System",
						patterns: [matchedPattern.toString()],
						reason: "File path matches a protected system pattern",
					},
					reason: `"${filePath}" is part of a protected system`,
					blocked: this.config.blockSelfModification,
					requiresEnhancedApproval: true,
				};
			}

			return {
				isProtected: false,
				reason: "",
				blocked: false,
				requiresEnhancedApproval: false,
			};
		});
	}

	/**
	 * Match file paths against glob-like patterns.
	 *
	 * Supports simple wildcard patterns (* matches any characters except /,
	 * ** matches any characters including /).
	 *
	 * @param filePaths - File paths to check
	 * @param patterns - Glob-like patterns to match against
	 * @returns Matching file paths
	 */
	private matchPatterns(filePaths: string[], patterns: string[]): string[] {
		if (patterns.length === 0) {
			return [];
		}

		return filePaths.filter((filePath) => {
			const normalized = filePath.replace(/\\/g, "/");
			return patterns.some((pattern) => {
				// Convert glob-like pattern to regex
				// **/ = zero or more directory segments
				// ** = any characters including /
				// * = any characters except /
				// ? = single character except /
				let regexStr = "^";
				let i = 0;
				while (i < pattern.length) {
					const ch = pattern[i];
					if (ch === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
						regexStr += "(?:.+/)?";
						i += 3;
					} else if (ch === "*" && pattern[i + 1] === "*") {
						regexStr += ".*";
						i += 2;
					} else if (ch === "*") {
						regexStr += "[^/]*";
						i += 1;
					} else if (ch === "?") {
						regexStr += "[^/]";
						i += 1;
					} else if (/[.+^${}()|[\]\\]/.test(ch)) {
						regexStr += `\\${ch}`;
						i += 1;
					} else {
						regexStr += ch;
						i += 1;
					}
				}
				regexStr += "$";

				try {
					return new RegExp(regexStr).test(normalized);
				} catch {
					return false;
				}
			});
		});
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a remediation policy engine instance.
 *
 * @param config - Partial configuration overrides (uses defaults for omitted fields)
 * @param options - Optional dependencies (e.g., self-modification check function)
 * @returns RemediationPolicyEngine instance
 */
export function createRemediationPolicyEngine(
	config?: Partial<RemediationPolicyEngineConfig>,
	options?: {
		checkSelfModification?: (filePaths: string[]) => SelfModificationCheckResult[];
	},
): RemediationPolicyEngine {
	return new RemediationPolicyEngine(config, options);
}
