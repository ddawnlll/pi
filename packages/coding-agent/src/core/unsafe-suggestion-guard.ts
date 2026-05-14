/**
 * Unsafe Suggestion Guard - P8.D
 *
 * Flags and prevents unsafe suggestions from proceeding. Safeguards
 * against suggestions that would modify protected systems, perform
 * destructive operations, bypass approval gates, or violate safety
 * policies.
 *
 * Acceptance Criteria:
 * - Unsafe suggestions are flagged and cannot proceed.
 * - Each unsafe suggestion includes a reason and explanation.
 * - Enhanced approval can be required for borderline unsafe suggestions.
 */

import type { DetectionResult, UnsafeCheckResult, UnsafeReason } from "./detection-types.js";

// ---------------------------------------------------------------------------
// Built-in Unsafe Patterns
// ---------------------------------------------------------------------------

/**
 * A pattern that identifies potentially unsafe suggestions.
 */
interface UnsafePattern {
	/** The reason this pattern is unsafe */
	reason: UnsafeReason;
	/** Pattern to match against title/description */
	pattern: RegExp;
	/** Whether suggestions matching this pattern are blocked entirely */
	blocked: boolean;
	/** Whether enhanced approval is needed (beyond normal approval) */
	requiresEnhancedApproval: boolean;
	/** Human-readable explanation */
	explanation: string;
}

/**
 * Built-in unsafe patterns.
 *
 * These are hardcoded patterns that identify clearly unsafe suggestions.
 * They match against detection titles and descriptions.
 */
const BUILT_IN_UNSAFE_PATTERNS: UnsafePattern[] = [
	{
		reason: "modifies_protected_system",
		pattern: /modify\s+(the\s+)?(planner|executor|validator|firewall|policy|safety|queue)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation:
			"Suggestions that modify planner, executor, validator, firewall, policy, safety, or queue systems are unsafe and require explicit self-modification approval.",
	},
	{
		reason: "destructive_operation",
		pattern: /(delete|remove|destroy|wipe|clear|truncate)\s+(all|entire|every)\s+(file|data|record|log|backup)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation: "Suggestions involving destructive operations on entire datasets are blocked.",
	},
	{
		reason: "bypasses_approval",
		pattern: /(bypass|skip|ignore|disable)\s+(approval|review|gate|check|validation)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation: "Suggestions that bypass approval, review, or validation gates are blocked.",
	},
	{
		reason: "modifies_executor_state",
		pattern: /(directly\s+)?(modify|mutate|change|alter)\s+(execution|executor)\s+(state|status|log)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation:
			"Suggestions that directly mutate executor state are blocked. State transitions must go through the executor.",
	},
	{
		reason: "modifies_queue",
		pattern: /(modify|mutate|reorder|clear)\s+(the\s+)?(integration\s+)?queue/i,
		blocked: false,
		requiresEnhancedApproval: true,
		explanation: "Suggestions that modify the integration queue require enhanced approval.",
	},
	{
		reason: "bypasses_validation",
		pattern: /(skip|bypass|disable)\s+(validation|testing)/i,
		blocked: false,
		requiresEnhancedApproval: true,
		explanation: "Suggestions that skip or disable validation require enhanced approval.",
	},
	{
		reason: "modifies_security_config",
		pattern: /(modify|change|disable|weaken)\s+(security|auth|permission|access\s+control)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation: "Suggestions that modify security configuration are blocked.",
	},
	{
		reason: "modifies_auth_config",
		pattern: /(modify|change|expose|share)\s+(api[_-]?key|token|credential|secret|password)/i,
		blocked: true,
		requiresEnhancedApproval: true,
		explanation: "Suggestions involving API keys, tokens, credentials, or secrets are blocked.",
	},
	{
		reason: "exceeds_scope",
		pattern: /refactor\s+(entire|whole|all)\s+(project|codebase|application|system)/i,
		blocked: false,
		requiresEnhancedApproval: true,
		explanation: "Suggestions to refactor the entire project require enhanced approval.",
	},
];

