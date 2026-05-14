/**
 * Plan Parser + JSON Queue - P2 Workstream 7.A
 *
 * Parses Master Template v2 plans and extracts workspace queues.
 * Supports Part 3 JSON queue (primary) and Markdown heading fallback.
 */

import type { TokenRole } from "@earendil-works/pi-agent-core";
import type {
	ParallelismReview,
	PlanExecutionConfig,
	PlanExecutionScale,
	PlanExecutionValidation,
	Workspace,
	WorkspaceQueue,
} from "./workspace-schema.js";
import { isAcceptedSchemaVersion, validateWorkspaceQueue } from "./workspace-schema.js";

/**
 * Source of the parsed workspace queue metadata.
 */
export type ParsedSource = "part3_json" | "markdown_fallback";

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
	/** P4.6.2: Which source provided the queue metadata. */
	parsedSource: ParsedSource;
	/** P4.6.2: Count of workstream headings in Part 1 markdown, or null. */
	markdownWorkstreamCount: number | null;
	/** P4.6.2: Markdown workstream labels without corresponding JSON workspace entry. */
	missingWorkspaceLabels: string[];
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
	/** P4.6.2: Fail instead of warn on workstream/workspace count mismatch. Default: false. */
	failOnWorkspaceCountMismatch?: boolean;
}

// ---------------------------------------------------------------------------
// Markdown workstream heading extraction (P4.6.2)
// ---------------------------------------------------------------------------

/**
 * Result of scanning Part 1 markdown for workstream headings.
 */
interface MarkdownWorkstreamScan {
	/** Number of workstream headings found */
	count: number;
	/** Labels extracted from headings (e.g., ["A", "B", ..., "N"]) */
	labels: string[];
}

/**
 * Scan Part 1 markdown for workstream headings.
 *
 * Supports heading patterns like:
 * - ### 7.A — Title
 * - ### 19.A — Title
 * - ### Workstream A — Title
 *
 * @param planContent - Full plan content
 * @returns Scan result with count and labels
 */
