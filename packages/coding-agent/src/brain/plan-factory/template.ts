/**
 * Master Template Integration — P17.B
 *
 * Loads, parses, populates, and validates the LLM Implementation Agent
 * master template v2.5.1 for plan generation.
 *
 * Works by reading the template file, identifying required segments with
 * {{ placeholders }}, and populating them with phase-specific data.
 */

import { readFile } from "node:fs/promises";
import type { PlanExecutionContract, ValidationResult2, WorkstreamDef } from "../plan-factory/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RequiredSegment {
	id: string;
	name: string;
	required: boolean;
	order: number;
	template: string;
	placeholders: string[];
}

export interface ParsedTemplate {
	version: string;
	segments: RequiredSegment[];
	contractSchema: Record<string, unknown>;
	raw: string;
}

export interface TemplateData {
	phase: { id: string; title: string; purpose: string };
	workstreams: WorkstreamDef[];
	dependencies: Array<{ from: string; to: string; type: "blocking" | "informational" }>;
	batches: string[][];
	riskRegister: Array<{ risk: string; likelihood: string; impact: string; mitigation: string }>;
	rollback: { triggerConditions: string[]; procedure: string[] };
	nextPhase: { id: string; title: string };
	hardRequirements: string[];
	executionPolicies: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Default template path resolution
// ---------------------------------------------------------------------------

function findDefaultTemplatePath(): string {
	// Search common locations
	const candidates = [
		"docs/llm-implementation-agent-master-template.md",
		"docs/templates/llm-implementation-agent-master-template.md",
		".pi/templates/master-template.md",
	];
	// Return the first that looks plausible; caller handles missing file
	return candidates[0];
}

// ---------------------------------------------------------------------------
// Required segments for v2.5.1
// ---------------------------------------------------------------------------

const REQUIRED_SEGMENTS_V2_5_1: Omit<RequiredSegment, "template">[] = [
	{
		id: "tldr",
		name: "TL;DR / Compact Mental Model",
		required: true,
		order: 0,
		placeholders: ["phase", "title", "goal"],
	},
	{ id: "header", name: "Header", required: true, order: 1, placeholders: ["phase", "title", "status", "mode"] },
	{ id: "raci", name: "RACI", required: true, order: 2, placeholders: [] },
	{ id: "purpose", name: "Purpose", required: true, order: 3, placeholders: ["phase", "description"] },
	{ id: "carried-over", name: "What Carried Over", required: true, order: 4, placeholders: [] },
	{ id: "background", name: "Background / What Was Wrong", required: true, order: 5, placeholders: [] },
	{ id: "failures", name: "Current Failure State / Known Blockers", required: true, order: 6, placeholders: [] },
	{ id: "risk", name: "Risk Register", required: true, order: 7, placeholders: [] },
	{ id: "workstreams", name: "Workstreams", required: true, order: 8, placeholders: ["workstreams"] },
	{ id: "order", name: "Combined Implementation Order", required: true, order: 9, placeholders: ["batches"] },
	{ id: "done", name: "Definition of Done", required: true, order: 10, placeholders: ["criteria"] },
	{ id: "rollback", name: "Rollback Playbook", required: true, order: 11, placeholders: ["conditions", "procedure"] },
	{ id: "next", name: "What Next Phase Inherits", required: true, order: 12, placeholders: ["nextPhase"] },
];

// ---------------------------------------------------------------------------
// MasterTemplateIntegration
// ---------------------------------------------------------------------------

export class MasterTemplateIntegration {
	private templatePath: string;
	private parsedCache: Map<string, ParsedTemplate> = new Map();

	constructor(templatePath?: string) {
		this.templatePath = templatePath ?? findDefaultTemplatePath();
	}

	/**
	 * Load and parse a template by version.
	 */
	async loadTemplate(version = "2.5.1"): Promise<ParsedTemplate> {
		const cached = this.parsedCache.get(version);
		if (cached) return cached;

		let raw: string;
		try {
			raw = await readFile(this.templatePath, "utf-8");
		} catch {
			// Template file not found — return a minimal template with just the required segments
			raw = this.generateFallbackTemplate(version);
		}

		const parsed = this.parseTemplate(raw);
		this.parsedCache.set(version, parsed);
		return parsed;
	}

	/**
	 * Parse raw template content into structured segments.
	 */
	private parseTemplate(raw: string): ParsedTemplate {
		const version = raw.match(/Template:.*?v?(\d+\.\d+\.\d+)/)?.[1] ?? "2.5.1";
		const segments: RequiredSegment[] = [];

		for (const seg of REQUIRED_SEGMENTS_V2_5_1) {
			// Try to extract the section content from the raw template
			const sectionRegex = new RegExp(
				`##\\s+${escapeRegex(seg.order.toString())}[. ]*${escapeRegex(seg.name)}([\\s\\S]*?)(?=\\n##\\s+\\d+[. ]|$)`,
				"i",
			);
			const match = raw.match(sectionRegex);
			const template = match?.[1]?.trim() ?? `{{${seg.id}:${seg.name}}}`;

			// Find all {{ ... }} placeholders in this section
			const placeholders = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

			segments.push({
				...seg,
				template,
				placeholders: placeholders.length > 0 ? placeholders : seg.placeholders,
			});
		}

		return {
			version,
			segments,
			contractSchema: {},
			raw,
		};
	}

