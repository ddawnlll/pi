/**
 * ACCP Source Extractor V2
 *
 * Deterministic tolerant extraction of exactly one ACCP YAML document from
 * assistant/source text. Supports raw YAML, markdown-fenced YAML, prose-wrapped
 * YAML, leading whitespace/BOM/CRLF, and fails closed on missing, multiple,
 * ambiguous, or invalid ACCP documents.
 *
 * ## Design
 *
 * - Input normalization is deterministic (BOM, CRLF, leading/trailing whitespace).
 * - Extraction produces exactly zero or one candidate ACCP document.
 * - Multiple candidates always fail closed.
 * - Fenced extraction emits a warning, never a fatal error.
 * - Prose-wrapped raw YAML emits a warning.
 * - Raw YAML with only normalization emits an info diagnostic.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";
import { parseAllDocuments } from "yaml";

/** Extraction result with optional metadata. */
export interface AccpExtractionResult {
	yaml: string | null;
	diagnostics: AccpDiagnostic[];
	metadata?: {
		mode: "raw" | "fenced" | "prose_wrapped";
		fenced: boolean;
		proseWrapped: boolean;
		startLine: number;
		endLine: number;
		sourceHash: string;
	};
}

/** Normalize input text before extraction. */
function normalizeInput(text: string): { normalized: string; hadBom: boolean; hadCrLf: boolean } {
	let normalized = text;
	let hadBom = false;
	let hadCrLf = false;

	// Strip UTF-8 BOM
	if (normalized.charCodeAt(0) === 0xfeff) {
		normalized = normalized.slice(1);
		hadBom = true;
	}

	// Normalize CRLF to LF
	if (normalized.includes("\r\n")) {
		normalized = normalized.replace(/\r\n/g, "\n");
		hadCrLf = true;
	}

	// Remove standalone carriage returns
	if (normalized.includes("\r")) {
		normalized = normalized.replace(/\r/g, "\n");
	}

	return { normalized, hadBom, hadCrLf };
}

