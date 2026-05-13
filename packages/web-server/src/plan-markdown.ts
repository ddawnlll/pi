/**
 * Living Plan Markdown - Plan execution status in .pi/plans/{planExecId}.md
 *
 * Clones the original plan file at execution start and keeps it updated
 * with workspace status comments and a terminal status header block.
 *
 * All writes are atomic: content is written to a .tmp file first, then renamed.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Events for updating the living plan markdown.
 */
export type PlanMarkdownEvent =
	| {
			type: "workspace-complete";
			workspaceId: string;
			attempts: number;
	  }
	| {
			type: "workspace-failed";
			workspaceId: string;
			attempts: number;
	  }
	| {
			type: "workspace-blocked";
			workspaceId: string;
			attempts: number;
	  }
	| { type: "plan-complete" }
	| { type: "plan-failed" };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const WORKSPACE_STATUS_LABELS: Record<string, string> = {
	"workspace-complete": "complete",
	"workspace-failed": "failed",
	"workspace-blocked": "blocked",
};

/**
 * Escape regex special characters.
 */
function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

/**
 * Write content atomically: write to a .tmp file, then rename to target.
 */
async function atomicWrite(piDir: string, planExecId: string, content: string): Promise<void> {
	const plansDir = join(piDir, "plans");
	await mkdir(plansDir, { recursive: true });
	const targetPath = join(plansDir, `${planExecId}.md`);
	const tmpPath = join(plansDir, `${planExecId}.md.tmp`);
	await writeFile(tmpPath, content, "utf-8");
	await rename(tmpPath, targetPath);
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

/**
 * Format the status header block.
 */
function formatHeader(
	planExecId: string,
	startedAt: string,
	status: "running" | "complete" | "failed",
	completedAt?: string,
): string {
	const lines = [
		"<!-- Pi Execution Status",
		`planExecId: ${planExecId}`,
		`startedAt: ${startedAt}`,
		`status: ${status}`,
	];
	if (completedAt) {
		lines.push(`completedAt: ${completedAt}`);
	}
	lines.push("-->");
	return lines.join("\n");
}

/**
 * Parse the header block to extract field values.
 */
function parseHeader(headerBlock: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of headerBlock.split("\n")) {
		const match = line.match(/^(\w+): (.+)$/);
		if (match) {
			fields[match[1]] = match[2];
		}
	}
	return fields;
}

/**
 * Replace the status header block in the content with an updated one.
 * If no existing header block is found, prepends one.
 */
function replaceHeader(
	content: string,
	planExecId: string,
	newStatus: "running" | "complete" | "failed",
	newCompletedAt?: string,
): string {
	// Try to find an existing header block
	const headerBlockRegex = /^<!-- Pi Execution Status\n[\s\S]*?-->/m;
	const match = content.match(headerBlockRegex);

	if (match) {
		const existing = parseHeader(match[0]);
		const startedAt = existing.startedAt || new Date().toISOString();
		const newHeader = formatHeader(planExecId, startedAt, newStatus, newCompletedAt);
		return content.replace(match[0], newHeader);
	}

	// No existing header — prepend one (shouldn't happen normally)
	const startedAt = new Date().toISOString();
	const newHeader = formatHeader(planExecId, startedAt, newStatus, newCompletedAt);
	return `${newHeader}\n\n${content}`;
}

// ---------------------------------------------------------------------------
// Workspace comment helpers
// ---------------------------------------------------------------------------

/**
 * Append a workspace status comment after the workspace's section heading.
 *
 * Finds a heading like "### 4.B — Title" or "### 4.B Title"
 * and inserts the comment on the next line.
 */
function appendWorkspaceComment(
	content: string,
	workspaceId: string,
	status: string,
	attempts: number,
	timestamp: string,
): string {
	const comment = `<!-- workspace:${workspaceId} status:${status} completedAt:${timestamp} attempts:${attempts} -->`;

	// Match workspace section headings
	const escaped = escapeRegex(workspaceId);
	// Patterns: ### 4.B — Title, ### 4.B - Title, ### 4.B Title, ### 4.B
	const pattern = new RegExp(`^(###\\s+${escaped}(?:\\s+[—–-]\\s+.*|\\s+.*)?)$`, "m");
	const headingMatch = content.match(pattern);

	if (headingMatch) {
		const headingLine = headingMatch[1];
		const insertPos = content.indexOf(headingLine) + headingLine.length;
		return `${content.slice(0, insertPos)}\n${comment}${content.slice(insertPos)}`;
	}

	// Fallback: check for just the workspace ID as a line
	// e.g. "4.B — Title" at any heading level or plain text
	const fallbackPattern = new RegExp(`^#*\\s*${escaped}\\b.*$`, "m");
	const fallbackMatch = content.match(fallbackPattern);
	if (fallbackMatch) {
		const line = fallbackMatch[0];
		const insertPos = content.indexOf(line) + line.length;
		return `${content.slice(0, insertPos)}\n${comment}${content.slice(insertPos)}`;
	}

	// Last resort: append at the very end of the file
	return `${content}\n${comment}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the living plan markdown file.
 *
 * Clones the original plan content into `.pi/plans/{planExecId}.md`
 * with a status header block injected at the top. The original plan
 * file is never modified.
 *
 * @param piDir - Path to the .pi directory
 * @param planExecId - Plan execution ID
 * @param planContent - Original plan content
 * @param title - Plan title
 * @param startedAt - ISO timestamp of execution start
 */
export async function initializePlanMarkdown(
	piDir: string,
	planExecId: string,
	planContent: string,
	_startedAt?: string,
): Promise<void> {
	const startedAt = _startedAt || new Date().toISOString();
	const header = formatHeader(planExecId, startedAt, "running");
	const content = `${header}\n\n${planContent}`;
	await atomicWrite(piDir, planExecId, content);
}

/**
 * Update the living plan markdown file based on an event.
 *
 * - Workspace events: appends a status comment after the workspace section heading.
 * - Plan events: updates the header block with terminal status and completedAt.
 *
 * This function is safe to call multiple times. If the file doesn't exist yet
 * it silently returns.
 *
 * @param piDir - Path to the .pi directory
 * @param planExecId - Plan execution ID
 * @param event - Update event
 */
export async function updatePlanMarkdown(piDir: string, planExecId: string, event: PlanMarkdownEvent): Promise<void> {
	const filePath = join(piDir, "plans", `${planExecId}.md`);

	let content: string;
	try {
		content = await readFile(filePath, "utf-8");
	} catch {
		// File doesn't exist yet — nothing to update
		return;
	}

	let updated: string;

	switch (event.type) {
		case "workspace-complete":
		case "workspace-failed":
		case "workspace-blocked": {
			const status = WORKSPACE_STATUS_LABELS[event.type];
			const now = new Date().toISOString();
			updated = appendWorkspaceComment(content, event.workspaceId, status, event.attempts, now);
			break;
		}
		case "plan-complete": {
			const now = new Date().toISOString();
			updated = replaceHeader(content, planExecId, "complete", now);
			break;
		}
		case "plan-failed": {
			const now = new Date().toISOString();
			updated = replaceHeader(content, planExecId, "failed", now);
			break;
		}
	}

	if (updated !== content) {
		await atomicWrite(piDir, planExecId, updated);
	}
}