	/**
	 * Populate a single segment with provided data.
	 */
	populateSegment(segment: RequiredSegment, data: TemplateData, phaseId: string, phaseTitle: string): string {
		let content = segment.template;

		const replacements: Record<string, string> = {
			phase: phaseId,
			title: phaseTitle,
			phaseId,
			phaseTitle,
			goal: data.phase.purpose,
			description: data.phase.purpose,
			status: "Authoritative Implementation",
			mode: "experimental_6",
			workstreams: data.workstreams
				.map(
					(ws) =>
						`### ${ws.id} — ${ws.title}\n\n**Goal:** ${ws.goal}\n\n${ws.acceptanceCriteria.map((ac) => `* [ ] ${ac}`).join("\n")}`,
				)
				.join("\n\n"),
			batches: data.batches.map((batch, i) => `**Batch ${i + 1}:** ${batch.join(", ")}`).join("\n"),
			criteria: data.workstreams
				.flatMap((ws) => ws.acceptanceCriteria)
				.map((c) => `* [ ] ${c}`)
				.join("\n"),
			conditions: data.rollback.triggerConditions.join(", "),
			procedure: data.rollback.procedure.map((p) => `* ${p}`).join("\n"),
			nextPhase: `${data.nextPhase.id} — ${data.nextPhase.title}`,
		};

		for (const [key, value] of Object.entries(replacements)) {
			content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
		}

		// Remove any remaining unfilled placeholders
		content = content.replace(/\{\{\w+\}\}/g, "");

		return content;
	}

	/**
	 * Populate the full template with data for a phase.
	 */
	populateFullTemplate(parsed: ParsedTemplate, data: TemplateData, phaseId: string, phaseTitle: string): string {
		const parts: string[] = [];

		for (const segment of parsed.segments) {
			if (segment.required) {
				parts.push(`## ${segment.order}. ${segment.name}`);
				parts.push("");
				parts.push(this.populateSegment(segment, data, phaseId, phaseTitle));
				parts.push("");
			}
		}

		return parts.join("\n");
	}

	/**
	 * Generate a JSON execution contract from populated template data.
	 */
	generateContract(
		_populated: string,
		phase: { id: string; title: string; workstreams: WorkstreamDef[]; dependencies: unknown[]; batches: string[][] },
	): PlanExecutionContract {
		return {
			contractVersion: "2.5.1",
			phase: { id: phase.id, title: phase.title },
			workstreams: phase.workstreams,
			dependencies: phase.dependencies as Array<{ from: string; to: string; type: "blocking" | "informational" }>,
			batches: phase.batches,
			scaleMode: "experimental_6",
			integrationQueue: true,
			worktreeIsolation: true,
			metadata: {},
		};
	}

	/**
	 * Validate populated output has all required segments.
	 */
	validatePopulated(content: string): ValidationResult2[] {
		const results: ValidationResult2[] = [];

		for (const seg of REQUIRED_SEGMENTS_V2_5_1) {
			const sectionRegex = new RegExp(`##\\s+${seg.order}[. ]+${escapeRegex(seg.name)}`, "i");
			if (!sectionRegex.test(content)) {
				results.push({
					type: "error",
					component: "markdown",
					message: `Missing required segment: ${seg.name}`,
				});
			} else {
				results.push({
					type: "info",
					component: "markdown",
					message: `Segment present: ${seg.name}`,
				});
			}
		}

		return results;
	}

	/**
	 * Validate a generated contract.
	 */
	validateContract(contract: PlanExecutionContract): ValidationResult2[] {
		const results: ValidationResult2[] = [];

		if (!contract.contractVersion) {
			results.push({ type: "error", component: "contract", message: "Missing contractVersion" });
		}
		if (!contract.phase?.id) {
			results.push({ type: "error", component: "contract", message: "Missing phase.id" });
		}
		if (!contract.workstreams?.length) {
			results.push({ type: "error", component: "contract", message: "No workstreams defined" });
		}
		if (!contract.batches?.length) {
			results.push({ type: "error", component: "contract", message: "No batches defined" });
		}

		// Validate no duplicate workstream IDs
		const ids = new Set<string>();
		for (const ws of contract.workstreams) {
			if (ids.has(ws.id)) {
				results.push({ type: "error", component: "workstream", message: `Duplicate workstream ID: ${ws.id}` });
			}
			ids.add(ws.id);
		}

		return results;
	}

	/**
	 * Check all required segments are present.
	 */
	checkAllRequiredSegmentsPresent(populated: string, _version = "2.5.1"): boolean {
		for (const seg of REQUIRED_SEGMENTS_V2_5_1) {
			const sectionRegex = new RegExp(`##\\s+${seg.order}[. ]+${escapeRegex(seg.name)}`, "i");
			if (!sectionRegex.test(populated)) return false;
		}
		return true;
	}

	getSupportedVersions(): string[] {
		return ["2.5.1"];
	}

	isVersionSupported(version: string): boolean {
		return version === "2.5.1";
	}

	clearCache(): void {
		this.parsedCache.clear();
	}

	/**
	 * Generate a fallback template when the template file doesn't exist.
	 */
	/** @internal exposed for testing */
	public generateFallbackTemplate(version: string): string {
		const lines: string[] = [];
		lines.push(`# Template v${version} — Fallback`);
		lines.push("");
		for (const seg of REQUIRED_SEGMENTS_V2_5_1) {
			lines.push(`## ${seg.order}. ${seg.name}`);
			lines.push("");
			lines.push(`{{${seg.id}}}`);
			lines.push("");
		}
		return lines.join("\n");
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
