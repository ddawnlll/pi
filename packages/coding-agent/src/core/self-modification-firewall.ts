/**
 * Self-Modification Firewall - P8.F
 *
 * Declares protected systems (pi's own source code and configuration) and
 * prevents autonomous modification of those systems. Self-modifying proposals
 * require explicit approval beyond normal approval.
 *
 * Acceptance Criteria:
 * 1. Protected systems are declared and enforced.
 * 2. Self-modifying proposals require explicit approval beyond normal approval.
 * 3. No autonomous execution can modify protected systems.
 */

import * as path from "node:path";
import type { Workspace } from "./workspace-schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A protected system declaration.
 */
export interface ProtectedSystem {
	/** Unique identifier for this protected system */
	id: string;
	/** Human-readable name */
	name: string;
	/** Glob-like path patterns for files in this system */
	patterns: string[];
	/** Description of why this system is protected */
	reason: string;
}

/**
 * Result of checking a file path against the firewall.
 */
export interface SelfModificationCheckResult {
	/** Whether the file is a protected system */
	isProtected: boolean;
	/** Which protected system was matched (if any) */
	matchedSystem?: ProtectedSystem;
	/** Human-readable explanation */
	reason: string;
	/** Whether the modification is blocked entirely (autonomous mode) */
	blocked: boolean;
	/** Whether explicit approval is required beyond normal approval */
	requiresEnhancedApproval: boolean;
}

/**
 * Report of all self-modification targets detected in a plan or tool call.
 */
export interface SelfModificationReport {
	/** Whether any self-modification was detected */
	hasSelfModification: boolean;
	/** File paths that are protected */
	protectedPaths: string[];
	/** Protected systems that would be modified */
	affectedSystems: ProtectedSystem[];
	/** Human-readable summary */
	summary: string;
	/** Whether any of these modifications are blocked entirely */
	anyBlocked: boolean;
}

/**
 * Configuration for the self-modification firewall.
 */
export interface SelfModificationFirewallConfig {
	/** Working directory to resolve relative paths against */
	cwd: string;
	/** Whether the agent is in autonomous mode (no user present) */
	isAutonomous: boolean;
	/** Additional protected systems (user-defined) */
	customProtectedSystems?: ProtectedSystem[];
}

// ---------------------------------------------------------------------------
// Default Protected Systems
// ---------------------------------------------------------------------------

/**
 * Built-in protected systems for pi itself.
 *
 * These patterns match files that are part of pi's own source code,
 * configuration, and runtime. Modifying these constitutes self-modification.
 */
export const BUILT_IN_PROTECTED_SYSTEMS: ProtectedSystem[] = [
	{
		id: "pi-source-code",
		name: "Pi Source Code",
		patterns: ["packages/**/*"],
		reason: "Pi's own source code. Modifying it changes how pi itself works.",
	},
	{
		id: "pi-agent-config",
		name: "Pi Agent Configuration",
		patterns: [".pi/agent/AGENTS.md", ".pi/agent/**/*"],
		reason: "Agent configuration that defines pi's behavior and rules.",
	},
	{
		id: "pi-settings",
		name: "Pi Settings",
		patterns: [".pi/settings.json"],
		reason: "Pi's runtime settings and provider configuration.",
	},
	{
		id: "pi-skill-manifests",
		name: "Pi Skill Manifests",
		patterns: [".pi/skills/**/*"],
		reason: "Skill definitions that extend pi's capabilities.",
	},
];

// ---------------------------------------------------------------------------
// SelfModificationFirewall
// ---------------------------------------------------------------------------

/**
 * Self-modification firewall for pi.
 *
 * Enforces the self-modification firewall by:
 * 1. Declaring protected systems (file path patterns for pi's own code/config)
 * 2. Checking tool calls against protected systems before execution
 * 3. Requiring enhanced approval for self-modifying proposals
 * 4. Blocking autonomous execution from modifying protected systems
 */
