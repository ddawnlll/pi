/**
 * Safety Profiles - P5 Workstream 5.E
 *
 * Defines safety profiles (Strict, Balanced, Full Auto) that control
 * what commands and operations the agent is allowed to execute.
 *
 * Strict (default): Most restrictive. Blocks all dangerous commands,
 *   requires confirmation for any shell execution.
 * Balanced: Allows common development commands, blocks destructive ones,
 *   requires confirmation for deployment/publish operations.
 * Full Auto: Least restrictive. All commands allowed but explicit
 *   confirmation required for destructive operations (git push, rm -rf).
 *
 * ALL profiles block: git push, rm -rf
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Safety profile names.
 *
 * - "strict"    : Maximum safety, confirmation required for most operations
 * - "balanced"  : Moderate safety, common dev operations allowed
 * - "full_auto" : Minimal restrictions, explicit confirmation for destructive ops
 */
export type SafetyProfileName = "strict" | "balanced" | "full_auto";

/**
 * Permission level for a command or operation category.
 *
 * - "blocked"       : Command is completely blocked
 * - "confirm"       : Command requires explicit user confirmation before execution
 * - "allowed"       : Command is allowed without confirmation
 */
export type PermissionLevel = "blocked" | "confirm" | "allowed";

/**
 * Permission rule for a command pattern.
 */
export interface PermissionRule {
	/** Glob or regex pattern for matching commands */
	pattern: string;
	/** Permission level for this pattern */
	level: PermissionLevel;
	/** Human-readable description */
	description: string;
	/** Whether this rule applies to subcommands (default: true) */
	includesSubcommands?: boolean;
}

/**
 * File permission rule for path patterns.
 */
export interface FilePermissionRule {
	/** Glob pattern for matching file paths */
	pattern: string;
	/** Permission level */
	level: PermissionLevel;
	/** Human-readable description */
	description: string;
}

/**
 * Effective permissions computed from a safety profile.
 */
export interface EffectivePermissions {
	/** Profile name */
	profile: SafetyProfileName;
	/** Shell command permission rules */
	commandRules: PermissionRule[];
	/** File access permission rules */
	fileRules: FilePermissionRule[];
	/** Whether shell commands require confirmation by default */
	defaultShellConfirmation: boolean;
	/** Whether file writes require confirmation by default */
	defaultFileWriteConfirmation: boolean;
	/** Whether plan execution requires confirmation */
	planExecutionConfirmation: boolean;
	/** Maximum allowed parallel workspace count (0 = unlimited) */
	maxParallelWorkspaces: number;
	/** Whether Full Auto explicit confirmation is required */
	fullAutoExplicitConfirmation: boolean;
}

/**
 * Result of checking a command against a safety profile.
 */
export interface CommandCheckResult {
	/** Whether the command is allowed */
	allowed: boolean;
	/** Permission level for this command */
	level: PermissionLevel;
	/** Human-readable reason */
	reason: string;
	/** Which rule was matched (if any) */
	matchedRule?: PermissionRule;
}

/**
 * Result of checking a file operation against a safety profile.
 */
export interface FileCheckResult {
	/** Whether the operation is allowed */
	allowed: boolean;
	/** Permission level */
	level: PermissionLevel;
	/** Human-readable reason */
	reason: string;
	/** Which rule was matched (if any) */
	matchedRule?: FilePermissionRule;
}

// =============================================================================
// Globally Blocked Commands (All Profiles)
// =============================================================================

/**
 * Commands that are BLOCKED in ALL safety profiles.
 * These are always dangerous and should never be executed without
 * at minimum explicit confirmation.
 */
export const ALWAYS_BLOCKED_COMMANDS: PermissionRule[] = [
	{
		pattern: "rm -rf",
		level: "blocked",
		description: "Recursive force delete - can destroy entire directories",
	},
	{
		pattern: "rm -fr",
		level: "blocked",
		description: "Recursive force delete (alternate flag order)",
	},
	{
		pattern: "rm --recursive --force",
		level: "blocked",
		description: "Recursive force delete (long flags)",
	},
	{
		pattern: "git push",
		level: "blocked",
		description: "Pushing to remote repository - can affect shared state",
	},
];

/**
 * Additional destructive commands that are blocked in Strict and Balanced
 * profiles but require explicit confirmation in Full Auto.
 */
