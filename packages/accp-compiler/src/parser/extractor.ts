/**
 * ACCP Source Extractor
 *
 * Extracts ACCP YAML source from worker output.
 * For transitional compatibility, worker output may contain YAML
 * embedded in a larger text response. The extractor finds the
 * YAML document and extracts it. It warns when extraction was needed.
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
 * @returns Extracted YAML and extraction diagnostics.
 */
export function extractAccpYaml(text: string): {
	yaml: string | null;
	diagnostics: AccpDiagnostic[];
} {
	if (!text || text.trim().length === 0) {
		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_PARSE_YAML_INVALID",
					message: "Empty input — no YAML to extract",
					severity: "error",
					fatal: true,
				},
			],
		};
	}

	const diagnostics: AccpDiagnostic[] = [];
	const trimmed = text.trim();

	// If the text already looks like pure ACCP-YAML, return directly
	if (trimmed.startsWith("accp_version:")) {
		return { yaml: trimmed, diagnostics: [] };
	}

	// Try to find a YAML block starting with accp_version:
	// Look for a line starting with "accp_version:" possibly after a YAML front matter marker
	const yamlStart = trimmed.indexOf("accp_version:");
	if (yamlStart === -1) {
		// Try to find YAML within code fences
		const fenceMatch = trimmed.match(/```yaml\n([\s\S]*?)```/);
		if (fenceMatch) {
			const extracted = fenceMatch[1].trim();
			if (extracted.startsWith("accp_version:")) {
				diagnostics.push({
					code: "ACCP_PARSE_YAML_INVALID",
					message: "YAML was extracted from code fence — native ACCP-YAML source is preferred",
					severity: "warning",
					fatal: false,
				});
				return { yaml: extracted, diagnostics };
			}
		}

		return {
			yaml: null,
			diagnostics: [
				{
					code: "ACCP_PARSE_YAML_INVALID",
					message: "No ACCP YAML document found in text",
					severity: "error",
					fatal: true,
				},
			],
		};
	}

	// Extract from the first accp_version: line to the end or to the next top-level key boundary
	const extracted = trimmed.slice(yamlStart).trim();

	diagnostics.push({
		code: "ACCP_PARSE_YAML_INVALID",
		message: "YAML was extracted from non-native source — native ACCP-YAML source is preferred",
		severity: "warning",
		fatal: false,
	});

	return { yaml: extracted, diagnostics };
}