export class SelfModificationFirewall {
	private readonly cwd: string;
	private readonly isAutonomous: boolean;
	private readonly protectedSystems: ProtectedSystem[];

	constructor(config: SelfModificationFirewallConfig) {
		this.cwd = config.cwd;
		this.isAutonomous = config.isAutonomous;
		this.protectedSystems = [...BUILT_IN_PROTECTED_SYSTEMS, ...(config.customProtectedSystems ?? [])];
	}

	/**
	 * Get all declared protected systems.
	 */
	getProtectedSystems(): readonly ProtectedSystem[] {
		return this.protectedSystems;
	}

	/**
	 * Check if a file path is protected by the firewall.
	 *
	 * Resolves the given path relative to cwd and checks it against all
	 * protected system patterns.
	 *
	 * @param filePath - File path to check (relative or absolute)
	 * @returns Check result with protection status, system match, and action requirements
	 */
	checkFilePath(filePath: string): SelfModificationCheckResult {
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.cwd, filePath);
		const relativePath = path.relative(this.cwd, absolutePath);

		// Normalize to forward slashes for pattern matching
		const normalized = relativePath.split(path.sep).join("/");

		for (const system of this.protectedSystems) {
			for (const pattern of system.patterns) {
				if (this.matchesPattern(normalized, pattern)) {
					return {
						isProtected: true,
						matchedSystem: system,
						reason: `"${relativePath}" is part of "${system.name}". ${system.reason}`,
						blocked: this.isAutonomous,
						requiresEnhancedApproval: !this.isAutonomous,
					};
				}
			}
		}