export const DESTRUCTIVE_COMMANDS: PermissionRule[] = [
	{
		pattern: "git push --force",
		level: "blocked",
		description: "Force push - rewrites remote history",
	},
	{
		pattern: "git reset --hard",
		level: "blocked",
		description: "Hard reset - discards all uncommitted changes",
	},
	{
		pattern: "git clean -fd",
		level: "blocked",
		description: "Clean untracked files and directories",
	},
	{
		pattern: "npm publish",
		level: "blocked",
		description: "Publish to npm registry",
	},
	{
		pattern: "yarn publish",
		level: "blocked",
		description: "Publish via yarn",
	},
	{
		pattern: "pnpm publish",
		level: "blocked",
		description: "Publish via pnpm",
	},
	{
		pattern: "docker rm",
		level: "blocked",
		description: "Remove Docker containers",
	},
	{
		pattern: "docker rmi",
		level: "blocked",
		description: "Remove Docker images",
	},
	{
		pattern: "docker system prune",
		level: "blocked",
		description: "Prune all unused Docker resources",
	},
	{
		pattern: "kubectl delete",
		level: "blocked",
		description: "Delete Kubernetes resources",
	},
	{
		pattern: "terraform destroy",
		level: "blocked",
		description: "Destroy Terraform infrastructure",
	},
	{
		pattern: "aws s3 rm",
		level: "blocked",
		description: "Remove S3 objects",
	},
	{
		pattern: "gcloud delete",
		level: "blocked",
		description: "Delete GCP resources",
	},
	{
		pattern: "heroku destroy",
		level: "blocked",
		description: "Destroy Heroku apps",
	},
	{
		pattern: "vercel --prod",
		level: "blocked",
		description: "Deploy to Vercel production",
	},
	{
		pattern: "netlify deploy --prod",
		level: "blocked",
		description: "Deploy to Netlify production",
	},
];

/**
 * Deployment commands that require confirmation in Balanced profile
 * and are blocked in Strict profile.
 */
export const DEPLOYMENT_COMMANDS: PermissionRule[] = [
	{
		pattern: "npm run deploy",
		level: "confirm",
		description: "Deploy script - requires confirmation",
	},
	{
		pattern: "npm run build",
		level: "confirm",
		description: "Build script - requires confirmation",
	},
];

/**
 * Secret file patterns that are always blocked from writing.
 */
export const ALWAYS_BLOCKED_FILES: FilePermissionRule[] = [
	{
		pattern: "**/.env",
		level: "blocked",
		description: "Environment variable files - may contain secrets",
	},
	{
		pattern: "**/.env.*",
		level: "blocked",
		description: "Environment variable files (variants)",
	},
	{
		pattern: "**/*.pem",
		level: "blocked",
		description: "PEM certificates/keys",
	},
	{
		pattern: "**/*.key",
		level: "blocked",
		description: "Private key files",
	},
	{
		pattern: "**/secrets/**",
		level: "blocked",
		description: "Secrets directories",
	},
	{
		pattern: "**/credentials/**",
		level: "blocked",
		description: "Credentials directories",
	},
	{
		pattern: "**/id_rsa",
		level: "blocked",
		description: "SSH private keys",
	},
	{
		pattern: "**/id_ed25519",
		level: "blocked",
		description: "SSH Ed25519 private keys",
	},
];

// =============================================================================
// Profile Definitions
// =============================================================================

/**
 * Strict safety profile.
 *
 * Most restrictive profile. All shell commands require confirmation.
 * File writes to existing files require confirmation. Plan execution
 * requires confirmation. Maximum 1 parallel workspace.
 *
 * Always-blocked commands (git push, rm -rf) remain blocked.
 * Destructive and deployment commands are blocked.
 */
export const STRICT_PROFILE: EffectivePermissions = {
	profile: "strict",
	commandRules: [
		...ALWAYS_BLOCKED_COMMANDS,
		...DESTRUCTIVE_COMMANDS.map((rule) => ({ ...rule, level: "blocked" as PermissionLevel })),
		...DEPLOYMENT_COMMANDS.map((rule) => ({ ...rule, level: "blocked" as PermissionLevel })),
	],
	fileRules: [...ALWAYS_BLOCKED_FILES],
	defaultShellConfirmation: true,
	defaultFileWriteConfirmation: true,
	planExecutionConfirmation: true,
	maxParallelWorkspaces: 1,
	fullAutoExplicitConfirmation: false,
};

