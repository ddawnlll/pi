/**
 * BashCommandClassifier — PSS-MEGA-02
 *
 * Classifies bash commands by state effect using conservative heuristics.
 * Unknown/ambiguous → unknown_global_mutation (safe default).
 */

import type { CommandClassification } from "./event-types.js";

// ============================================================================
// Read-only command prefixes (high confidence)
// ============================================================================

const READ_ONLY_PREFIXES = [
	"pwd",
	"ls",
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"which",
	"echo",
	"printf",
	"rg",
	"grep",
	"egrep",
	"fgrep",
	"find",
	"wc",
	"sort",
	"uniq",
	"cut",
	"tr",
	"od",
	"xxd",
	"hexdump",
	"file",
	"stat",
	"du",
	"df",
	"env",
	"printenv",
	"git status",
	"git diff",
	"git log",
	"git rev-parse",
	"git branch",
	"git show",
	"git stash list",
	"npm pkg get",
	"pnpm pkg get",
	"yarn info",
];

// ============================================================================
// Path-local mutation prefixes (high confidence)
// ============================================================================

const PATH_LOCAL_PREFIXES = ["touch", "tee"];

const PATH_LOCAL_PATTERNS = [/{? *[a-zA-Z]+ *[>][>]?/, /{? *[a-zA-Z]+ *[|] *tee/, /{? *echo.*[|].*sed/];

// ============================================================================
// Tree mutation prefixes
// ============================================================================

const TREE_MUTATION_PREFIXES = ["mkdir", "rmdir", "cp", "mv", "install -d"];

const TREE_MUTATION_PATTERNS = [/^rm\s/];

// ============================================================================
// Package mutation prefixes
// ============================================================================

const PACKAGE_MUTATION_PREFIXES = [
	"npm install",
	"npm uninstall",
	"npm update",
	"npm add",
	"npm remove",
	"pnpm install",
	"pnpm uninstall",
	"pnpm update",
	"pnpm add",
	"pnpm remove",
	"yarn add",
	"yarn remove",
	"yarn install",
	"yarn upgrade",
	"bun install",
	"bun add",
	"bun remove",
	"bun update",
];

// ============================================================================
// Git mutation prefixes
// ============================================================================

const GIT_MUTATION_PREFIXES = [
	"git checkout",
	"git reset",
	"git clean",
	"git merge",
	"git rebase",
	"git pull",
	"git push",
	"git switch",
	"git restore",
	"git commit",
	"git add",
	"git rm",
	"git mv",
	"git stash push",
	"git stash drop",
	"git stash pop",
	"git fetch",
	"git cherry-pick",
	"git revert",
];

// ============================================================================
// Dangerous destructive patterns
// ============================================================================

const DANGEROUS_PATTERNS = [
	/^rm\s+-rf\s*[.\s/]/,
	/^rm\s+-rf\s+--no-preserve-root/,
	/^rm\s+-rf\s+\//,
	/^find\s+.*-delete/,
	/^git\s+clean\s+-fdx/,
	/^git\s+clean\s+-fd\s*$/,
	/>\s*\/dev\//,
];

// ============================================================================
// Shell operators that compound uncertainty
// ============================================================================

const SHELL_OPERATORS = [/\|\|/, /&&/, /;/, /\|/, /`[^`]+`/, /\$\(/, /xargs/, /heredoc/, /[>][>]?/, /[<]/];

const DANGEROUS_SHELL_PATTERNS = [/\bdd\s+/, /\bformat\s+/, /\bmkfs\s+/, /\bfdisk\s+/, /\bparted\s+/];

// ============================================================================
// Classifier
// ============================================================================

/**
 * Classify a bash command by its state effect.
 */
export function classifyCommand(command: string): CommandClassification {
	const trimmed = command.trim();
	const lower = trimmed.toLowerCase();

	// Check dangerous patterns first
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(lower)) {
			return {
				effect: "dangerous_destructive_mutation",
				confidence: "high",
				requiresMutationWindow: true,
				requiresReconcile: "bounded_tree",
				reason: `Matched dangerous pattern: ${pattern}`,
			};
		}
	}

	// Check for shell operators — if present, be more conservative
	const hasShellOperator = SHELL_OPERATORS.some((op) => op.test(lower));

	// Check package mutation
	for (const prefix of PACKAGE_MUTATION_PREFIXES) {
		if (lower.startsWith(prefix)) {
			return {
				effect: "package_state_mutation",
				confidence: "high",
				requiresMutationWindow: true,
				requiresReconcile: "bounded_tree",
				reason: `Package mutation: ${prefix}`,
			};
		}
	}

	// Check git mutation
	for (const prefix of GIT_MUTATION_PREFIXES) {
		if (lower.startsWith(prefix)) {
			return {
				effect: "git_state_mutation",
				confidence: "high",
				requiresMutationWindow: true,
				requiresReconcile: "bounded_tree",
				reason: `Git mutation: ${prefix}`,
			};
		}
	}

	// Check tree mutation
	for (const prefix of TREE_MUTATION_PREFIXES) {
		if (lower.startsWith(prefix)) {
			return {
				effect: "tree_mutation",
				confidence: "high",
				affectedPaths: extractPaths(trimmed),
				requiresMutationWindow: false,
				requiresReconcile: "parent_dirs",
				reason: `Tree mutation: ${prefix}`,
			};
		}
	}

	for (const pattern of TREE_MUTATION_PATTERNS) {
		if (pattern.test(lower)) {
			const isDangerous = /^rm\s+-rf\s+/.test(lower) || lower.startsWith("rm -r /");
			return {
				effect: isDangerous ? "dangerous_destructive_mutation" : "tree_mutation",
				confidence: isDangerous ? "high" : "medium",
				affectedPaths: extractPaths(trimmed),
				requiresMutationWindow: isDangerous,
				requiresReconcile: isDangerous ? "bounded_tree" : "parent_dirs",
				reason: isDangerous ? "Dangerous recursive delete" : "Tree mutation via rm",
			};
		}
	}

	// Check if compound command with operators — conservative handling
	if (hasShellOperator && !isSimpleReadOnly(lower)) {
		// Check if redirection + read-only makes it a mutation
		if (isReadOnlyCommand(lower) && (hasRedirection(lower) || lower.includes("| tee"))) {
			return {
				effect: "path_local_mutation",
				confidence: "medium",
				affectedPaths: extractPaths(trimmed),
				requiresMutationWindow: false,
				requiresReconcile: "path",
				reason: "Read command with redirection/tee is a local mutation",
			};
		}

		// Also check if the compound is a known pipe to tee pattern
		if (lower.includes("| tee")) {
			return {
				effect: "path_local_mutation",
				confidence: "medium",
				requiresMutationWindow: false,
				requiresReconcile: "path",
				reason: "Pipe to tee is a local mutation",
			};
		}

		return {
			effect: "unknown_global_mutation",
			confidence: "low",
			requiresMutationWindow: true,
			requiresReconcile: "bounded_tree",
			reason: "Compound command with shell operators — classified conservatively",
		};
	}

	// Check path-local mutation
	for (const prefix of PATH_LOCAL_PREFIXES) {
		if (lower.startsWith(prefix)) {
			return {
				effect: "path_local_mutation",
				confidence: "high",
				affectedPaths: extractPaths(trimmed),
				requiresMutationWindow: false,
				requiresReconcile: "path",
				reason: `Local mutation: ${prefix}`,
			};
		}
	}

	for (const pattern of PATH_LOCAL_PATTERNS) {
		if (pattern.test(lower)) {
			return {
				effect: "path_local_mutation",
				confidence: "medium",
				affectedPaths: extractPaths(trimmed),
				requiresMutationWindow: false,
				requiresReconcile: "path",
				reason: "Local mutation via redirection",
			};
		}
	}

	// Check if there are dangerous shell patterns mixed in (after specific mutations ruled out)
	if (DANGEROUS_SHELL_PATTERNS.some((p) => p.test(lower))) {
		return {
			effect: "unknown_global_mutation",
			confidence: "low",
			requiresMutationWindow: true,
			requiresReconcile: "bounded_tree",
			reason: "Command contains destructive shell patterns",
		};
	}

	// Check read-only
	if (isReadOnlyCommand(lower)) {
		return {
			effect: "no_state_change",
			confidence: "high",
			requiresMutationWindow: false,
			requiresReconcile: "none",
			reason: "Read-only command",
		};
	}

	// Default: unknown
	return {
		effect: "unknown_global_mutation",
		confidence: "low",
		requiresMutationWindow: true,
		requiresReconcile: "bounded_tree",
		reason: "Command not recognized as safe or known mutation",
	};
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a command is likely read-only (high confidence).
 */
function isReadOnlyCommand(lower: string): boolean {
	// Strip leading shell constructs
	const stripped = lower.replace(/^\{?\s*/, "");

	for (const prefix of READ_ONLY_PREFIXES) {
		if (stripped.startsWith(prefix)) {
			return true;
		}
	}

	return false;
}

/**
 * Check if a command is a simple read-only without redirection.
 */
function isSimpleReadOnly(lower: string): boolean {
	if (!isReadOnlyCommand(lower)) return false;
	if (hasRedirection(lower)) return false;
	// Not simple if it has shell operators
	if (SHELL_OPERATORS.some((op) => op.test(lower))) return false;
	return true;
}

/**
 * Check if a command contains redirection operators.
 */
function hasRedirection(lower: string): boolean {
	return /[>][>]?/.test(lower) || /[<]/.test(lower);
}

/**
 * Extract file/directory paths from a command (simple heuristic).
 */
function extractPaths(command: string): string[] {
	// Extract non-flag, non-operator tokens that look like paths
	const tokens = command.split(/\s+/);
	const paths: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.startsWith("-")) continue;
		if (token.startsWith("|") || token.startsWith(">") || token.startsWith("<")) continue;
		if (token.startsWith("$") || token.startsWith("`")) continue;
		if (["&&", "||", ";", "|"].includes(token)) continue;
		if (
			["cp", "mv", "rm", "mkdir", "touch", "cat", "tee", "ls", "sed", "perl", "chmod", "chown"].includes(
				tokens[i - 1] ?? "",
			)
		) {
			if (!token.startsWith("-")) {
				paths.push(token);
			}
		}
	}

	return paths;
}
