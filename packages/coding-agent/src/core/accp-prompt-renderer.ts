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
