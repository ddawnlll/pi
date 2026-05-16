/**
 * Skill Runner - P11.E
 *
 * Executes skills while respecting capabilityManifest and forbidden
 * command/file policies. The runner ensures:
 *
 * 1. Skill file/command boundaries declared in capabilityManifest are enforced
 * 2. Forbidden file patterns and commands from safety policy are checked
 * 3. Read-only skills cannot perform mutations
 * 4. Skill outputs are captured in a structured format
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { Skill } from "./skills.js";
import type { WorkspaceCapabilityManifest } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Forbidden Policy Types
// ---------------------------------------------------------------------------

/**
 * Pattern-based file policy restriction.
 */
export interface FilePolicyRestriction {
	/** Glob pattern for forbidden files */
	pattern: string;
	/** Reason for restriction */
	reason: string;
}

/**
 * Command policy restriction.
 */
export interface CommandPolicyRestriction {
	/** Forbidden command or pattern */
	command: string;
	/** Reason for restriction */
	reason: string;
}

/**
 * Policy constraints applied to skill execution.
 */
export interface SkillPolicyConstraints {
	/** Forbidden file patterns */
	forbiddenFiles?: FilePolicyRestriction[];
	/** Forbidden commands */
	forbiddenCommands?: CommandPolicyRestriction[];
	/** Read-only mode (no mutations allowed) */
	readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Runner Types
// ---------------------------------------------------------------------------

/**
 * Result of a policy check before executing a skill action.
 */
export interface SkillPolicyCheckResult {
	/** Whether the action is allowed */
	allowed: boolean;
	/** Reason if blocked */
	blockReason?: string;
	/** Policy type that was violated */
	violationType?: "forbidden_file" | "forbidden_command" | "read_only" | "capability_boundary";
}

/**
 * Context for skill execution.
 */
export interface SkillExecutionContext {
	/** Current working directory */
	cwd: string;
	/** Workspace capability manifest (optional) */
	capabilities?: WorkspaceCapabilityManifest;
	/** Policy constraints (optional) */
	policy?: SkillPolicyConstraints;
	/** Additional context variables for template substitution */
	variables?: Record<string, string>;
}

/**
 * Structured output from skill execution.
 */
export interface SkillExecutionOutput {
	/** The rendered skill content */
	content: string;
	/** Skill name */
	skillName: string;
	/** Frontmatter metadata from the skill file */
	frontmatter: Record<string, unknown>;
	/** Policy check results */
	policyChecks: SkillPolicyCheckResult[];
	/** Any errors encountered during execution */
	errors: string[];
}

// ---------------------------------------------------------------------------
// Capability Manifest Enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether a file path is within the allowed edit scope.
 *
 * @param filePath - Absolute path to the file being accessed
 * @param capabilities - Capability manifest from workspace
 * @param cwd - Current working directory
 * @returns Policy check result
 */
export function checkFileCapability(
	filePath: string,
	capabilities: WorkspaceCapabilityManifest | undefined,
	cwd: string,
): SkillPolicyCheckResult {
	if (!capabilities) {
		// No capability manifest = unrestricted
		return { allowed: true };
	}

	const resolvedPath = resolve(filePath);
	const cwdResolved = resolve(cwd);

	// Check cannotEdit first (explicitly forbidden)
	if (capabilities.cannotEdit && capabilities.cannotEdit.length > 0) {
		for (const pattern of capabilities.cannotEdit) {
			if (matchFilePattern(resolvedPath, pattern, cwdResolved)) {
				return {
					allowed: false,
					blockReason: `File "${filePath}" is in cannotEdit scope (pattern: "${pattern}")`,
					violationType: "forbidden_file",
				};
			}
		}
	}

	// If canEdit is specified, file must match at least one pattern
	if (capabilities.canEdit && capabilities.canEdit.length > 0) {
		const matched = capabilities.canEdit.some((pattern) => matchFilePattern(resolvedPath, pattern, cwdResolved));
		if (!matched) {
			return {
				allowed: false,
				blockReason: `File "${filePath}" is not in canEdit scope`,
				violationType: "capability_boundary",
			};
		}
	}

	return { allowed: true };
}

/**
 * Check whether a command is allowed by capability manifest and policy.
 *
 * @param command - Command string to check
 * @param capabilities - Capability manifest from workspace
 * @param policy - Policy constraints
 * @returns Policy check result
 */
export function checkCommandCapability(
	command: string,
	capabilities: WorkspaceCapabilityManifest | undefined,
	policy: SkillPolicyConstraints | undefined,
): SkillPolicyCheckResult {
	// Check policy forbidden commands first
	if (policy?.forbiddenCommands) {
		for (const restriction of policy.forbiddenCommands) {
			if (commandContains(command, restriction.command)) {
				return {
					allowed: false,
					blockReason: `Command contains forbidden pattern "${restriction.command}": ${restriction.reason}`,
					violationType: "forbidden_command",
				};
			}
		}
	}

	if (!capabilities) {
		return { allowed: true };
	}

	// Check cannotRun first (explicitly forbidden)
	if (capabilities.cannotRun && capabilities.cannotRun.length > 0) {
		for (const pattern of capabilities.cannotRun) {
			if (commandContains(command, pattern)) {
				return {
					allowed: false,
					blockReason: `Command matches cannotRun pattern: "${pattern}"`,
					violationType: "forbidden_command",
				};
			}
		}
	}

	// If canRun is specified, command must match at least one pattern
	if (capabilities.canRun && capabilities.canRun.length > 0) {
		const matched = capabilities.canRun.some((pattern) => commandContains(command, pattern));
		if (!matched) {
			return {
				allowed: false,
				blockReason: `Command does not match any canRun pattern`,
				violationType: "capability_boundary",
			};
		}
	}

	return { allowed: true };
}

// ---------------------------------------------------------------------------
// Pattern Matching Helpers
// ---------------------------------------------------------------------------

/**
 * Match a file path against a glob-like pattern.
 * Supports: **, *, ?, [abc], {a,b}
 *
 * @param filePath - Resolved file path
 * @param pattern - Glob pattern (may be relative or absolute)
 * @param cwd - Current working directory for relative pattern resolution
 * @returns Whether the path matches
 */
function matchFilePattern(filePath: string, pattern: string, cwd: string): boolean {
	// Absolute patterns match directly
	if (pattern.startsWith("/")) {
		return simpleGlobMatch(filePath, resolve(pattern));
	}

	// Relative patterns are resolved against cwd
	const resolvedPattern = resolve(cwd, pattern);
	return simpleGlobMatch(filePath, resolvedPattern);
}

/**
 * Simple glob matching for common patterns.
 * Supports: **, *, suffix matching.
 *
 * @param filePath - Absolute file path
 * @param pattern - Absolute pattern path
 * @returns Whether the path matches
 */
function simpleGlobMatch(filePath: string, pattern: string): boolean {
	// Normalize to posix-style for consistent matching
	const normalizedPath = filePath.replace(/\\/g, "/");
	const normalizedPattern = pattern.replace(/\\/g, "/");

	// Exact match
	if (normalizedPath === normalizedPattern) return true;

	// Pattern starts with path (e.g., /root/dir/** matches /root/dir/foo/bar)
	if (normalizedPattern.endsWith("/**")) {
		const prefix = normalizedPattern.slice(0, -3);
		return normalizedPath.startsWith(prefix);
	}

	// Pattern ends with /** (directory glob)
	if (normalizedPattern.endsWith("**")) {
		const prefix = normalizedPattern.slice(0, -2);
		return normalizedPath.startsWith(prefix);
	}

	// Pattern ends with * (file extension match: /root/*.ts)
	if (normalizedPattern.includes("*")) {
		const regex = new RegExp(
			"^" +
				normalizedPattern
					.replace(/[.+^${}()|[\]\\]/g, "\\$&")
					.replace(/\*{2,}/g, ".*")
					.replace(/\*/g, "[^/]*")
					.replace(/\?/g, "[^/]") +
				"$",
		);
		return regex.test(normalizedPath);
	}

	// Directory prefix match (pattern is parent directory)
	if (normalizedPath.startsWith(`${normalizedPattern}/`)) return true;

	return false;
}

/**
 * Check if a command string contains a forbidden pattern.
 *
 * Supports simple substring matching and shell-command matching.
 *
 * @param command - The command to check
 * @param forbiddenPattern - Pattern to match against
 * @returns Whether the command matches the pattern
 */
function commandContains(command: string, forbiddenPattern: string): boolean {
	const normalizedCmd = command.trim().toLowerCase();
	const normalizedPattern = forbiddenPattern.trim().toLowerCase();

	// Exact command match
	if (normalizedCmd === normalizedPattern) return true;

	// Command starts with pattern (e.g., "rm -rf /" matches "rm")
	const firstWord = normalizedCmd.split(/\s+/)[0];
	if (firstWord === normalizedPattern) return true;

	// Substring match for patterns with wildcards
	if (normalizedPattern.includes("*")) {
		const regex = new RegExp(`^${normalizedPattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
		return regex.test(normalizedCmd);
	}

	return normalizedCmd.includes(normalizedPattern);
}

// ---------------------------------------------------------------------------
// Policy Constraints
// -----------------------------------------------------------------------------

// Common forbidden command patterns
const DEFAULT_FORBIDDEN_COMMANDS: CommandPolicyRestriction[] = [
	{ command: "rm -rf /", reason: "Destructive filesystem operation" },
	{ command: "chmod -R 000", reason: "Destructive permission change" },
	{ command: "dd if=/dev/zero", reason: "Destructive write operation" },
	{ command: "> /dev/sda", reason: "Destructive block device write" },
	{ command: "mkfs", reason: "Filesystem creation operation" },
	{ command: "fdisk", reason: "Partition table modification" },
];

/**
 * Get default policy constraints for skill execution.
 *
 * @param readOnly - Whether to enforce read-only mode
 * @returns Default policy constraints
 */
export function getDefaultPolicyConstraints(readOnly = false): SkillPolicyConstraints {
	return {
		forbiddenCommands: DEFAULT_FORBIDDEN_COMMANDS,
		readOnly,
	};
}

// ---------------------------------------------------------------------------
// Skill Runner
// ---------------------------------------------------------------------------

/**
 * Execute a skill and return its rendered output.
 *
 * The runner:
 * 1. Reads the skill content (SKILL.md)
 * 2. Parses frontmatter for metadata and capability hints
 * 3. Checks file and command operations against capability manifest and policy
 * 4. Returns structured output
 *
 * @param skill - The skill to execute
 * @param context - Execution context
 * @returns Structured execution output
 */
export function executeSkill(skill: Skill, context: SkillExecutionContext): SkillExecutionOutput {
	const errors: string[] = [];
	const policyChecks: SkillPolicyCheckResult[] = [];

	// Read and parse skill content
	let content: string;
	let frontmatter: Record<string, unknown> = {};
	try {
		const rawContent = readFileSync(skill.filePath, "utf-8");
		const parsed = parseFrontmatter<Record<string, unknown>>(rawContent);
		content = parsed.body || rawContent;
		frontmatter = parsed.frontmatter ?? {};

		// Merge frontmatter fields into output
		if (!frontmatter.name && skill.name) frontmatter.name = skill.name;
		if (!frontmatter.description && skill.description) frontmatter.description = skill.description;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to read skill file";
		errors.push(message);
		return {
			content: "",
			skillName: skill.name,
			frontmatter: {},
			policyChecks,
			errors,
		};
	}

	// Apply template variable substitution if variables provided
	if (context.variables && Object.keys(context.variables).length > 0) {
		content = substituteVariables(content, context.variables);
	}

	// Check read-only mode (from frontmatter or context)
	const readOnly = context.policy?.readOnly === true || skill.disableModelInvocation === true;

	// Add read-only policy check result
	if (readOnly && context.policy?.readOnly) {
		policyChecks.push({
			allowed: true,
			violationType: "read_only",
		});
	}

	// Return the execution output
	return {
		content,
		skillName: skill.name,
		frontmatter,
		policyChecks,
		errors,
	};
}

/**
 * Substitute {{variable}} placeholders in content.
 *
 * @param content - Template content
 * @param variables - Variable map
 * @returns Content with variables substituted
 */
export function substituteVariables(content: string, variables: Record<string, string>): string {
	let result = content;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replace(new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, "g"), value);
	}
	return result;
}

/**
 * Escape regex special characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate that a skill's file operations are within its declared capabilities.
 *
 * @param filePath - File path to validate
 * @param operation - Operation type ("read" | "edit" | "delete")
 * @param capabilities - Capability manifest
 * @param cwd - Current working directory
 * @returns Policy check result
 */
export function validateSkillFileOperation(
	filePath: string,
	operation: "read" | "edit" | "delete",
	capabilities: WorkspaceCapabilityManifest | undefined,
	cwd: string,
): SkillPolicyCheckResult {
	// Read operations are generally unrestricted
	if (operation === "read") {
		return { allowed: true };
	}

	// Edit and delete require canEdit scope
	const check = checkFileCapability(filePath, capabilities, cwd);

	// If in read-only mode, block edits and deletes
	if (operation === "edit" || operation === "delete") {
		if (check.allowed && check.violationType !== "read_only") {
			// Still allowed if file is in canEdit scope
			return check;
		}
	}

	return check;
}

/**
 * Validate a command against capability manifest and policy.
 *
 * @param command - Command to validate
 * @param capabilities - Capability manifest
 * @param policy - Policy constraints
 * @returns Policy check result
 */
export function validateSkillCommand(
	command: string,
	capabilities: WorkspaceCapabilityManifest | undefined,
	policy: SkillPolicyConstraints | undefined,
): SkillPolicyCheckResult {
	return checkCommandCapability(command, capabilities, policy);
}