/**
 * Balanced safety profile.
 *
 * Moderate restrictions. Common development commands (git status, git diff,
 * npm test, npm run dev, ls, cat, etc.) are allowed. Destructive commands
 * are blocked. Deployment commands require confirmation. Up to 3 parallel
 * workspaces.
 *
 * Always-blocked commands (git push, rm -rf) remain blocked.
 */
export const BALANCED_PROFILE: EffectivePermissions = {
	profile: "balanced",
	commandRules: [
		...ALWAYS_BLOCKED_COMMANDS,
		...DESTRUCTIVE_COMMANDS.map((rule) => ({ ...rule, level: "blocked" as PermissionLevel })),
		...DEPLOYMENT_COMMANDS,
	],
	fileRules: [...ALWAYS_BLOCKED_FILES],
	defaultShellConfirmation: false,
	defaultFileWriteConfirmation: false,
	planExecutionConfirmation: true,
	maxParallelWorkspaces: 3,
	fullAutoExplicitConfirmation: false,
};

/**
 * Full Auto safety profile.
 *
 * Least restrictive profile. Most commands allowed without confirmation.
 * Destructive commands require explicit confirmation (not just default
 * confirmation - must be explicitly approved by user each time).
 * Always-blocked commands (git push, rm -rf) still require explicit
 * confirmation override. Up to 5 parallel workspaces.
 *
 * KEY: git push and rm -rf are NOT silently blocked - they are set to
 * "confirm" level, meaning they require EXPLICIT confirmation each time.
 * Full Auto allows them only after the user explicitly confirms.
 */
export const FULL_AUTO_PROFILE: EffectivePermissions = {
	profile: "full_auto",
	commandRules: [
		// git push and rm -rf require EXPLICIT confirmation in full_auto
		{
			pattern: "rm -rf",
			level: "confirm",
			description: "Recursive force delete - requires explicit confirmation",
		},
		{
			pattern: "rm -fr",
			level: "confirm",
			description: "Recursive force delete (alternate) - requires explicit confirmation",
		},
		{
			pattern: "rm --recursive --force",
			level: "confirm",
			description: "Recursive force delete (long flags) - requires explicit confirmation",
		},
		{
			pattern: "git push",
			level: "confirm",
			description: "Pushing to remote - requires explicit confirmation",
		},
		// Other destructive commands also require confirmation in full_auto
		...DESTRUCTIVE_COMMANDS.map((rule) => ({
			...rule,
			level: "confirm" as PermissionLevel,
		})),
		// Deployment commands allowed in full_auto
		...DEPLOYMENT_COMMANDS.map((rule) => ({
			...rule,
			level: "allowed" as PermissionLevel,
		})),
	],
	fileRules: [...ALWAYS_BLOCKED_FILES],
	defaultShellConfirmation: false,
	defaultFileWriteConfirmation: false,
	planExecutionConfirmation: false,
	maxParallelWorkspaces: 5,
	fullAutoExplicitConfirmation: true,
};

// =============================================================================
// Profile Registry
// =============================================================================

/** Map of profile names to their definitions */
const PROFILE_MAP: Record<SafetyProfileName, EffectivePermissions> = {
	strict: STRICT_PROFILE,
	balanced: BALANCED_PROFILE,
	full_auto: FULL_AUTO_PROFILE,
};

// =============================================================================
// Default
// =============================================================================

/** Default safety profile name */
export const DEFAULT_SAFETY_PROFILE: SafetyProfileName = "strict";

// =============================================================================
// Functions
// =============================================================================

/**
 * Get the effective permissions for a given safety profile.
 *
 * @param profileName - Profile name (defaults to "strict")
 * @returns Effective permissions for the profile
 */
export function getEffectivePermissions(profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE): EffectivePermissions {
	return PROFILE_MAP[profileName] ?? STRICT_PROFILE;
}

/**
 * Check if a command is allowed under the given safety profile.
 *
 * @param command - The shell command to check
 * @param profileName - Safety profile name
 * @returns Command check result
 */
