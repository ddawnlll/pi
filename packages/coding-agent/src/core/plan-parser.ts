/**
 * Plan Parser + JSON Queue - P2 Workstream 7.A
 *
 * Parses Master Template v2 plans and extracts workspace queues.
 * Supports Part 3 JSON queue (primary) and Markdown heading fallback.
 */

import type { TokenRole } from "@earendil-works/pi-agent-core";
import type { Workspace, WorkspaceQueue } from "./workspace-schema.js";
import { validateWorkspaceQueue } from "./workspace-schema.js";

/**
 * Parse result
 */
export interface ParseResult {
	/** Whether parsing succeeded */
	success: boolean;
	/** Parsed workspace queue (if successful) */
	queue?: WorkspaceQueue;
	/** Parse errors */
	errors: string[];
	/** Parse warnings */
	warnings: string[];
	/** Unresolved placeholders found */
	unresolvedPlaceholders: string[];
}

/**
 * Parse options
 */
export interface ParseOptions {
	/** Whether to allow unresolved placeholders (default: false) */
	allowPlaceholders?: boolean;
	/** Whether to validate the queue after parsing (default: true) */
	validate?: boolean;
	/** Whether to use Markdown fallback if JSON not found (default: true) */
	markdownFallback?: boolean;
}

/**
 * Parse Master Template v2 plan
 *
 * Primary: Extracts Part 3 JSON queue from plan
 * Fallback: Parses Markdown headings if JSON not found
 *
 * @param planContent - Plan file content
 * @param options - Parse options
 * @returns Parse result
 */
export function parsePlan(planContent: string, options: ParseOptions = {}): ParseResult {
	const { allowPlaceholders = false, validate = true, markdownFallback = true } = options;

	const errors: string[] = [];
	const warnings: string[] = [];
	const unresolvedPlaceholders: string[] = [];

	// Try to extract Part 3 JSON queue
	const jsonQueue = extractJsonQueue(planContent);

	let queue: WorkspaceQueue | undefined;

	if (jsonQueue) {
		// Parse JSON queue
		try {
			const parsed = JSON.parse(jsonQueue);
			queue = normalizeQueue(parsed);
		} catch (error) {
			errors.push(`Failed to parse JSON queue: ${error instanceof Error ? error.message : String(error)}`);
		}
	} else if (markdownFallback) {
		// Fallback to Markdown heading parser
		warnings.push("Part 3 JSON queue not found, using Markdown heading fallback");
		const markdownResult = parseMarkdownHeadings(planContent);
		if (markdownResult.queue) {
			queue = markdownResult.queue;
		} else {
			errors.push(...markdownResult.errors);
		}
	} else {
		errors.push("Part 3 JSON queue not found and Markdown fallback disabled");
	}

	// Check for unresolved placeholders
	if (queue) {
		const placeholders = findUnresolvedPlaceholders(JSON.stringify(queue));
		unresolvedPlaceholders.push(...placeholders);

		if (placeholders.length > 0 && !allowPlaceholders) {
			errors.push(`Found ${placeholders.length} unresolved placeholder(s): ${placeholders.join(", ")}`);
		}
	}

	// Validate queue
	if (queue && validate) {
		const validationResult = validateWorkspaceQueue(queue);
		if (!validationResult.valid) {
			errors.push(...validationResult.errors.map((e) => e.message));
		}
		warnings.push(...validationResult.warnings.map((w) => w.message));
	}

	return {
		success: errors.length === 0 && queue !== undefined,
		queue,
		errors,
		warnings,
		unresolvedPlaceholders,
	};
}

/**
 * Extract Part 3 JSON queue from plan content
 *
 * Looks for JSON code block in Part 3 section.
 *
 * @param planContent - Plan content
 * @returns JSON string or null if not found
 */
