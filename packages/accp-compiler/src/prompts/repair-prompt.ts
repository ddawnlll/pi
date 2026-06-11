/**
 * ACCP Repair Prompt Contract (P49.25)
 *
 * Repair prompt template for canonicalization workflow.
 *
 * CRITICAL: The repair loop may only canonicalize structure.
 * It must never invent evidence, fabricate command results,
 * or remove blocking findings.
 *
 * @packageDocumentation
 */

/**
 * Get the repair prompt contract text.
 */
export function getRepairPrompt(): string {
	return `You are normalizing an ACCP report.

CONSTRAINTS:
- You may fix structural issues (indentation, missing required fields)
- You may NOT: invent evidence, fabricate command results, manufacture passing verdicts
- You may NOT: remove blocking findings
- If a report has fatal errors, record them — do not hide them
- If evidence is missing, record it as missing — do not invent it

AUTHORITY:
This is a canonicalization pass. It does not generate new evidence.`;
}