/** Compute a stable SHA-256 hash for source text. */
function computeSourceHash(text: string): string {
	return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** Check whether a parsed YAML object looks like an ACCP document. */
function isAccpDocumentShape(obj: unknown): obj is Record<string, unknown> {
	if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
	const map = obj as Record<string, unknown>;
	const hasVersion =
		map.accp_version === "2.0.0" ||
		String(map.accp_version ?? "")
			.replace(/"/g, "")
			.trim() === "2.0.0";
	const hasFormat =
		map.source_format === "ACCP-YAML" ||
		String(map.source_format ?? "")
			.replace(/"/g, "")
			.trim() === "ACCP-YAML";
	return hasVersion && hasFormat;
}

/** Try to parse a YAML string as a single document using yaml package. */
function tryParseSingleYaml(source: string): { value: unknown | null; error?: string; multiDoc?: boolean } {
	try {
		const docs = parseAllDocuments(source);
		if (docs.length > 1) {
			return { value: null, multiDoc: true };
		}
		if (docs.length === 0) {
			return { value: null, error: "Empty YAML document" };
		}
		const doc = docs[0];
		if (doc.errors && doc.errors.length > 0) {
			return { value: null, error: doc.errors[0].message };
		}
		return { value: doc.toJS() };
	} catch (err) {
		return { value: null, error: err instanceof Error ? err.message : String(err) };
	}
}

/** Find all fenced code blocks that may contain ACCP YAML. */
function findFencedCandidates(
	text: string,
): Array<{ content: string; startLine: number; endLine: number; hasLang: boolean }> {
	const candidates: Array<{ content: string; startLine: number; endLine: number; hasLang: boolean }> = [];
	const lines = text.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		const fenceMatch = line.match(/^\s*```+(?:ya?ml|accp)?\s*$/i);
		if (fenceMatch) {
			const startLine = i + 1;
			const hasLang = /^\s*```+\s*(?:ya?ml|accp)\s*$/i.test(line);
			let j = i + 1;
			while (j < lines.length && !/^\s*```+\s*$/.test(lines[j])) {
				j++;
			}
			const content = lines.slice(i + 1, j).join("\n");
			const endLine = j + 1;
			candidates.push({ content, startLine, endLine, hasLang });
			i = j + 1;
			continue;
		}
		i++;
	}

	return candidates;
}

/** Find fenced code block line ranges. */
function findFenceRanges(text: string): Array<{ start: number; end: number }> {
	const lines = text.split("\n");
	const ranges: Array<{ start: number; end: number }> = [];
	let i = 0;

	while (i < lines.length) {
		if (/^\s*```+/.test(lines[i])) {
			const start = i;
			let j = i + 1;
			while (j < lines.length && !/^\s*```+/.test(lines[j])) {
				j++;
			}
			const end = j < lines.length ? j : lines.length - 1;
			ranges.push({ start, end });
			i = j + 1;
			continue;
		}
		i++;
	}

	return ranges;
}

/** Check if a line index is inside any fenced code block. */
function isInsideFence(lineIndex: number, fenceRanges: Array<{ start: number; end: number }>): boolean {
	return fenceRanges.some((range) => lineIndex > range.start && lineIndex < range.end);
}

/** Find raw ACCP document candidates (lines starting with accp_version, outside fences). */
function findRawCandidates(text: string): Array<{ content: string; startLine: number; endLine: number }> {
	const lines = text.split("\n");
	const candidates: Array<{ content: string; startLine: number; endLine: number }> = [];
	const fenceRanges = findFenceRanges(text);

	for (let i = 0; i < lines.length; i++) {
		if (isInsideFence(i, fenceRanges)) continue;
		const trimmed = lines[i].trim();
		if (trimmed.startsWith("accp_version:")) {
			const startLine = i + 1;
			const content = lines.slice(i).join("\n");
			candidates.push({ content, startLine, endLine: lines.length });
		}
	}

	return candidates;
}

/**
 * Extract an ACCP YAML document from a block of text.
 *
 * @param text - Raw text that may contain ACCP YAML.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Extracted YAML, diagnostics, and extraction metadata.
 */
export function extractAccpYaml(text: string, sourcePath?: string): AccpExtractionResult {
	const diagnostics: AccpDiagnostic[] = [];

	if (!text || text.trim().length === 0) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_NO_DOCUMENT",
					message: "Empty input — no ACCP YAML document found",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	const { normalized, hadBom, hadCrLf } = normalizeInput(text);

	// Reject XML-like wrappers early
	const trimmedForXml = normalized.trim();
	if (trimmedForXml.startsWith("<") && !normalized.includes("accp_version:")) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_NO_DOCUMENT",
					message: "XML-like wrapper detected — ACCP-YAML source is required, not XML",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	const sourceHash = computeSourceHash(normalized);

	// Collect fenced candidates that parse as valid ACCP documents
	const fencedCandidates: Array<{
		content: string;
		startLine: number;
		endLine: number;
		hasLang: boolean;
		parsed: unknown;
	}> = [];

	for (const fence of findFencedCandidates(normalized)) {
		const parseResult = tryParseSingleYaml(fence.content);
		if (parseResult.value !== null && isAccpDocumentShape(parseResult.value)) {
			fencedCandidates.push({ ...fence, parsed: parseResult.value });
		}
	}

	// Collect raw candidates that parse as valid ACCP documents
	const rawCandidates: Array<{
		content: string;
		startLine: number;
		endLine: number;
		parsed: unknown;
		trimmedProse: boolean;
	}> = [];
	let rawAccpVersionFound = false;
	let rawParseError: string | undefined;

	const rawAccpVersionLines = findRawCandidates(normalized);
	if (rawAccpVersionLines.length > 1) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_MULTIPLE_DOCUMENTS",
					message: `Multiple raw ACCP documents detected (${rawAccpVersionLines.length})`,
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	for (const raw of rawAccpVersionLines) {
		rawAccpVersionFound = true;
		const parseResult = tryParseSingleYaml(raw.content);
		if (parseResult.error) {
			rawParseError = parseResult.error;
		}
		if (parseResult.value !== null && isAccpDocumentShape(parseResult.value)) {
			rawCandidates.push({
				...raw,
				content: raw.content,
				parsed: parseResult.value,
				trimmedProse: false,
			});
		}
	}

	// If we have fenced candidates, prefer them over raw candidates when unambiguous.
	// If both fenced and raw candidates exist, that indicates multiple documents.
	let chosen: {
		content: string;
		startLine: number;
		endLine: number;
		mode: "raw" | "fenced" | "prose_wrapped";
		fenced: boolean;
		proseWrapped: boolean;
	} | null = null;

	if (fencedCandidates.length > 0 && rawCandidates.length > 0) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_MULTIPLE_DOCUMENTS",
					message: "Multiple ACCP documents detected (fenced and raw)",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	if (fencedCandidates.length > 1) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_MULTIPLE_DOCUMENTS",
					message: `Multiple fenced ACCP documents detected (${fencedCandidates.length})`,
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	if (rawCandidates.length > 1) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_MULTIPLE_DOCUMENTS",
					message: `Multiple raw ACCP documents detected (${rawCandidates.length})`,
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	if (fencedCandidates.length === 1) {
		const fence = fencedCandidates[0];
		const startLine = fence.startLine;
		const endLine = fence.endLine;
		const proseWrapped = startLine > 1 || endLine < normalized.split("\n").length;
		chosen = {
			content: fence.content,
			startLine,
			endLine,
			mode: proseWrapped ? "prose_wrapped" : "fenced",
			fenced: true,
			proseWrapped,
		};
	} else if (rawCandidates.length === 1) {
		const raw = rawCandidates[0];
		const startLine = raw.startLine;
		const endLine = startLine + raw.content.split("\n").length - 1;
		const proseWrapped = startLine > 1 || raw.trimmedProse || endLine < normalized.split("\n").length;
		chosen = {
			content: raw.content,
			startLine,
			endLine,
			mode: proseWrapped ? "prose_wrapped" : "raw",
			fenced: false,
			proseWrapped,
		};
	}

	if (!chosen) {
		if (rawAccpVersionFound && rawParseError) {
			return {
				yaml: null,
				diagnostics: [
					{
						code: "ACCP_PARSE_YAML_INVALID",
						message: `ACCP YAML found but could not be parsed: ${rawParseError}`,
						severity: "error",
						fatal: true,
						sourcePath,
					},
				],
			};
		}
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_NO_DOCUMENT",
					message:
						"No ACCP YAML document found in text. Content must contain an ACCP-YAML document starting with accp_version.",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	// Build diagnostics for extraction mode.
	if (hadBom || hadCrLf) {
		diagnostics.push({
			code: "ACCP_EXTRACT_RAW_YAML",
			message: `Input normalized (${hadBom ? "BOM" : ""}${hadBom && hadCrLf ? ", " : ""}${hadCrLf ? "CRLF" : ""}) before extraction`,
			severity: "info",
			fatal: false,
			sourcePath,
		});
	}

	if (chosen.fenced) {
		diagnostics.push({
			code: "ACCP_EXTRACT_FENCED_YAML",
			message:
				"ACCP YAML was extracted from a markdown code fence. Provide native ACCP-YAML source directly for best results.",
			severity: "warning",
			fatal: false,
			sourcePath,
		});
	}

	if (chosen.proseWrapped) {
		diagnostics.push({
			code: "ACCP_EXTRACT_PROSE_WRAPPED_YAML",
			message:
				"ACCP YAML was surrounded by prose or trailing text. Provide native ACCP-YAML source directly for best results.",
			severity: "warning",
			fatal: false,
			sourcePath,
		});
	}

	if (!chosen.fenced && !chosen.proseWrapped && !hadBom && !hadCrLf) {
		diagnostics.push({
			code: "ACCP_EXTRACT_RAW_YAML",
			message: "ACCP YAML extracted as raw source",
			severity: "info",
			fatal: false,
			sourcePath,
		});
	}

	return {
		yaml: chosen.content,
		diagnostics,
		metadata: {
			mode: chosen.mode,
			fenced: chosen.fenced,
			proseWrapped: chosen.proseWrapped,
			startLine: chosen.startLine,
			endLine: chosen.endLine,
			sourceHash,
		},
	};
}