// ---------------------------------------------------------------------------
// Protected System Patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that identify pi's own protected source code and configuration.
 * Mirroring the self-modification firewall's protected systems (P8.F).
 */
const PROTECTED_SYSTEM_PATTERNS: Array<{ name: string; patterns: string[] }> = [
	{
		name: "Pi Source Code",
		patterns: ["packages/**/*"],
	},
	{
		name: "Pi Agent Configuration",
		patterns: [".pi/agent/**/*"],
	},
	{
		name: "Pi Project Configuration",
		patterns: [".pi/**/*.json", ".pi/**/*.md"],
	},
	{
		name: "Execution System",
		patterns: ["packages/coding-agent/src/core/executor*", "packages/coding-agent/src/core/plan-queue-runner*"],
	},
	{
		name: "Safety System",
		patterns: ["packages/coding-agent/src/core/safety*", "packages/coding-agent/src/core/write-gate*"],
	},
];

// ---------------------------------------------------------------------------
// Detection-Level Unsafe Checks
// ---------------------------------------------------------------------------

/**
 * Built-in category-level unsafe rules.
 *
 * Certain detection categories are inherently unsafe and always
 * require enhanced approval, even if the individual suggestion
 * doesn't match a specific unsafe pattern.
 */
const CATEGORY_UNSAFE_RULES: Record<string, { blocked: boolean; requiresEnhancedApproval: boolean }> = {
	security_concern: { blocked: false, requiresEnhancedApproval: true },
};

// ---------------------------------------------------------------------------
// UnsafeSuggestionGuard
// ---------------------------------------------------------------------------

/**
 * Guards against unsafe suggestions.
 *
 * Checks detections against built-in unsafe patterns, protected
 * system patterns, and category-level rules. Provides methods to
 * check individual detections, filter unsafe results, and block
 * unsafe suggestions from proceeding.
 */
export class UnsafeSuggestionGuard {
	/** Custom unsafe patterns (in addition to built-in) */
	private customPatterns: UnsafePattern[] = [];

	/**
	 * Add a custom unsafe pattern.
	 *
	 * @param pattern - The unsafe pattern configuration
	 */
	addCustomPattern(pattern: Omit<UnsafePattern, "reason"> & { reason: UnsafeReason }): void {
		this.customPatterns.push(pattern as UnsafePattern);
	}

	/**
	 * Check a detection for unsafe characteristics.
	 *
	 * Returns an UnsafeCheckResult that indicates whether the
	 * detection is unsafe, why, and whether it's blocked.
	 *
	 * @param detection - The detection to check
	 * @returns Unsafe check result
	 */
	check(detection: DetectionResult): UnsafeCheckResult {
		const reasons: UnsafeReason[] = [];
		let blocked = false;
		let requiresEnhancedApproval = false;
		const explanations: string[] = [];

		// Check built-in patterns
		for (const pattern of BUILT_IN_UNSAFE_PATTERNS) {
			if (pattern.pattern.test(detection.title) || pattern.pattern.test(detection.description)) {
				reasons.push(pattern.reason);
				if (pattern.blocked) blocked = true;
				if (pattern.requiresEnhancedApproval) requiresEnhancedApproval = true;
				explanations.push(pattern.explanation);
			}
		}

		// Check custom patterns
		for (const pattern of this.customPatterns) {
			if (pattern.pattern.test(detection.title) || pattern.pattern.test(detection.description)) {
				reasons.push(pattern.reason);
				if (pattern.blocked) blocked = true;
				if (pattern.requiresEnhancedApproval) requiresEnhancedApproval = true;
				explanations.push(pattern.explanation);
			}
		}

		// Check category-level rules
		const categoryRule = CATEGORY_UNSAFE_RULES[detection.category];
		if (categoryRule) {
			if (categoryRule.blocked) blocked = true;
			if (categoryRule.requiresEnhancedApproval) requiresEnhancedApproval = true;
			if (categoryRule.blocked || categoryRule.requiresEnhancedApproval) {
				explanations.push(
					`Detections in category "${detection.category}" require ${categoryRule.requiresEnhancedApproval ? "enhanced approval" : "review"}.`,
				);
			}
		}

		// Check affected paths against protected systems
		if (detection.affectedPaths && detection.affectedPaths.length > 0) {
			for (const affectedPath of detection.affectedPaths) {
				for (const system of PROTECTED_SYSTEM_PATTERNS) {
					for (const pattern of system.patterns) {
						if (this.matchGlob(affectedPath, pattern)) {
							if (!reasons.includes("modifies_protected_system")) {
								reasons.push("modifies_protected_system");
							}
							blocked = true;
							requiresEnhancedApproval = true;
							explanations.push(
								`Affected path "${affectedPath}" matches protected system "${system.name}" (pattern: ${pattern}). Modifications to protected systems are blocked.`,
							);
						}
					}
				}
			}
		}

		const isUnsafe = reasons.length > 0;

		return {
			isUnsafe,
			reasons,
			explanation: explanations.join("\n"),
			blocked,
			requiresEnhancedApproval,
		};
	}