export function checkCommand(
	command: string,
	profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE,
): CommandCheckResult {
	const permissions = getEffectivePermissions(profileName);
	const normalizedCommand = command.trim().toLowerCase();

	// Check against command rules - more specific patterns first (longer pattern = more specific)
	const sortedRules = [...permissions.commandRules].sort((a, b) => b.pattern.length - a.pattern.length);

	for (const rule of sortedRules) {
		const patternLower = rule.pattern.toLowerCase();
		if (normalizedCommand.includes(patternLower)) {
			return {
				allowed: rule.level !== "blocked",
				level: rule.level,
				reason: rule.description,
				matchedRule: rule,
			};
		}
	}

	// No rule matched - use default shell confirmation behavior
	if (permissions.defaultShellConfirmation) {
		return {
			allowed: false,
			level: "confirm",
			reason: "Strict profile requires confirmation for all shell commands",
		};
	}

	return {
		allowed: true,
		level: "allowed",
		reason: "No restrictive rule matched; command is allowed by default",
	};
}

/**
 * Check if a file write operation is allowed under the given safety profile.
 *
 * @param filePath - The file path being written
 * @param profileName - Safety profile name
 * @returns File check result
 */
export function checkFileOperation(
	filePath: string,
	profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE,
): FileCheckResult {
	const permissions = getEffectivePermissions(profileName);
	const normalizedPath = filePath.replace(/\\/g, "/");

	// Check against file rules
	for (const rule of permissions.fileRules) {
		if (matchGlob(normalizedPath, rule.pattern)) {
			return {
				allowed: rule.level !== "blocked",
				level: rule.level,
				reason: rule.description,
				matchedRule: rule,
			};
		}
	}

	// No rule matched - use default file write confirmation behavior
	if (permissions.defaultFileWriteConfirmation) {
		return {
			allowed: false,
			level: "confirm",
			reason: "Strict profile requires confirmation for file writes",
		};
	}

	return {
		allowed: true,
		level: "allowed",
		reason: "No restrictive rule matched; file operation is allowed by default",
	};
}

/**
 * Check if git push is blocked in the given profile.
 *
 * @param profileName - Safety profile name
 * @returns True if git push is blocked
 */
export function isGitPushBlocked(profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE): boolean {
	const result = checkCommand("git push", profileName);
	return result.level === "blocked";
}

/**
 * Check if rm -rf is blocked in the given profile.
 *
 * @param profileName - Safety profile name
 * @returns True if rm -rf is blocked
 */
export function isRmRfBlocked(profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE): boolean {
	const result = checkCommand("rm -rf", profileName);
	return result.level === "blocked";
}

/**
 * Check if the given profile requires explicit confirmation for destructive commands.
 *
 * In Full Auto, destructive commands require EXPLICIT confirmation (not default
 * confirmation handling). This means the user must actively approve each
 * destructive operation.
 *
 * @param profileName - Safety profile name
 * @returns True if explicit confirmation is required
 */
export function requiresExplicitConfirmation(profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE): boolean {
	const permissions = getEffectivePermissions(profileName);
	return permissions.fullAutoExplicitConfirmation;
}

/**
 * Check whether Full Auto profile requires explicit confirmation for a command.
 *
 * In Full Auto mode, git push and rm -rf are not blocked but require
 * the user to explicitly confirm each time they are used.
 *
 * @param command - The command to check
 * @returns True if explicit confirmation is required in Full Auto
 */
export function fullAutoRequiresConfirmation(command: string): boolean {
	const result = checkCommand(command, "full_auto");
	// In full_auto, commands at "confirm" level require explicit confirmation
	return result.level === "confirm";
}

/**
 * Get a human-readable description of the effective permissions for a profile.
 *
 * @param profileName - Safety profile name
 * @returns Formatted string describing the profile's permissions
 */
