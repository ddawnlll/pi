/**
 * ACCP Source Extractor
 *
 * Extracts ACCP YAML source from worker output.
 * For transitional compatibility, worker output may contain YAML
 * embedded in a larger text response. The extractor finds the
 * YAML document and extracts it. It warns when extraction was needed.
 *
 * ## Extraction Strategy
 *
 * 1. If the text already starts with `accp_version:`, return unchanged.
 * 2. If the text contains an ACCP-YAML block within fenced code blocks
 *    (```yaml ... ```), extract from there.
 * 3. If the text contains `accp_version:` somewhere inline, extract
 *    from that point to the end.
 * 4. Otherwise, return null with a fatal diagnostic.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/**
 * Extract an ACCP YAML document from a block of text.
 *
 * If the text is already pure YAML (starts with accp_version:),
 * returns it unchanged. Otherwise, attempts to find a YAML document
 * starting with `accp_version:`.
 *
 * @param text - Raw text that may contain ACCP YAML.
 * @param sourcePath - Optional source path for diagnostics.
 * @returns Extracted YAML and extraction diagnostics.
 */
export function extractAccpYaml(
	text: string,
	sourcePath?: string,
): {
	yaml: string | null;
	diagnostics: AccpDiagnostic[];
} {
	if (!text || text.trim().length === 0) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_EMPTY",
					message: "Empty input — no YAML to extract",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	const diagnostics: AccpDiagnostic[] = [];
	const trimmed = text.trim();

	// Check for XML-like wrappers (reject early)
	if (trimmed.startsWith("<") && !trimmed.includes("accp_version:")) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_EXTRACT_XML_WRAPPER",
					message: "XML-like wrapper detected — ACCP-YAML source is required, not XML",
					severity: "error",
					fatal: true,
					sourcePath,
				},
			],
		};
	}

	// Case 1: Pure ACCP-YAML (starts with accp_version:)
	if (trimmed.startsWith("accp_version:")) {
		return { yaml: trimmed, diagnostics: [] };
	}

	// Case 2: Fenced code block containing ACCP-YAML
	const yamlFenceRegex = /```ya?ml\s*\n([\s\S]*?)```/g;
	const allFenceMatches: Array<{ content: string; index: number }> = [];
	let fenceMatch: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: cleaner loop pattern
	while ((fenceMatch = yamlFenceRegex.exec(trimmed)) !== null) {
		allFenceMatches.push({
			content: fenceMatch[1].trim(),
			index: fenceMatch.index,
		});
	}

	for (const match of allFenceMatches) {
		if (match.content.startsWith("accp_version:")) {
			diagnostics.push({
				code: "ACCP_EXTRACT_FROM_FENCE",
				message:
					"ACCP YAML was extracted from a code fence block. Provide native ACCP-YAML source directly for best results.",
				severity: "warning",
				fatal: false,
				sourcePath,
			});
			return { yaml: match.content, diagnostics };
		}
	}

	// Case 3: Inline accp_version: somewhere in the text
	const yamlStart = trimmed.indexOf("\naccp_version:");
	if (yamlStart !== -1) {
		const extracted = trimmed.slice(yamlStart + 1).trim();
		diagnostics.push({
			code: "ACCP_EXTRACT_FROM_TEXT",
			message:
				"ACCP YAML was extracted from inline content. Provide native ACCP-YAML source directly for best results.",
			severity: "warning",
			fatal: false,
			sourcePath,
		});
		return { yaml: extracted, diagnostics };
	}

	// Also try from the absolute start
	const absStart = trimmed.indexOf("accp_version:");
	if (absStart !== -1 && absStart !== yamlStart) {
		const extracted = trimmed.slice(absStart).trim();
		diagnostics.push({
			code: "ACCP_EXTRACT_FROM_TEXT",
			message:
				"ACCP YAML was extracted from inline content. Provide native ACCP-YAML source directly for best results.",
			severity: "warning",
			fatal: false,
			sourcePath,
		});
		return { yaml: extracted, diagnostics };
	}

	// Case 4: No YAML found
	return {
		yaml: null,
		diagnostics: [
			{
				code: "ACCP_EXTRACT_NOT_FOUND",
				message: "No ACCP YAML document found in text. Content must start with 'accp_version:'.",
				severity: "error",
				fatal: true,
				sourcePath,
			},
		],
	};
}