	/**
	 * Filter detections, separating safe from unsafe ones.
	 *
	 * @param detections - Detections to filter
	 * @returns Filtered results with safe, unsafe, and blocked lists
	 */
	filter(detections: DetectionResult[]): {
		safe: DetectionResult[];
		unsafe: DetectionResult[];
		blocked: DetectionResult[];
		checkResults: Record<string, UnsafeCheckResult>;
	} {
		const safe: DetectionResult[] = [];
		const unsafe: DetectionResult[] = [];
		const blocked: DetectionResult[] = [];
		const checkResults: Record<string, UnsafeCheckResult> = {};

		for (const detection of detections) {
			const result = this.check(detection);
			checkResults[detection.id] = result;

			if (result.isUnsafe) {
				unsafe.push(detection);
				if (result.blocked) {
					blocked.push(detection);
				}
			} else {
				safe.push(detection);
			}
		}

		return { safe, unsafe, blocked, checkResults };
	}

	/**
	 * Assert that a detection is safe to proceed.
	 *
	 * Throws an error if the detection is unsafe and blocked.
	 * If the detection is unsafe but not blocked (requires enhanced
	 * approval), returns the check result without throwing.
	 *
	 * @param detection - The detection to check
	 * @throws Error if the detection is unsafe and blocked
	 * @returns UnsafeCheckResult
	 */
	assertSafe(detection: DetectionResult): UnsafeCheckResult {
		const result = this.check(detection);

		if (result.blocked) {
			throw new Error(
				`Unsafe suggestion blocked: ${detection.title}\n` +
					`Reasons: ${result.reasons.join(", ")}\n` +
					`Explanation: ${result.explanation}`,
			);
		}

		if (result.isUnsafe && result.requiresEnhancedApproval) {
			// Not blocked, but requires enhanced approval - return result without throwing
		}

		return result;
	}

	/**
	 * Simple glob matching for protected system patterns.
	 *
	 * Supports ** (match any number of directories) and * (match
	 * within a single path segment).
	 */
	private matchGlob(filePath: string, pattern: string): boolean {
		// Convert glob pattern to regex
		let regexStr = "";
		let i = 0;

		while (i < pattern.length) {
			const ch = pattern[i];

			if (ch === "*" && i + 1 < pattern.length && pattern[i + 1] === "*") {
				// ** matches everything
				regexStr += ".*";
				i += 2;
			} else if (ch === "*") {
				// * matches non-slash characters
				regexStr += "[^/]*";
				i++;
			} else {
				// Escape special regex characters
				regexStr += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
				i++;
			}
		}

		try {
			const regex = new RegExp(`^${regexStr}$`);
			return regex.test(filePath);
		} catch {
			return false;
		}
	}
}

/**
 * Create an unsafe suggestion guard instance.
 *
 * @returns Unsafe suggestion guard instance
 */
export function createUnsafeSuggestionGuard(): UnsafeSuggestionGuard {
	return new UnsafeSuggestionGuard();
}