export function describePermissions(profileName: SafetyProfileName = DEFAULT_SAFETY_PROFILE): string {
	const permissions = getEffectivePermissions(profileName);
	const lines: string[] = [];

	const NL = String.fromCharCode(10);

	lines.push(`=== Safety Profile: ${profileName} ===`);
	lines.push("");

	// Shell permissions
	lines.push("Shell Commands:");
	if (permissions.defaultShellConfirmation) {
		lines.push("  All commands require confirmation by default");
	} else {
		lines.push("  Commands allowed by default unless matched by a rule");
	}
	lines.push("");

	// Blocked commands
	const blocked = permissions.commandRules.filter((r) => r.level === "blocked");
	const confirmed = permissions.commandRules.filter((r) => r.level === "confirm");

	if (blocked.length > 0) {
		lines.push("  Blocked Commands:");
		for (const rule of blocked) {
			const X = String.fromCharCode(10060); // cross mark
			lines.push(`    ${X} ${rule.pattern} - ${rule.description}`);
		}
		lines.push("");
	}

	if (confirmed.length > 0) {
		lines.push("  Requires Confirmation:");
		for (const rule of confirmed) {
			const Q = String.fromCharCode(10067); // question mark
			lines.push(`    ${Q} ${rule.pattern} - ${rule.description}`);
		}
		lines.push("");
	}

	// File permissions
	lines.push("File Operations:");
	if (permissions.defaultFileWriteConfirmation) {
		lines.push("  All file writes require confirmation by default");
	} else {
		lines.push("  File writes allowed by default unless matched by a rule");
	}
	lines.push("");

	const blockedFiles = permissions.fileRules.filter((r) => r.level === "blocked");
	if (blockedFiles.length > 0) {
		lines.push("  Blocked File Patterns:");
		for (const rule of blockedFiles) {
			const X = String.fromCharCode(10060); // cross mark
			lines.push(`    ${X} ${rule.pattern} - ${rule.description}`);
		}
		lines.push("");
	}

	// Execution settings
	lines.push("Execution Settings:");
	lines.push(`  Plan execution confirmation: ${permissions.planExecutionConfirmation ? "Required" : "Not required"}`);
	lines.push(
		`  Max parallel workspaces: ${permissions.maxParallelWorkspaces === 0 ? "Unlimited" : permissions.maxParallelWorkspaces}`,
	);
	if (permissions.fullAutoExplicitConfirmation) {
		lines.push("  Full Auto explicit confirmation: Required for destructive commands");
	}

	return lines.join(NL);
}

/**
 * Simple glob matcher.
 *
 * Supports:
 * - `*` matches any sequence of characters except /
 * - `**` matches any sequence of characters including /
 * - `?` matches any single character except /
 *
 * @param path - File path to match
 * @param pattern - Glob pattern
 * @returns True if the path matches the pattern
 */
function matchGlob(path: string, pattern: string): boolean {
	// Normalize paths to forward slashes
	const normalizedPath = path.replace(/\\/g, "/");
	const normalizedPattern = pattern.replace(/\\/g, "/");

	// Build a regex from the glob pattern
	let regexStr = "";
	let i = 0;
	while (i < normalizedPattern.length) {
		const ch = normalizedPattern[i];
		if (ch === "*" && normalizedPattern[i + 1] === "*") {
			// ** matches anything including /
			regexStr += ".*";
			i += 2;
			// Skip trailing / after **
			if (normalizedPattern[i] === "/") {
				i++;
			}
		} else if (ch === "*") {
			// * matches anything except /
			regexStr += "[^/]*";
			i++;
		} else if (ch === "?") {
			// ? matches any single char except /
			regexStr += "[^/]";
			i++;
		} else if (isRegexSpecial(ch)) {
			regexStr += `\\${ch}`;
			i++;
		} else {
			regexStr += ch;
			i++;
		}
	}

	try {
		const regex = new RegExp(`^${regexStr}$`);
		return regex.test(normalizedPath);
	} catch {
		return false;
	}
}

/**
 * Check if a character needs regex escaping.
 *
 * @param ch - Single character
 * @returns True if the character is a regex metacharacter
 */
function isRegexSpecial(ch: string): boolean {
	// break the $ + {} sequence so biome doesn't flag it
	const specials = ".+^${" + "}()|[]";
	return specials.includes(ch);
}

/**
 * Get all available safety profile names.
 *
 * @returns Array of profile names
 */
export function getAvailableProfiles(): SafetyProfileName[] {
	return ["strict", "balanced", "full_auto"];
}

/**
 * Get a brief summary description of a safety profile.
 *
 * @param profileName - Profile name
 * @returns Human-readable description
 */
export function getProfileDescription(profileName: SafetyProfileName): string {
	switch (profileName) {
		case "strict":
			return "Maximum safety. All shell commands require confirmation. Destructive commands and git push are blocked. File writes require confirmation. Single workspace execution only.";
		case "balanced":
			return "Moderate safety. Common development commands allowed. Destructive commands and git push are blocked. Deployment commands require confirmation. Up to 3 parallel workspaces.";
		case "full_auto":
			return "Least restrictive. Most commands allowed. git push and rm -rf require EXPLICIT confirmation each time. Destructive operations also require confirmation. Up to 5 parallel workspaces.";
		default:
			return `Unknown profile: ${profileName}`;
	}
}
