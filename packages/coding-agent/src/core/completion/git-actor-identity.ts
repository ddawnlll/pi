/**
 * P44.5.07 — Git Actor Identity
 *
 * Provides deterministic per-workspace git identity for commits.
 *
 * Identity format:
 * - user.name: "Pi Agent <workspaceId>"
 * - user.email: "pi-agent+<planId>.<workspaceId>@local.invalid"
 *
 * Contract Schema: 4.1.1
 */

// ---------------------------------------------------------------------------
// GitActorIdentity
// ---------------------------------------------------------------------------

/**
 * Per-workspace git identity for commit authorship.
 */
export interface GitActorIdentity {
	/** user.name for git commit */
	userName: string;
	/** user.email for git commit */
	userEmail: string;
	/** Plan identifier */
	planId: string;
	/** Workspace identifier */
	workspaceId: string;
}

/**
 * Options for constructing a git actor identity.
 */
export interface GitActorIdentityOptions {
	/** Agent identifier (defaults to "pi-agent") */
	agentId?: string;
	/** Agent role (defaults to "repo_agent") */
	agentRole?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_ID = "pi-agent";
const _DEFAULT_AGENT_ROLE = "repo_agent";
const EMAIL_DOMAIN = "local.invalid";

/**
 * Create a GitActorIdentity for a workspace.
 *
 * @param planId - Plan identifier
 * @param workspaceId - Workspace identifier
 * @param options - Optional overrides
 * @returns GitActorIdentity
 */
export function createGitActorIdentity(
	planId: string,
	workspaceId: string,
	options?: GitActorIdentityOptions,
): GitActorIdentity {
	const agentId = options?.agentId ?? DEFAULT_AGENT_ID;
	const workspaceSafe = workspaceId.replace(/[^a-zA-Z0-9.]+/g, ".");
	const planSafe = planId.replace(/[^a-zA-Z0-9.]+/g, ".");

	return {
		userName: `Pi Agent ${workspaceSafe}`,
		userEmail: `${agentId}+${planSafe}.${workspaceSafe}@${EMAIL_DOMAIN}`,
		planId,
		workspaceId,
	};
}

/**
 * Format the git config arguments for a commit.
 * Returns `["-c", "user.name=...", "-c", "user.email=..."]`
 */
export function formatGitIdentityArgs(identity: GitActorIdentity): string[] {
	return ["-c", `user.name=${identity.userName}`, "-c", `user.email=${identity.userEmail}`];
}
