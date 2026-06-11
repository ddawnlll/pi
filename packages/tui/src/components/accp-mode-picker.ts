/**
 * ACCP Mode Picker Component (P49.22)
 *
 * Renders an ACCP mode selection picker in the TUI.
 * Tab key opens this picker. User selects initial mode,
 * which produces an InitialRouteIndicator.
 *
 * @packageDocumentation
 */

import type { AccpMode } from "@earendil-works/pi-execution-contracts";

/** Available ACCP modes with labels. */
export const ACCP_MODE_OPTIONS: Array<{ value: AccpMode; label: string; description: string }> = [
	{ value: "off", label: "Off", description: "ACCP is disabled — no compilation, no gating" },
	{ value: "warn", label: "Warn", description: "ACCP diagnostics are collected but non-blocking" },
	{
		value: "required",
		label: "Required",
		description: "ACCP gates block on failure — mode must be explicitly enabled",
	},
];

/** Result from the ACCP mode picker. */
export interface AccpModePickerResult {
	selectedMode: AccpMode;
	initialAction: string;
}

/**
 * Render the ACCP mode picker options as a simple list.
 */
export function renderAccpModePicker(): string {
	const lines: string[] = [
		"╔══════════════════════════════════════════╗",
		"║         ACCP Mode Selection              ║",
		"╠══════════════════════════════════════════╣",
		"║                                          ║",
	];

	for (let i = 0; i < ACCP_MODE_OPTIONS.length; i++) {
		const opt = ACCP_MODE_OPTIONS[i];
		const num = i + 1;
		lines.push(`║  ${num}. ${opt.label.padEnd(8)} — ${opt.description.padEnd(30)} ║`);
	}

	lines.push("║                                          ║");
	lines.push("║  Enter 1-3 to select, Esc to cancel      ║");
	lines.push("╚══════════════════════════════════════════╝");

	return lines.join("\n");
}

/**
 * Select an ACCP mode by index (1-based).
 */
export function selectAccpMode(index: number): AccpModePickerResult | null {
	if (index < 1 || index > ACCP_MODE_OPTIONS.length) return null;

	const selected = ACCP_MODE_OPTIONS[index - 1];
	return {
		selectedMode: selected.value,
		initialAction: selected.label,
	};
}