		return {
			isProtected: false,
			reason: "",
			blocked: false,
			requiresEnhancedApproval: false,
		};
	}

	/**
	 * Check tool arguments for any protected file targets.
	 *
	 * Examines tool call arguments (for write, edit tools) and reports
	 * any self-modification attempts.
	 *
	 * @param toolName - Name of the tool being called
	 * @param args - Tool call arguments
	 * @returns Self-modification report
	 */
	checkToolCall(toolName: string, args: Record<string, unknown>): SelfModificationReport {
		const protectedPaths: string[] = [];
		const affectedSystems: ProtectedSystem[] = [];

		// Extract file paths from tool arguments
		const pathsToCheck = this.extractPathsFromArgs(toolName, args);

		for (const filePath of pathsToCheck) {
			const result = this.checkFilePath(filePath);
			if (result.isProtected) {
				protectedPaths.push(filePath);
				if (result.matchedSystem && !affectedSystems.includes(result.matchedSystem)) {
					affectedSystems.push(result.matchedSystem);
				}
			}
		}

		if (protectedPaths.length === 0) {
			return {
				hasSelfModification: false,
				protectedPaths: [],
				affectedSystems: [],
				summary: "",
				anyBlocked: false,
			};
		}

		const systemNames = affectedSystems.map((s) => `"${s.name}"`).join(", ");
		const summary =
			`Self-modification detected: attempts to modify ${protectedPaths.length} file(s) in protected system(s) ${systemNames}. ` +
			(this.isAutonomous
				? "Blocked: autonomous execution cannot modify protected systems."
				: "Enhanced approval required before modifying protected systems.");

		return {
			hasSelfModification: true,
			protectedPaths,
			affectedSystems,
			summary,
			anyBlocked: this.isAutonomous,
		};
	}

	/**
	 * Check a workspace for self-modification.
	 *
	 * Examines a workspace's capabilities manifest to see if it plans
	 * to modify any protected files.
	 *
	 * @param workspace - The workspace to check
	 * @returns Self-modification report
	 */
	checkWorkspace(workspace: Workspace): SelfModificationReport {
		const protectedPaths: string[] = [];
		const affectedSystems: ProtectedSystem[] = [];

		// Check canEdit paths
		if (workspace.capabilities?.canEdit) {
			for (const editPath of workspace.capabilities.canEdit) {
				const result = this.checkFilePath(editPath);
				if (result.isProtected) {
					protectedPaths.push(editPath);
					if (result.matchedSystem && !affectedSystems.includes(result.matchedSystem)) {
						affectedSystems.push(result.matchedSystem);
					}
				}
			}
		}

		if (protectedPaths.length === 0) {
			return {
				hasSelfModification: false,
				protectedPaths: [],
				affectedSystems: [],
				summary: "",
				anyBlocked: false,
			};
		}

		const systemNames = affectedSystems.map((s) => `"${s.name}"`).join(", ");
		const summary =
			`Self-modifying workspace "${workspace.title}": targets ${protectedPaths.length} file(s) in protected system(s) ${systemNames}. ` +
			"Enhanced approval required.";

		return {
			hasSelfModification: true,
			protectedPaths,
			affectedSystems,
			summary,
			anyBlocked: false,
		};
	}

	/**
	 * Check a workspace queue for self-modification.
	 *
	 * Examines all workspaces in the queue for self-modification.
	 *
	 * @param workspaces - Array of workspaces to check
	 * @returns Self-modification report aggregated across all workspaces
	 */
	checkWorkspaces(workspaces: Workspace[]): SelfModificationReport {
		const allProtectedPaths: string[] = [];
		const allAffectedSystems: ProtectedSystem[] = [];
		const systemSet = new Set<string>();

		for (const workspace of workspaces) {
			const report = this.checkWorkspace(workspace);
			if (report.hasSelfModification) {
				allProtectedPaths.push(...report.protectedPaths);
				for (const sys of report.affectedSystems) {
					if (!systemSet.has(sys.id)) {
						systemSet.add(sys.id);
						allAffectedSystems.push(sys);
					}
				}
			}
		}

		if (allProtectedPaths.length === 0) {
			return {
				hasSelfModification: false,
				protectedPaths: [],
				affectedSystems: [],
				summary: "",
				anyBlocked: false,
			};
		}

		const systemNames = allAffectedSystems.map((s) => `"${s.name}"`).join(", ");
		const summary =
			`Self-modification detected across ${allProtectedPaths.length} file(s) in protected system(s) ${systemNames}. ` +
			"Enhanced approval required before execution.";

		return {
			hasSelfModification: true,
			protectedPaths: allProtectedPaths,
			affectedSystems: allAffectedSystems,
			summary,
			anyBlocked: false,
		};
	}

	/**
	 * Check if file paths in a list are protected.
	 *
	 * @param filePaths - Array of file paths to check
	 * @returns Self-modification report
	 */
	checkFilePaths(filePaths: string[]): SelfModificationReport {
		const protectedPaths: string[] = [];
		const affectedSystems: ProtectedSystem[] = [];
		const systemSet = new Set<string>();

		for (const filePath of filePaths) {
			const result = this.checkFilePath(filePath);
			if (result.isProtected) {
				protectedPaths.push(filePath);
				if (result.matchedSystem && !systemSet.has(result.matchedSystem.id)) {
					systemSet.add(result.matchedSystem.id);
					affectedSystems.push(result.matchedSystem);
				}
			}
		}

		if (protectedPaths.length === 0) {
			return {
				hasSelfModification: false,
				protectedPaths: [],
				affectedSystems: [],
				summary: "",
				anyBlocked: false,
			};
		}

		const systemNames = affectedSystems.map((s) => `"${s.name}"`).join(", ");
		const summary =
			`Self-modification detected: ${protectedPaths.length} file(s) in protected system(s) ${systemNames}. ` +
			(this.isAutonomous
				? "Blocked: autonomous execution cannot modify protected systems."
				: "Enhanced approval required.");

		return {
			hasSelfModification: true,
			protectedPaths,
			affectedSystems,
			summary,
			anyBlocked: this.isAutonomous,
		};
	}

	/**
	 * Format a self-modification report into a human-readable string.
	 *
	 * @param report - The report to format
	 * @returns Human-readable summary
	 */
	formatReport(report: SelfModificationReport): string {
		if (!report.hasSelfModification) {
			return "";
		}

		const lines: string[] = [
			"=== Self-Modification Firewall ===",
			"",
			report.summary,
			"",
			"Affected protected systems:",
		];

		for (const system of report.affectedSystems) {
			lines.push(`  - ${system.name}: ${system.reason}`);
		}

		lines.push("");
		lines.push("Protected paths:");

		for (const filePath of report.protectedPaths) {
			lines.push(`  - ${filePath}`);
		}

		if (this.isAutonomous) {
			lines.push("");
			lines.push("ACTION: MODIFICATION BLOCKED. Autonomous execution cannot modify protected systems.");
		} else {
			lines.push("");
			lines.push("ACTION: Enhanced approval required. The user must explicitly confirm this modification.");
		}

		return lines.join("\n");
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Extract file path arguments from tool call parameters.
	 */
	private extractPathsFromArgs(toolName: string, args: Record<string, unknown>): string[] {
		const paths: string[] = [];

		switch (toolName) {
			case "write":
			case "read":
				if (typeof args.path === "string") {
					paths.push(args.path);
				}
				if (typeof args.file_path === "string") {
					paths.push(args.file_path);
				}
				break;

			case "edit":
				if (typeof args.path === "string") {
					paths.push(args.path);
				}
				if (typeof args.file_path === "string") {
					paths.push(args.file_path);
				}
				break;

			case "bash":
				// Bash commands may contain file paths indirectly;
				// we don't try to parse them here since bash commands
				// are already checked by the safety profile system.
				break;
		}

		return paths;
	}

	/**
	 * Match a normalized file path against a glob-like pattern.
	 *
	 * Supports:
	 * - recursive wildcards (double-asterisk-slash for directory prefix)
	 * - single-segment wildcards (single asterisk)
	 * - recursive directory prefixes
	 */
	private matchesPattern(normalizedPath: string, pattern: string): boolean {
		// Convert glob pattern to regex
		let regexStr = "^";
		let i = 0;

		while (i < pattern.length) {
			const ch = pattern[i];

			if (ch === "*" && i + 1 < pattern.length && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
				// **/ - matches zero or more directory segments
				regexStr += "(?:.+/)?";
				i += 3;
			} else if (ch === "*" && pattern[i + 1] === "*" && i + 2 < pattern.length && pattern[i + 2] !== "/") {
				// ** without trailing slash - match everything including slashes
				regexStr += ".*";
				i += 2;
			} else if (ch === "*" && pattern[i + 1] === "*" && i + 1 === pattern.length - 1) {
				// ** at end - match everything
				regexStr += ".*";
				i += 2;
			} else if (ch === "*") {
				// * - matches anything except /
				regexStr += "[^/]*";
				i += 1;
			} else if (ch === "?") {
				regexStr += "[^/]";
				i += 1;
			} else if (ch === ".") {
				regexStr += "\\.";
				i += 1;
			} else {
				// Literal character
				regexStr += ch;
				i += 1;
			}
		}

		regexStr += "$";

		try {
			const regex = new RegExp(regexStr);
			return regex.test(normalizedPath);
		} catch {
			// If pattern is invalid, fall back to simple comparison
			return normalizedPath === pattern || normalizedPath.startsWith(pattern);
		}
	}
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a self-modification firewall instance.
 *
 * @param cwd - Working directory for resolving relative paths
 * @param isAutonomous - Whether the agent is in autonomous mode
 * @param customProtectedSystems - Additional user-defined protected systems
 * @returns SelfModificationFirewall instance
 */
export function createSelfModificationFirewall(
	cwd: string,
	isAutonomous: boolean = false,
	customProtectedSystems?: ProtectedSystem[],
): SelfModificationFirewall {
	return new SelfModificationFirewall({ cwd, isAutonomous, customProtectedSystems });
}