export function scanMarkdownWorkstreamHeadings(planContent: string): MarkdownWorkstreamScan {
	const labels: string[] = [];

	// Try to find a workstreams section (## 7. Workstreams, ## N. Workstreams, etc.)
	const workstreamSectionMatch = planContent.match(/## [0-9]+[. ]*Workstreams?([\s\S]*?)(?=\n## [0-9]+[. ]|$)/im);

	const sectionContent = workstreamSectionMatch ? (workstreamSectionMatch[1] ?? "") : "";

	// If no section found, scan whole content as fallback
	const searchContent = sectionContent || planContent;

	// Pattern: "### X.Y[Z] — Title" — extract the letter after the dot
	const headingPattern = /### [0-9]+[.]([A-Z])[^\n]*—/g;
	let match: RegExpExecArray | null = headingPattern.exec(searchContent);

	while (match !== null) {
		const label = match[1];
		if (label && !labels.includes(label)) {
			labels.push(label);
		}
		match = headingPattern.exec(searchContent);
	}

	// If no ## N.Workstreams section was found and no labels yet, try "Workstream A" format
	if (labels.length === 0) {
		const workstreamNamedPattern = /### Workstream ([A-Z])[—\s]/gi;
		match = workstreamNamedPattern.exec(searchContent);
		while (match !== null) {
			const label = match[1];
			if (label && !labels.includes(label)) {
				labels.push(label);
			}
			match = workstreamNamedPattern.exec(searchContent);
		}
	}

	return { count: labels.length, labels };
}

/**
 * Compare markdown workstream labels to workspace IDs and find missing ones.
 *
 * @param markdownLabels - Labels from markdown headings (e.g., ["A", "B", "C"])
 * @param workspaceIds - Workspace IDs from queue (e.g., ["7.A", "7.B", "19.C"])
 * @returns Array of missing labels that have no corresponding workspace
 */
export function findMissingWorkspaceLabels(markdownLabels: string[], workspaceIds: string[]): string[] {
	// Extract the letter suffix from workspace IDs (e.g., "7.A" -> "A", "19.N" -> "N")
	const workspaceLetters = new Set<string>();
	for (const id of workspaceIds) {
		const letterMatch = id.match(/[.]([A-Z])$/);
		if (letterMatch) {
			workspaceLetters.add(letterMatch[1]);
		}
	}

	// Find markdown labels that don't have a matching workspace entry
	return markdownLabels.filter((label) => !workspaceLetters.has(label));
}

/**
 * Parse Master Template v2 plan
 *
 * Primary: Extracts Part 3 JSON queue from plan
 * Fallback: Parses Markdown headings if JSON not found
 *
 * P4.6.2: Always tracks parsedSource and performs workstream count
 * consistency checks between Part 1 markdown and Part 3 JSON.
 *
 * @param planContent - Plan file content
 * @param options - Parse options
 * @returns Parse result
 */
export function parsePlan(planContent: string, options: ParseOptions = {}): ParseResult {
	const {
		allowPlaceholders = false,
		validate = true,
		markdownFallback = true,
		failOnWorkspaceCountMismatch = false,
	} = options;

	const errors: string[] = [];
	const warnings: string[] = [];
	const unresolvedPlaceholders: string[] = [];

	// P4.6.2: Always scan markdown workstream headings (even when Part 3 JSON is primary)
	const markdownScan = scanMarkdownWorkstreamHeadings(planContent);

	// Try to extract Part 3 JSON queue
	const jsonQueue = extractJsonQueue(planContent);

	let queue: WorkspaceQueue | undefined;
	let parsedSource: ParsedSource = "markdown_fallback";

	if (jsonQueue) {
		// Parse JSON queue
		try {
			const parsed = JSON.parse(jsonQueue);
			queue = normalizeQueue(parsed);
			parsedSource = "part3_json";
		} catch (error) {
			errors.push(`Failed to parse JSON queue: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	if (!queue && markdownFallback) {
		// Fallback to Markdown heading parser
		warnings.push("Part 3 JSON queue not found, using Markdown heading fallback");
		const markdownResult = parseMarkdownHeadings(planContent);
		if (markdownResult.queue) {
			queue = markdownResult.queue;
			parsedSource = "markdown_fallback";
			// JSON parse error becomes a warning since markdown resolved the queue
			const jsonErrorIdx = errors.findIndex((e) => e.includes("Failed to parse JSON queue"));
			if (jsonErrorIdx >= 0) {
				warnings.push(errors.splice(jsonErrorIdx, 1)[0]);
			}
		} else {
			errors.push(...markdownResult.errors);
		}
	} else if (!queue && !markdownFallback) {
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

	// P4.6.2: Workspace count consistency check
	let missingWorkspaceLabels: string[] = [];
	if (queue && markdownScan.count > 0) {
		const jsonWorkspaceCount = queue.workspaces.length;

		if (markdownScan.count !== jsonWorkspaceCount) {
			const mismatchMsg =
				`Part 1 defines ${markdownScan.count} workstream(s) but Part 3 JSON defines ${jsonWorkspaceCount} executable workspace(s). ` +
				`Pi will execute only the ${jsonWorkspaceCount} JSON workspace(s).`;

			if (failOnWorkspaceCountMismatch) {
				errors.push(mismatchMsg);
			} else {
				warnings.push(mismatchMsg);
			}
		}

		// Check for missing workspace label mappings
		missingWorkspaceLabels = findMissingWorkspaceLabels(
			markdownScan.labels,
			queue.workspaces.map((w) => w.id),
		);

		if (missingWorkspaceLabels.length > 0) {
			warnings.push(`Markdown workstream(s) without JSON workspace entry: ${missingWorkspaceLabels.join(", ")}`);
		}
	}

	// Validate queue
	if (queue && validate) {
		// v2.2.0+: Early contract version check for clear error messages
		if (queue.contractVersion && !isAcceptedSchemaVersion(queue.contractVersion)) {
			errors.push(
				`Contract version ${queue.contractVersion} is not supported. Accepted versions: 2.0.0, 2.1.0, 2.2.0, 2.3.0`,
			);
		}

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
		parsedSource,
		markdownWorkstreamCount: markdownScan.count > 0 ? markdownScan.count : null,
		missingWorkspaceLabels,
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
		retryPolicy: w.retryPolicy,
		riskLevel: w.riskLevel,
		capabilities:
			w.capabilities || w.capabilityManifest
				? (() => {
						const src = w.capabilities || w.capabilityManifest;
						return {
							canEdit: Array.isArray(src.canEdit) ? src.canEdit : [],
							cannotEdit: Array.isArray(src.cannotEdit) ? src.cannotEdit : [],
							canRun: Array.isArray(src.canRun) ? src.canRun : [],
							cannotRun: Array.isArray(src.cannotRun) ? src.cannotRun : [],
						};
					})()
				: undefined,
		acceptanceCriteria: Array.isArray(w.acceptanceCriteria) ? w.acceptanceCriteria : undefined,
		targetCommand: w.targetCommand,
		metadata: w.metadata,
		// v2.2.0: parallelGroup
		parallelGroup: typeof w.parallelGroup === "string" ? w.parallelGroup : undefined,

		// v2.2.0: dependencyReason
		dependencyReason:
			w.dependencyReason && typeof w.dependencyReason === "object" && !Array.isArray(w.dependencyReason)
				? (w.dependencyReason as Record<string, string>)
				: undefined,
	}));

	// P4.6.2: Use phase and title from Part 3 JSON as-is when present.
	// Only fall back to defaults when the field is missing/empty.
	// This ensures "19" and "V6.2 Mode-Routed Scalp Expansion" are preserved.
	const phase = typeof parsed.phase === "string" && parsed.phase.trim() !== "" ? parsed.phase.trim() : "P2";
	const title =
		typeof parsed.title === "string" && parsed.title.trim() !== "" ? parsed.title.trim() : "Untitled Phase";

	// v2.2.0: contractVersion
	const contractVersion: string | undefined =
		typeof parsed.contractVersion === "string" ? parsed.contractVersion : undefined;

	// v2.2.0: planExecution
	// v2.3.0: Adds scale, worktree, integrationQueue, validation
	let planExecution: PlanExecutionConfig | undefined;
	if (parsed.planExecution && typeof parsed.planExecution === "object" && !Array.isArray(parsed.planExecution)) {
		const pe = parsed.planExecution;

		// v2.3.0: scale
		let scale: PlanExecutionScale | undefined;
		if (pe.scale && typeof pe.scale === "object" && !Array.isArray(pe.scale)) {
			const mode = pe.scale.selectedMode;
			if (mode === "standard" || mode === "experimental_6") {
				scale = { selectedMode: mode };
			}
		}

		// v2.3.0: worktree
		let worktree: { enabled: boolean } | undefined;
		if (pe.worktree && typeof pe.worktree === "object" && !Array.isArray(pe.worktree)) {
			if (typeof pe.worktree.enabled === "boolean") {
				worktree = { enabled: pe.worktree.enabled };
			}
		}

		// v2.3.0: integrationQueue
		let integrationQueue: { enabled: boolean } | undefined;
		if (pe.integrationQueue && typeof pe.integrationQueue === "object" && !Array.isArray(pe.integrationQueue)) {
			if (typeof pe.integrationQueue.enabled === "boolean") {
				integrationQueue = { enabled: pe.integrationQueue.enabled };
			}
		}

		// v2.3.0: validation
		let validation: PlanExecutionValidation | undefined;
		if (pe.validation && typeof pe.validation === "object" && !Array.isArray(pe.validation)) {
			validation = {
				globalValidationLockRequired:
					typeof pe.validation.globalValidationLockRequired === "boolean"
						? pe.validation.globalValidationLockRequired
						: undefined,
			};
		}

		planExecution = {
			interactiveParallelismReview:
				typeof pe.interactiveParallelismReview === "boolean" ? pe.interactiveParallelismReview : undefined,
			scale,
			worktree,
			integrationQueue,
			validation,
		};
	}

	// v2.2.0: parallelismReview
	let parallelismReview: ParallelismReview | undefined;
	if (
		parsed.parallelismReview &&
		typeof parsed.parallelismReview === "object" &&
		!Array.isArray(parsed.parallelismReview)
	) {
		const pr = parsed.parallelismReview;
		if (typeof pr.enabled === "boolean") {
			parallelismReview = {
				enabled: pr.enabled,
				threshold: typeof pr.threshold === "number" ? pr.threshold : pr.threshold === null ? null : undefined,
				description: typeof pr.description === "string" ? pr.description : undefined,
				metadata:
					pr.metadata && typeof pr.metadata === "object" && !Array.isArray(pr.metadata)
						? (pr.metadata as Record<string, unknown>)
						: undefined,
			};
		}
	}

	return {
		phase,
		title,
		maxParallelWorkspaces: typeof parsed.maxParallelWorkspaces === "number" ? parsed.maxParallelWorkspaces : 3,
		workspaces,
		contractVersion,
		planExecution,
		parallelismReview,
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
			parsedSource: "markdown_fallback",
			markdownWorkstreamCount: null,
			missingWorkspaceLabels: [],
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
			lines.push(`  Source: ${result.parsedSource}`);
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