function extractJsonQueue(planContent: string): string | null {
	// Look for Part 3 section
	const part3Match = planContent.match(/# Part 3[^\n]*\n([\s\S]*?)(?=\n# Part [4-9]|\n# Part 1[0-9]|$)/i);
	if (!part3Match) {
		return null;
	}

	const part3Content = part3Match[1];

	// Extract JSON code block
	const jsonMatch = part3Content.match(/```json\s*\n([\s\S]*?)\n```/);
	if (!jsonMatch) {
		return null;
	}

	return jsonMatch[1].trim();
}

/**
 * Parse Markdown headings as fallback
 *
 * Extracts workspace information from Markdown headings (e.g., "### 7.A — Title").
 *
 * @param planContent - Plan content
 * @returns Parse result with queue or errors
 */
function parseMarkdownHeadings(planContent: string): { queue?: WorkspaceQueue; errors: string[] } {
	const errors: string[] = [];
	const workspaces: Workspace[] = [];

	// Extract phase and title from header
	const headerMatch = planContent.match(/# Phase (P\d+)[^\n]*\n[^\n]*\n[^\n]*Title[^\n]*:\s*([^\n]+)/i);
	const phase = headerMatch?.[1] || "P2";
	const title = headerMatch?.[2]?.trim() || "Untitled Phase";

	// Find workstream section (Part 1, section 7)
	const workstreamMatch = planContent.match(/## 7\. Workstreams([\s\S]*?)(?=\n## [8-9]\.|$)/i);
	if (!workstreamMatch) {
		errors.push("Could not find workstreams section (## 7. Workstreams)");
		return { errors };
	}

	const workstreamContent = workstreamMatch[1];

	// Parse individual workstreams (### 7.A — Title)
	const workstreamRegex = /### (7\.[A-Z])[^\n]*—\s*([^\n]+)\n([\s\S]*?)(?=\n### 7\.[A-Z]|$)/gi;
	let match: RegExpExecArray | null = workstreamRegex.exec(workstreamContent);

	while (match !== null) {
		const id = match[1];
		const workspaceTitle = match[2].trim();
		const content = match[3];

		// Extract dependencies (look for "Dependencies:" or "Depends on:")
		const depsMatch = content.match(/(?:Dependencies|Depends on):\s*([^\n]+)/i);
		const dependencies: string[] = [];
		if (depsMatch) {
			const depsStr = depsMatch[1];
			// Parse dependencies like "7.A, 7.B" or "None" or "[]"
			if (depsStr && !depsStr.match(/none|^\[\s*\]$/i)) {
				dependencies.push(
					...depsStr
						.split(/[,\s]+/)
						.map((d) => d.trim())
						.filter((d) => d.match(/^7\.[A-Z]$/)),
				);
			}
		}

		// Extract role budget (default to worker)
		const roleMatch = content.match(/(?:Role|Budget):\s*(\w+)/i);
		const roleBudget: TokenRole = (roleMatch?.[1]?.toLowerCase() as TokenRole) || "worker";

		// Extract max retries (default to 3)
		const retriesMatch = content.match(/(?:Max\s*)?Retries:\s*(\d+)/i);
		const maxRetries = retriesMatch ? Number.parseInt(retriesMatch[1], 10) : 3;

		workspaces.push({
			id,
			title: workspaceTitle,
			dependencies,
			roleBudget,
			maxRetries,
		});

		match = workstreamRegex.exec(workstreamContent);
	}

	if (workspaces.length === 0) {
		errors.push("No workspaces found in Markdown headings");
		return { errors };
	}

	return {
		queue: {
			phase,
			title,
			maxParallelWorkspaces: 3, // Default
			workspaces,
		},
		errors: [],
	};
}

/**
 * Normalize parsed queue to canonical format
 *
 * Ensures all required fields are present with defaults.
 *
 * @param parsed - Parsed JSON object
 * @returns Normalized workspace queue
 */
function normalizeQueue(parsed: any): WorkspaceQueue {
	const workspaces: Workspace[] = (parsed.workspaces || []).map((w: any) => ({
		id: w.id || "",
		title: w.title || "",
		dependencies: Array.isArray(w.dependencies) ? w.dependencies : [],
		roleBudget: (w.roleBudget || "worker") as TokenRole,
		maxRetries: typeof w.maxRetries === "number" ? w.maxRetries : 3,
		riskLevel: w.riskLevel,
		capabilities: w.capabilities
			? {
					canEdit: Array.isArray(w.capabilities.canEdit) ? w.capabilities.canEdit : [],
					cannotEdit: Array.isArray(w.capabilities.cannotEdit) ? w.capabilities.cannotEdit : [],
					canRun: Array.isArray(w.capabilities.canRun) ? w.capabilities.canRun : [],
					cannotRun: Array.isArray(w.capabilities.cannotRun) ? w.capabilities.cannotRun : [],
				}
			: undefined,
		acceptanceCriteria: Array.isArray(w.acceptanceCriteria) ? w.acceptanceCriteria : undefined,
		targetCommand: w.targetCommand,
		metadata: w.metadata,
	}));

	return {
		phase: parsed.phase || "P2",
		title: parsed.title || "Untitled Phase",
		maxParallelWorkspaces: typeof parsed.maxParallelWorkspaces === "number" ? parsed.maxParallelWorkspaces : 3,
		workspaces,
	};
}

/**
 * Find unresolved placeholders in content
 *
 * Looks for {{ placeholder }} patterns.
 *
 * @param content - Content to search
 * @returns Array of placeholder names
 */
function findUnresolvedPlaceholders(content: string): string[] {
	const placeholders = new Set<string>();
	const regex = /\{\{\s*([^}]+)\s*\}\}/g;
	let match: RegExpExecArray | null = regex.exec(content);

	while (match !== null) {
		placeholders.add(match[1].trim());
		match = regex.exec(content);
	}

	return Array.from(placeholders);
}

/**
 * Load and parse plan from file
 *
 * @param filePath - Path to plan file
 * @param options - Parse options
 * @returns Parse result
 */
export async function loadPlan(filePath: string, options: ParseOptions = {}): Promise<ParseResult> {
	try {
		const fs = await import("node:fs/promises");
		const content = await fs.readFile(filePath, "utf-8");
		return parsePlan(content, options);
	} catch (error) {
		return {
			success: false,
			errors: [`Failed to load plan file: ${error instanceof Error ? error.message : String(error)}`],
			warnings: [],
			unresolvedPlaceholders: [],
		};
	}
}

/**
 * Format parse result for display
 *
 * @param result - Parse result
 * @returns Formatted string
 */
export function formatParseResult(result: ParseResult): string {
	const lines: string[] = [];

	if (result.success) {
		lines.push("✓ Plan parsed successfully");
		if (result.queue) {
			lines.push(`  Phase: ${result.queue.phase}`);
			lines.push(`  Title: ${result.queue.title}`);
			lines.push(`  Workspaces: ${result.queue.workspaces.length}`);
			lines.push(`  Max Parallel: ${result.queue.maxParallelWorkspaces}`);
		}
	} else {
		lines.push("✗ Plan parsing failed");
	}

	if (result.errors.length > 0) {
		lines.push("");
		lines.push("Errors:");
		for (const error of result.errors) {
			lines.push(`  • ${error}`);
		}
	}

	if (result.warnings.length > 0) {
		lines.push("");
		lines.push("Warnings:");
		for (const warning of result.warnings) {
			lines.push(`  • ${warning}`);
		}
	}

	if (result.unresolvedPlaceholders.length > 0) {
		lines.push("");
		lines.push("Unresolved Placeholders:");
		for (const placeholder of result.unresolvedPlaceholders) {
			lines.push(`  • {{ ${placeholder} }}`);
		}
	}

	return lines.join("\n");
}
