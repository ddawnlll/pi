/**
 * Plan Parser — extracts metadata from plan file content (NON-AUTHORITATIVE PREVIEW).
 *
 * WARNING: This is a frontend-only preview parser. Plan validity is determined
 * exclusively by the backend compilePlanSpecAlpha2() compiler. Do not treat
 * local parse success as proof of plan validity.
 *
 * Supports Markdown (.md), plain text (.txt), JSON (.json),
 * and YAML (.yml/.yaml) plan files.
 *
 * Handles real-world plan formats:
 *   # Heading — Title
 *   **Key:** Value          (bold markdown)
 *   - Key: Value            (bullet list)
 *   Key: value              (plain)
 *   key: value              (lowercase)
 *   Embedded JSON Part 3    (workspace deps + capabilities)
 *   depends_on: P42, P43    (comma-separated)
 *   dependencies:\n  - P42  (YAML-style list)
 *   plan_id: P42
 */

import type { ParsedPlanDraft, PlanValidationMessage } from "../types";

let _localIdCounter = 0;

function nextLocalId(): string {
	return `plan_${Date.now()}_${++_localIdCounter}`;
}

function msg(
	id: string,
	severity: "pass" | "warning" | "error",
	area: "parse",
	message: string,
	planLocalId?: string,
	evidence?: string,
): PlanValidationMessage {
	return { id, severity, area, message, planLocalId, evidence };
}

// ---------------------------------------------------------------------------
// Regex helpers
// ---------------------------------------------------------------------------

function isYamlListItem(line: string): string | null {
	const m = line.match(/^-\s+(.+)$/);
	return m ? m[1].trim() : null;
}

