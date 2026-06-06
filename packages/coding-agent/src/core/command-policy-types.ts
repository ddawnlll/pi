/**
 * Command Policy Types — ACCP 1.2 / PlanSpec v5
 */

export type CommandPolicyDecisionCode =
	| "allow"
	| "deny"
	| "allow_with_evidence"
	| "requires_grant"
	| "requires_human_approval";

export interface CommandPolicyDecision {
	decision: CommandPolicyDecisionCode;
	/** The evaluated command */
	command?: string;
	/** The working directory */
	cwd?: string;
	reason: string;
	blockCode?: string;
	/** Which policy layer made the decision */
	policyLayer?: "hard_deny" | "exact_allowed" | "command_class" | "controlled_delete" | "runtime_grant" | "watch_mode" | "git_safety" | "self_modification";
	blockedBy?: "firewall" | "git_safety" | "watch_mode" | "controlled_delete" | "exact_allowed" | "default_deny";
	userApprovalRequested?: boolean;
	controlledDeleteInfo?: {
		targetPath: string;
		canonicalPath?: string;
		isRecursive: boolean;
		isGlob?: boolean;
		allowed: boolean;
		matchedForbidden?: string;
		matchedAllowed?: string;
	};
}

export interface CommandPolicyConfig {
	hardDenyPatterns?: string[];
	exactAllowedCommands?: ExactAllowedCommand[];
	forbiddenDeletePaths?: ForbiddenDeletePath[];
	controlledDelete?: ControlledDeletePolicy;
	contextWindowRequired?: boolean;
	autoGrantLowRiskReadOnly?: boolean;
}

export interface ExactAllowedCommand {
	pattern: string;
	command: string;
	description?: string;
	reason: string;
}

export interface ForbiddenDeletePath {
	pattern: string;
	reason: string;
}

export interface ControlledDeletePolicy {
	enabled: boolean;
	/** Paths that are allowed to be deleted (string pattern or AllowedDeletePath) */
	allowedPatterns?: string[];
	/** Paths that are allowed to be deleted (with metadata) */
	allowedPaths?: AllowedDeletePath[];
	/** Paths that are always forbidden (preempts allowed) */
	forbiddenPaths?: ForbiddenDeletePath[];
	/** Whether to request user approval on denied delete (default: false) */
	requestUserApprovalOnDeny?: boolean;
	evidenceRetentionMs?: number;
}

export interface AllowedDeletePath {
	pattern: string;
	description?: string;
	/** Whether recursive delete is allowed for this path */
	allowRecursive?: boolean;
	/** Reason this path is allowed */
	reason?: string;
}

export interface ForbiddenDeletePath {
	pattern: string;
	reason: string;
}

export interface CommandClass {
	id: string;
	label: string;
	prefixPatterns: string[];
	isDiscovery?: boolean;
	canSatisfyValidation?: boolean;
}

export interface CommandEvidence {
	decision: CommandPolicyDecisionCode;
	command: string;
	cwd: string;
	reason: string;
	timestamp: number;
}

export interface RuntimeCommandGrant {
	id: string;
	command: string;
	durationMs: number;
	expiresAt: number;
	reason: string;
	request?: RuntimeCommandGrantRequest;
}

export interface RuntimeCommandGrantRequest {
	command: string;
	durationMs?: number;
	reason?: string;
	risk?: "low" | "medium" | "high";
}

export interface AllowedDeletePath {
	pattern: string;
	description?: string;
}

export const COMMAND_CLASSES: CommandClass[] = [
	{ id: "delete", label: "Delete", prefixPatterns: ["rm", "rmdir"], canSatisfyValidation: false },
	{ id: "git_mutation", label: "Git Mutation", prefixPatterns: ["git commit", "git push", "git reset", "git rebase", "git merge"], canSatisfyValidation: true },
	{ id: "read", label: "Read", prefixPatterns: ["cat", "head", "tail", "less", "more", "grep", "find", "ls"], isDiscovery: true },
	{ id: "discovery", label: "Discovery", prefixPatterns: ["which", "type", "command -v", "npm ls", "pip list", "cargo tree"], isDiscovery: true },
	{ id: "install", label: "Install", prefixPatterns: ["npm install", "pip install", "cargo install", "brew install", "apt-get install"], canSatisfyValidation: false },
	{ id: "watch", label: "Watch", prefixPatterns: ["npm run dev", "npm run watch", "cargo watch", "nodemon", "tsc --watch"], canSatisfyValidation: false },
	{ id: "other", label: "Other", prefixPatterns: [], canSatisfyValidation: false },
];

export const DEFAULT_COMMAND_POLICY_CONFIG: CommandPolicyConfig = {
	hardDenyPatterns: [
		"rm -rf /",
		"rm -rf ~",
		"rm -rf $HOME",
		"sudo rm",
		"mkfs",
		"dd if=",
		"> /dev/sd",
		"chmod -R 000 /",
		"chown -R root:root /",
	],
	exactAllowedCommands: [],
	forbiddenDeletePaths: [],
	controlledDelete: {
		enabled: true,
		allowedPatterns: [],
		allowedPaths: [],
		forbiddenPaths: [],
		requestUserApprovalOnDeny: false,
	},
	contextWindowRequired: false,
	autoGrantLowRiskReadOnly: true,
};

export const DEFAULT_CONTROLLED_DELETE_POLICY: ControlledDeletePolicy = {
	enabled: true,
	allowedPatterns: [],
	allowedPaths: [],
	forbiddenPaths: [],
	requestUserApprovalOnDeny: false,
};

export const HARD_DENY_COMMAND_PATTERNS: string[] = [
	"rm -rf /",
	"rm -rf ~",
	"rm -rf $HOME",
	"sudo rm",
	"mkfs",
	"dd if=",
	"> /dev/sd",
	"chmod -R 000 /",
	"chown -R root:root /",
];
