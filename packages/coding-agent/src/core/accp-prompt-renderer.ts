/**
 * ACCP Prompt Renderer
 *
 * Renders compact ACCP prompt contracts into system prompt sections.
 * This is the bridge between the template registry and coding-agent
 * prompt injection.
 *
 * ## Anti-Pattern Prevention (AP-P49-004)
 *
 * This renderer produces compact prompt contracts — NOT full ACCP
 * specification prose. Full spec text would blow token budgets.
 *
 * @packageDocumentation
 */
import { defaultTemplateRegistry } from "@earendil-works/pi-accp-compiler";

export type AccpMode = "off" | "warn" | "required";

/**
 * Render an ACCP prompt contract for injection into a system prompt.
 *
 * @param contractId - The contract ID (e.g. "bsr", "tvr", "repair").
 * @param mode - Current ACCP mode.
 * @returns Rendered prompt text segment, or empty string if ACCP is off.
 */
export function renderAccpPrompt(contractId: string, mode: AccpMode): string {
	if (mode === "off") return "";

	const contract = defaultTemplateRegistry.get(contractId);
	if (!contract) {
		return `[ACCP] No template found for contract: ${contractId}. ACCP mode: ${mode}.`;
	}

	const modeLine =
		mode === "required"
			? "ACCP mode is REQUIRED — gates will block on failure."
			: "ACCP mode is WARN — diagnostics are surfaced but non-blocking.";

	return `[ACCP Prompt Contract: ${contractId}]\n${modeLine}\n\n${contract.template}`;
}

/**
 * Render a fallback ACCP output template for when no task envelope exists.
 *
 * Used when accpMode is required/warn but accpTaskEnvelope.targetReportTypes
 * is missing. Provides a concrete ACCP-YAML schema so the agent knows the
 * exact format to produce, preventing plain-text fallback.
 *
 * @param mode - Current ACCP mode.
 * @returns Rendered fallback prompt text segment.
 */
export function renderAccpFallbackTemplate(mode: AccpMode): string {
	const modeLine =
		mode === "required"
			? "ACCP output is REQUIRED. Plain text final output is FORBIDDEN."
			: "ACCP output is recommended. Output ACCP-YAML when possible.";

	const failClosedLine =
		mode === "required"
			? "\nIf the final assistant message does not contain valid ACCP-YAML the response will be REJECTED (HOLD/FAIL)."
			: "";

	return [
		"[ACCP Required Output Contract]",
		modeLine,
		"",
		"You MUST produce a valid ACCP-YAML block in your final assistant message.",
		"The YAML block MUST include these markers:",
		'  accp_version: "2.0.0"',
		'  source_format: "ACCP-YAML"',
		"  report_type: <one of: RIR, IPR, TVR, PRR, ECR, BRR, RCA, BSR, FPR>",
		"  report_id: <unique identifier for this report>",
		"",
		"Minimum schema:",
		"  report:",
		"    id: <report_id>",
		"    title: <short description>",
		"    status: <test|analysis|implemented|passed|blocked>",
		"  evidence:",
		"    - id: <unique evidence id>",
		"      kind: <analysis|observation|result>",
		"      claim: <what this evidence demonstrates>",
		"",
		"OUTPUT RULES:",
		"- The top-level MUST be ACCP-YAML (not Markdown, not JSON, not plain text).",
		"- You MAY wrap the YAML in ```yaml code blocks.",
		"- You MAY include natural language explanation BEFORE the YAML block.",
		"- The LAST text block in your assistant message MUST be the ACCP-YAML (or a ```yaml block containing it).",
		"- No Markdown prose after the YAML block.",
		"- If you cannot produce a full report, provide a minimal valid block with status 'blocked' and explain why.",
		"- Missing or invalid ACCP-YAML causes a HOLD/FAIL verdict.",
		failClosedLine,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Render the ACCP mode directive for injection into system prompts.
 *
 * @param mode - Current ACCP mode.
 * @returns ACCP mode directive text, or empty string if ACCP is off.
 */
export function renderAccpModeDirective(mode: AccpMode): string {
	if (mode === "off") return "";

	return [
		"[ACCP Mode]",
		`ACCP mode: ${mode}`,
		mode === "required"
			? "ACCP gates are active. All output must be valid ACCP-YAML. Gate-blocking findings will prevent workspace completion."
			: "ACCP diagnostics are collected but non-blocking. Output ACCP-YAML when possible.",
		"Route signals from compiled reports are advisory. They do not authorize execution.",
		"Rendered Markdown is human-preview-only. Do not parse it for authority decisions.",
	].join("\n");
}