function extractList(value: string): string[] {
	if (value.includes(",")) {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (value.includes(";")) {
		return value
			.split(";")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return [value.trim()].filter(Boolean);
}

function normalizeValue(v: string): string {
	return v
		.replace(/^`(.*)`$/, "$1")
		.replace(/^"(.*)"$/, "$1")
		.replace(/^\*\*(.*)\*\*$/, "$1")
		.replace(/`/g, "")
		.trim();
}

// ---------------------------------------------------------------------------
// Common key mappings
// ---------------------------------------------------------------------------

type CanonicalKey = "title" | "planId" | "execClass" | "depends" | "allowed" | "forbidden" | "validate" | "report";

const KEY_ALIAS_MAP: Array<{ aliases: string[]; canonical: CanonicalKey }> = [
	{ aliases: ["title", "Title"], canonical: "title" },
	{ aliases: ["plan_id", "planId", "id", "ID", "Plan ID", "Phase", "phase"], canonical: "planId" },
	{ aliases: ["execution_class", "executionClass", "class", "Execution Class", "Execution class"], canonical: "execClass" },
	{ aliases: ["depends_on", "depends-on", "dependsOn", "dependencies", "Dependencies", "Depends On"], canonical: "depends" },
	{ aliases: ["allowed_files", "allowedFiles", "allowed", "Allowed Files", "Allowed files", "Allowed", "canEdit"], canonical: "allowed" },
	{ aliases: ["forbidden_files", "forbiddenFiles", "forbidden", "Forbidden Files", "Forbidden"], canonical: "forbidden" },
	{ aliases: ["validate", "validation", "validation_commands", "validationCommands", "Validation Commands", "Validation commands", "Required Gates", "Required gates", "gates", "Gates"], canonical: "validate" },
	{ aliases: ["report", "report_requirements", "reportRequirements", "Report Requirements", "Report requirements"], canonical: "report" },
];

// ---------------------------------------------------------------------------
// Key matching with bold/bullet stripping
// ---------------------------------------------------------------------------

function stripLine(line: string): string {
	return line
		.replace(/^-\s+/, "")       // remove leading "- "
		.replace(/^\*\*/, "")       // remove leading "**"
		.replace(/\*\*:\s*/, ": ")  // replace "**:" with ":" (asterisks before colon)
		.replace(/:\*\*\s*/, ": ")  // replace ":**" with ":" (colon before asterisks)
		.replace(/\s*\*\*$/, "")    // remove trailing "**"
		.trim();
}

function matchKey(line: string): { canonical: CanonicalKey; value: string } | null {
	const stripped = stripLine(line);

	for (const { aliases, canonical } of KEY_ALIAS_MAP) {
		for (const alias of aliases) {
			const pat = new RegExp(
				`^(?:-\\s+)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*:\\s*(.+)$`,
				"i",
			);
			const m = stripped.match(pat);
			if (m && m[1].trim().length > 0) {
				return { canonical, value: m[1].trim() };
			}
		}
	}
	return null;
}

function matchKeyLine(line: string): CanonicalKey | null {
	const stripped = stripLine(line);

	for (const { aliases, canonical } of KEY_ALIAS_MAP) {
		for (const alias of aliases) {
			const pat = new RegExp(
				`^(?:-\\s+)?(?:\\*\\*)?${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\*\\*)?\\s*:\\s*$`,
				"i",
			);
			if (pat.test(stripped)) {
				return canonical;
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Workspace extraction
// ---------------------------------------------------------------------------

function extractWorkspace(line: string): string | null {
	// "### Workspace A" or "## Phase 1"
	const explicit = line.match(/^#{2,3}\s+(?:Workspace|workspace|Phase|phase)\s+([\w.-]+)/);
	if (explicit) return explicit[1];

	// "### P41.00 — Title" (project-style ID: letter-digit.digit)
	const projMatch = line.match(/^###\s+([A-Z][\w]*\.[\w.-]+?)(?:\s*[—–-].*)?$/);
	if (projMatch) return projMatch[1].trim();

	// "### A." or "### 7.A — Title" (legacy section notation)
	const secMatch = line.match(/^###\s+(\d*[A-Z]\.[\s\S]*?)$/);
	if (secMatch) {
		return secMatch[1].replace(/\s*[—–-].*$/, "").trim();
	}

	return null;
}

// ---------------------------------------------------------------------------
// Embedded Part 3 JSON extraction
// ---------------------------------------------------------------------------

function extractPart3Json(rawText: string): {
	workspaceDeps: Map<string, string[]>;
	workspaceAllowed: Map<string, string[]>;
	workspaceNames: string[];
} {
	const workspaceDeps = new Map<string, string[]>();
	const workspaceAllowed = new Map<string, string[]>();
	const workspaceNames: string[] = [];

	// Find JSON code blocks that contain a "workspaces" array
	const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
	let match: RegExpExecArray | null;

	while ((match = jsonBlockRegex.exec(rawText)) !== null) {
		const block = match[1].trim();
		try {
			const obj = JSON.parse(block);
			if (Array.isArray(obj.workspaces)) {
				for (const ws of obj.workspaces) {
					if (typeof ws.id === "string") {
						workspaceNames.push(ws.id);

						// Dependencies
						if (Array.isArray(ws.dependencies)) {
							workspaceDeps.set(ws.id, ws.dependencies.map(String));
						}

						// Allowed files from capabilities.canEdit
						if (ws.capabilities && Array.isArray(ws.capabilities.canEdit)) {
							workspaceAllowed.set(ws.id, ws.capabilities.canEdit.map(String));
						}
						// Also check direct allowedFiles field
						if (Array.isArray(ws.allowedFiles)) {
							const existing = workspaceAllowed.get(ws.id) ?? [];
							workspaceAllowed.set(ws.id, [...existing, ...ws.allowedFiles.map(String)]);
						}
					}
				}
			}
		} catch {
			// Not valid JSON, skip
		}
	}

	return { workspaceDeps, workspaceAllowed, workspaceNames };
}

// ---------------------------------------------------------------------------
// Title extraction
// ---------------------------------------------------------------------------

function extractTitle(line: string): string | null {
	const m = line.match(/^#{1,3}\s+(.+)$/);
	return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Markdown / plain text parser
// ---------------------------------------------------------------------------

function parseMarkdown(
	rawText: string,
	sourceFileName: string,
	localId: string,
): { fields: Partial<ParsedPlanDraft>; messages: PlanValidationMessage[] } {
	const messages: PlanValidationMessage[] = [];

	// 1. Extract embedded JSON (Part 3) first
	const { workspaceDeps, workspaceAllowed, workspaceNames } = extractPart3Json(rawText);

	// 2. Line-by-line parsing
	const lines = rawText.split("\n");

	let detectedTitle: string | undefined;
	let detectedPlanId: string | undefined;
	let detectedExecutionClass: string | undefined;
	const detectedWorkspaces: string[] = [...workspaceNames]; // Pre-populate from JSON
	const detectedDependencies: string[] = [];
	const detectedAllowedFiles: string[] = [];
	const detectedForbiddenFiles: string[] = [];
	const detectedValidationCommands: string[] = [];
	const detectedReportRequirements: string[] = [];

	// Collect also from Part 3 JSON
	for (const [, deps] of workspaceDeps) {
		for (const d of deps) {
			if (!detectedDependencies.includes(d)) detectedDependencies.push(d);
		}
	}
	for (const [, allowed] of workspaceAllowed) {
		for (const a of allowed) {
			if (!detectedAllowedFiles.includes(a)) detectedAllowedFiles.push(a);
		}
	}

	// Track YAML-style list context
	let activeListKey: CanonicalKey | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// --- Title from heading ---
		if (!detectedTitle && /^#\s+/.test(line)) {
			const t = extractTitle(line);
			if (t) detectedTitle = t;
			continue;
		}

		// --- Workspace markers (line-based, complements JSON) ---
		const ws = extractWorkspace(line);
		if (ws && !detectedWorkspaces.includes(ws)) {
			detectedWorkspaces.push(ws);
			continue;
		}

		// --- Key:Value matching ---
		const kv = matchKey(line);
		if (kv) {
			activeListKey = null;
			const val = normalizeValue(kv.value);

			switch (kv.canonical) {
				case "title":
					if (!detectedTitle) detectedTitle = val;
					break;
				case "planId":
					if (!detectedPlanId) detectedPlanId = val;
					break;
				case "execClass":
					if (!detectedExecutionClass) detectedExecutionClass = val;
					break;
				case "depends":
					for (const d of extractList(val)) {
						if (!detectedDependencies.includes(d)) detectedDependencies.push(d);
					}
					break;
				case "allowed":
					for (const a of extractList(val)) {
						if (!detectedAllowedFiles.includes(a)) detectedAllowedFiles.push(a);
					}
					break;
				case "forbidden":
					for (const f of extractList(val)) {
						if (!detectedForbiddenFiles.includes(f)) detectedForbiddenFiles.push(f);
					}
					break;
				case "validate":
					for (const v of extractList(val)) {
						if (!detectedValidationCommands.includes(v)) detectedValidationCommands.push(v);
					}
					break;
				case "report":
					for (const r of extractList(val)) {
						if (!detectedReportRequirements.includes(r)) detectedReportRequirements.push(r);
					}
					break;
			}
			continue;
		}

		// --- Key: line without value (YAML-style list) ---
		const keyLine = matchKeyLine(line);
		if (keyLine) {
			activeListKey = keyLine;
			continue;
		}

		// --- YAML-style list items ---
		const listItem = isYamlListItem(line);
		if (listItem && activeListKey) {
			const val = normalizeValue(listItem);
			switch (activeListKey) {
				case "depends":
					if (!detectedDependencies.includes(val)) detectedDependencies.push(val);
					break;
				case "allowed":
					if (!detectedAllowedFiles.includes(val)) detectedAllowedFiles.push(val);
					break;
				case "forbidden":
					if (!detectedForbiddenFiles.includes(val)) detectedForbiddenFiles.push(val);
					break;
				case "validate":
					if (!detectedValidationCommands.includes(val)) detectedValidationCommands.push(val);
					break;
				case "report":
					if (!detectedReportRequirements.includes(val)) detectedReportRequirements.push(val);
					break;
			}
			continue;
		}

		// Non-empty non-matching line resets list context
		if (line.trim().length > 0) activeListKey = null;

		// --- ACCP references ---
		if (/ACCP|IPR|RIR|PIR|TVR|PRR|HIR/i.test(line)) {
			const refs = line.match(/(?:ACCP|IPR|RIR|PIR|TVR|PRR|HIR)[-\s]*(?:v?\d+(?:\.\d+)?)/gi);
			if (refs) {
				for (const ref of refs) {
					const r = ref.trim();
					if (!detectedReportRequirements.includes(r)) detectedReportRequirements.push(r);
				}
			}
		}
	}

	// If no title from heading, use filename
	if (!detectedTitle) {
		detectedTitle = sourceFileName
			.replace(/\.(md|txt|json|ya?ml)$/i, "")
			.replace(/[-_]/g, " ");
		messages.push(
			msg(`PARSE-${localId}-001`, "warning", "parse", "No title found; using filename", localId),
		);
	}

	return {
		fields: {
			detectedTitle,
			detectedPlanId,
			detectedExecutionClass,
			detectedWorkspaces,
			detectedDependencies,
			detectedAllowedFiles,
			detectedForbiddenFiles,
			detectedValidationCommands,
			detectedReportRequirements,
		},
		messages,
	};
}

// ---------------------------------------------------------------------------
// JSON parser (standalone .json files)
// ---------------------------------------------------------------------------

function parseJson(
	rawText: string,
	sourceFileName: string,
	localId: string,
): { fields: Partial<ParsedPlanDraft>; messages: PlanValidationMessage[] } {
	const messages: PlanValidationMessage[] = [];
	let obj: Record<string, unknown>;

	try {
		obj = JSON.parse(rawText);
	} catch (e) {
		messages.push(msg(`PARSE-${localId}-FATAL`, "error", "parse", `Invalid JSON: ${String(e)}`, localId));
		return { fields: {}, messages };
	}

	const fields: Partial<ParsedPlanDraft> = {};

	if (typeof obj.title === "string") fields.detectedTitle = obj.title;
	if (typeof obj.planId === "string" || typeof obj.id === "string") {
		fields.detectedPlanId = (obj.planId ?? obj.id) as string;
	}
	if (typeof obj.executionClass === "string") fields.detectedExecutionClass = obj.executionClass;
	if (typeof obj.phase === "string" && !fields.detectedPlanId) fields.detectedPlanId = obj.phase as string;

	// Workspaces from JSON
	if (Array.isArray(obj.workspaces)) {
		fields.detectedWorkspaces = obj.workspaces.map((w: any) =>
			typeof w === "string" ? w : w.id ?? String(w),
		);

		// Extract deps and allowed from workspace entries
		for (const ws of obj.workspaces as any[]) {
			if (typeof ws === "object") {
				if (Array.isArray(ws.dependencies)) {
					fields.detectedDependencies = [
						...(fields.detectedDependencies ?? []),
						...ws.dependencies.map(String),
					];
				}
				const caps = ws.capabilities;
				if (caps && Array.isArray(caps.canEdit)) {
					fields.detectedAllowedFiles = [
						...(fields.detectedAllowedFiles ?? []),
						...caps.canEdit.map(String),
					];
				}
			}
		}
	}

	if (Array.isArray(obj.dependencies)) {
		fields.detectedDependencies = [
			...(fields.detectedDependencies ?? []),
			...obj.dependencies.map(String),
		];
	}
	if (Array.isArray(obj.allowedFiles)) fields.detectedAllowedFiles = [...(fields.detectedAllowedFiles ?? []), ...obj.allowedFiles.map(String)];
	if (Array.isArray(obj.forbiddenFiles)) fields.detectedForbiddenFiles = obj.forbiddenFiles.map(String);
	if (Array.isArray(obj.validationCommands)) fields.detectedValidationCommands = obj.validationCommands.map(String);
	if (Array.isArray(obj.reportRequirements)) fields.detectedReportRequirements = obj.reportRequirements.map(String);

	return { fields, messages };
}

// ---------------------------------------------------------------------------
// YAML parser
// ---------------------------------------------------------------------------

function parseYaml(
	rawText: string,
	sourceFileName: string,
	localId: string,
): { fields: Partial<ParsedPlanDraft>; messages: PlanValidationMessage[] } {
	const messages: PlanValidationMessage[] = [];
	const lines = rawText.split("\n");

	const fields: Partial<ParsedPlanDraft> = {};
	let currentKey: CanonicalKey | null = null;

	const addToField = (key: CanonicalKey, val: string) => {
		const arr = (() => {
			switch (key) {
				case "depends": return fields.detectedDependencies ?? (fields.detectedDependencies = []);
				case "allowed": return fields.detectedAllowedFiles ?? (fields.detectedAllowedFiles = []);
				case "forbidden": return fields.detectedForbiddenFiles ?? (fields.detectedForbiddenFiles = []);
				case "validate": return fields.detectedValidationCommands ?? (fields.detectedValidationCommands = []);
				case "report": return fields.detectedReportRequirements ?? (fields.detectedReportRequirements = []);
			}
		})();
		if (arr && !arr.includes(val)) arr.push(val);
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const kv = matchKey(line);
		if (kv) {
			currentKey = kv.canonical;
			const val = normalizeValue(kv.value);

			switch (kv.canonical) {
				case "title": fields.detectedTitle = val; break;
				case "planId": fields.detectedPlanId = val; break;
				case "execClass": fields.detectedExecutionClass = val; break;
				case "depends":
				case "allowed":
				case "forbidden":
				case "validate":
				case "report":
					if (val) {
						for (const v of extractList(val)) addToField(kv.canonical, v);
					}
					break;
			}
			continue;
		}

		// Key: line without value (then list items follow)
		const keyLine = matchKeyLine(line);
		if (keyLine) {
			currentKey = keyLine;
			continue;
		}

		// YAML list items
		const listItem = isYamlListItem(trimmed);
		if (listItem && currentKey) {
			addToField(currentKey, normalizeValue(listItem));
			continue;
		}

		if (trimmed.length > 0) currentKey = null;
	}

	return { fields, messages };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parsePlan(
	rawText: string,
	sourceFileName: string,
): ParsedPlanDraft {
	const localId = nextLocalId();
	const ext = sourceFileName.split(".").pop()?.toLowerCase() ?? "";
	const messages: PlanValidationMessage[] = [];
	let fields: Partial<ParsedPlanDraft> = {};

	if (ext === "json") {
		const result = parseJson(rawText, sourceFileName, localId);
		fields = result.fields;
		messages.push(...result.messages);
	} else if (ext === "yml" || ext === "yaml") {
		const result = parseYaml(rawText, sourceFileName, localId);
		fields = result.fields;
		messages.push(...result.messages);
	} else {
		const result = parseMarkdown(rawText, sourceFileName, localId);
		fields = result.fields;
		messages.push(...result.messages);
	}

	// Deduplicate
	if (fields.detectedDependencies) {
		fields.detectedDependencies = [...new Set(fields.detectedDependencies)];
	}
	if (fields.detectedAllowedFiles) {
		fields.detectedAllowedFiles = [...new Set(fields.detectedAllowedFiles)];
	}
	if (fields.detectedForbiddenFiles) {
		fields.detectedForbiddenFiles = [...new Set(fields.detectedForbiddenFiles)];
	}
	if (fields.detectedValidationCommands) {
		fields.detectedValidationCommands = [...new Set(fields.detectedValidationCommands)];
	}
	if (fields.detectedReportRequirements) {
		fields.detectedReportRequirements = [...new Set(fields.detectedReportRequirements)];
	}
	if (fields.detectedWorkspaces) {
		fields.detectedWorkspaces = [...new Set(fields.detectedWorkspaces)];
	}

	// Determine parse status
	let parseStatus: "ok" | "warning" | "error" = "ok";
	for (const m of messages) {
		if (m.severity === "error") parseStatus = "error";
		else if (m.severity === "warning" && parseStatus === "ok") parseStatus = "warning";
	}

	if (parseStatus === "ok") {
		messages.push(
			msg(`PARSE-${localId}-OK`, "pass", "parse", "Plan parsed successfully", localId),
		);
	}

	return {
		localId,
		sourceFileName,
		rawText,
		detectedPlanId: fields.detectedPlanId,
		detectedTitle: fields.detectedTitle,
		detectedExecutionClass: fields.detectedExecutionClass,
		detectedWorkspaces: fields.detectedWorkspaces ?? [],
		detectedDependencies: fields.detectedDependencies ?? [],
		detectedAllowedFiles: fields.detectedAllowedFiles ?? [],
		detectedForbiddenFiles: fields.detectedForbiddenFiles ?? [],
		detectedValidationCommands: fields.detectedValidationCommands ?? [],
		detectedReportRequirements: fields.detectedReportRequirements ?? [],
		parseStatus,
		parseMessages: messages,
	};
}
