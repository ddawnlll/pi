/**
 * ACCP Mode Picker Component (P49.22)
 *
 * Interactive TUI overlay component for ACCP mode and initial report type
 * selection. Opened via configurable keybinding (Tab by default when
 * tabModePickerEnabled is true).
 *
 * The picker shows:
 * - ACCP mode (off/warn/required)
 * - Initial report type (from the 24-type ACCP registry)
 * - Mutation policy and route implications for the selection
 *
 * @packageDocumentation
 */

import type { AccpMode, AccpReportType } from "@earendil-works/pi-execution-contracts";
import { getKeybindings } from "../keybindings.js";
import { matchesKey } from "../keys.js";
import { Container } from "../tui.js";

// =============================================================================
// ACCP mode options
// =============================================================================

/** Available ACCP modes with labels and descriptions. */
export const ACCP_MODE_OPTIONS: Array<{
	value: AccpMode;
	label: string;
	description: string;
}> = [
	{
		value: "warn",
		label: "Warn",
		description: "ACCP diagnostics are collected but non-blocking",
	},
	{
		value: "required",
		label: "Required",
		description: "ACCP gates block on failure — ACCP is always enabled",
	},
];

// =============================================================================
// Initial report type options (from accp_v2_0_package/registry/)
// =============================================================================

/** Category of ACCP report type for picker grouping. */
export type AccpReportCategory = "core" | "bugfix" | "feature" | "writing" | "coordination";

/** Entry for the report type picker list. */
export interface AccpReportTypeEntry {
	value: AccpReportType;
	label: string;
	category: AccpReportCategory;
	description: string;
	supportLevel: "known" | "template_available" | "schema_lite" | "schema_strict" | "gate_blocking";
}

/** Full 24-type registry — canonical names from accp_v2_0_package/registry/ */
export const ACCP_REPORT_TYPES: AccpReportTypeEntry[] = [
	// Core (8)
	{
		value: "RIR",
		label: "RIR",
		category: "core",
		description: "Research Intent Report — declares research goals and scope",
		supportLevel: "schema_strict",
	},
	{
		value: "PIR",
		label: "PIR",
		category: "core",
		description: "Plan Intent Report — declares execution plan and authority",
		supportLevel: "schema_strict",
	},
	{
		value: "IPR",
		label: "IPR",
		category: "core",
		description: "Implementation Progress Report — records workspace mutations",
		supportLevel: "schema_strict",
	},
	{
		value: "TVR",
		label: "TVR",
		category: "core",
		description: "Test Verification Report — records test execution evidence",
		supportLevel: "gate_blocking",
	},
	{
		value: "HIR",
		label: "HIR",
		category: "core",
		description: "Handoff Intent Report — declares artifact handoff targets",
		supportLevel: "schema_strict",
	},
	{
		value: "RAR",
		label: "RAR",
		category: "core",
		description: "Risk Assessment Report — identifies and scores risks",
		supportLevel: "schema_strict",
	},
	{
		value: "PRR",
		label: "PRR",
		category: "core",
		description: "Promotion Readiness Report — declares promotion criteria met",
		supportLevel: "gate_blocking",
	},
	{
		value: "CAR",
		label: "CAR",
		category: "core",
		description: "Completion Assertion Report — workspace completion evidence",
		supportLevel: "gate_blocking",
	},
	// Bugfix (5)
	{
		value: "BSR",
		label: "BSR",
		category: "bugfix",
		description: "Bug Scoping Report — identifies and scopes a bug",
		supportLevel: "schema_strict",
	},
	{
		value: "BRR",
		label: "BRR",
		category: "bugfix",
		description: "Bug Repair Report — evidence of bug fix implementation",
		supportLevel: "schema_strict",
	},
	{
		value: "RCA",
		label: "RCA",
		category: "bugfix",
		description: "Root Cause Analysis — identifies root cause of a failure",
		supportLevel: "schema_strict",
	},
	{
		value: "FPR",
		label: "FPR",
		category: "bugfix",
		description: "Fix Patch Report — records applied patch evidence",
		supportLevel: "schema_strict",
	},
	{
		value: "FVR",
		label: "FVR",
		category: "bugfix",
		description: "Fix Verification Report — verifies patch correctness",
		supportLevel: "schema_strict",
	},
	// Feature (5)
	{
		value: "FER",
		label: "FER",
		category: "feature",
		description: "Feature Exploration Report — explores feature design space",
		supportLevel: "template_available",
	},
	{
		value: "FDR",
		label: "FDR",
		category: "feature",
		description: "Feature Design Report — records design decisions",
		supportLevel: "template_available",
	},
	{
		value: "FCR",
		label: "FCR",
		category: "feature",
		description: "Feature Completion Report — feature implementation evidence",
		supportLevel: "schema_lite",
	},
	{
		value: "FIR",
		label: "FIR",
		category: "feature",
		description: "Feature Integration Report — integration test evidence",
		supportLevel: "schema_lite",
	},
	{
		value: "FGR",
		label: "FGR",
		category: "feature",
		description: "Feature Gate Report — feature flag gate evidence",
		supportLevel: "schema_lite",
	},
	// Writing (4)
	{
		value: "WBR",
		label: "WBR",
		category: "writing",
		description: "Writing Baseline Report — writing quality baseline",
		supportLevel: "known",
	},
	{
		value: "WDR",
		label: "WDR",
		category: "writing",
		description: "Writing Draft Report — draft document evidence",
		supportLevel: "known",
	},
	{
		value: "WER",
		label: "WER",
		category: "writing",
		description: "Writing Edit Report — edit pass evidence",
		supportLevel: "known",
	},
	{
		value: "WQR",
		label: "WQR",
		category: "writing",
		description: "Writing Quality Report — quality review evidence",
		supportLevel: "known",
	},
	// Coordination (2)
	{
		value: "ECR",
		label: "ECR",
		category: "coordination",
		description: "Escalation Coordination Report — escalation handoff evidence",
		supportLevel: "schema_strict",
	},
	{
		value: "DCR",
		label: "DCR",
		category: "coordination",
		description: "Dependency Coordination Report — cross-workspace coordination",
		supportLevel: "schema_strict",
	},
];

// =============================================================================
// Result types
// =============================================================================

/** Result from the ACCP mode picker. */
export interface AccpModePickerResult {
	selectedMode: AccpMode;
	initialReportType?: AccpReportType;
	initialAction: string;
}

// =============================================================================
// Interactive TUI Component
// =============================================================================

/** Callback for when the user confirms a selection. */
export type AccpModePickerOnSelect = (result: AccpModePickerResult) => void;

/** Callback for when the user cancels the picker. */
export type AccpModePickerOnCancel = () => void;

/**
 * Interactive ACCP mode picker component.
 *
 * Implements the TUI Component interface so it can be used as an overlay.
 * Shows mode selection, report type selection, and navigation hints.
 */
export class AccpModePicker extends Container {
	private selectedModeIndex = 0;
	private selectedReportIndex = 0;
	private filteredReportTypes: AccpReportTypeEntry[] = [...ACCP_REPORT_TYPES];
	private currentMode: AccpMode;

	public onSelect?: AccpModePickerOnSelect;
	public onCancel?: AccpModePickerOnCancel;

	constructor(currentMode: AccpMode = "off") {
		super();
		this.currentMode = currentMode;
		this.selectedModeIndex = ACCP_MODE_OPTIONS.findIndex((m) => m.value === currentMode);
		if (this.selectedModeIndex < 0) this.selectedModeIndex = 0;
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		if (kb.matches(data, "tui.select.cancel")) {
			this.onCancel?.();
			return;
		}

		if (kb.matches(data, "tui.select.confirm")) {
			const mode = ACCP_MODE_OPTIONS[this.selectedModeIndex];
			const reportType = this.filteredReportTypes[this.selectedReportIndex];
			this.onSelect?.({
				selectedMode: mode?.value ?? this.currentMode,
				initialReportType: reportType?.value,
				initialAction: mode?.label ?? "Off",
			});
			return;
		}

		if (kb.matches(data, "tui.select.up")) {
			this.moveSelection(-1);
			return;
		}

		if (kb.matches(data, "tui.select.down")) {
			this.moveSelection(1);
			return;
		}

		if (kb.matches(data, "tui.select.pageUp")) {
			this.moveSelection(-5);
			return;
		}

		if (kb.matches(data, "tui.select.pageDown")) {
			this.moveSelection(5);
			return;
		}

		// Number keys 1-2 for direct mode selection
		const digitMatch = (["1", "2"] as const).find((d) => matchesKey(data, d));
		if (digitMatch) {
			const idx = parseInt(digitMatch, 10) - 1;
			if (idx < ACCP_MODE_OPTIONS.length) {
				this.selectedModeIndex = idx;
				// Auto-confirm with the directly selected mode
				const mode = ACCP_MODE_OPTIONS[idx];
				const reportType = this.filteredReportTypes[this.selectedReportIndex];
				this.onSelect?.({
					selectedMode: mode.value,
					initialReportType: reportType?.value,
					initialAction: mode.label,
				});
			}
			return;
		}

		// Tab toggles focus between mode list and report type list
		if (kb.matches(data, "tui.input.tab")) {
			// In the picker, Tab cycles through the two selection groups.
			// Since we render both sections, we use Tab to toggle the
			// "active panel" conceptually; the up/down moves within each.
			// For simplicity, just cycle the report type.
			this.selectedReportIndex = (this.selectedReportIndex + 1) % this.filteredReportTypes.length;
			return;
		}
	}

	private moveSelection(delta: number): void {
		this.selectedReportIndex = Math.max(
			0,
			Math.min(this.selectedReportIndex + delta, this.filteredReportTypes.length - 1),
		);
	}

	render(width: number): string[] {
		const available = Math.max(20, width);
		const lines: string[] = [];

		// Header
		lines.push(centerText("ACCP Mode Picker", available, "═"));
		lines.push("");

		// Mode selection section
		lines.push("  Mode:");
		for (let i = 0; i < ACCP_MODE_OPTIONS.length; i++) {
			const opt = ACCP_MODE_OPTIONS[i];
			const isSelected = i === this.selectedModeIndex;
			const marker = isSelected ? ">" : " ";
			const highlight = isSelected ? `\x1b[7m${opt.label.padEnd(10)}\x1b[0m` : opt.label.padEnd(10);
			lines.push(` ${marker} ${i + 1}. ${highlight} ${opt.description}`);
		}

		lines.push("");

		// Report type selection section
		const reportLabel = this.filteredReportTypes[this.selectedReportIndex];
		lines.push("  Initial Report Type:");

		// Show visible window of report types (max 8 rows)
		const maxVisible = 8;
		const halfWindow = Math.floor(maxVisible / 2);
		let startIdx = Math.max(0, this.selectedReportIndex - halfWindow);
		if (startIdx + maxVisible > this.filteredReportTypes.length) {
			startIdx = Math.max(0, this.filteredReportTypes.length - maxVisible);
		}
		const endIdx = Math.min(startIdx + maxVisible, this.filteredReportTypes.length);

		for (let i = startIdx; i < endIdx; i++) {
			const rt = this.filteredReportTypes[i];
			const isSelected = i === this.selectedReportIndex;
			const marker = isSelected ? ">" : " ";
			const label = isSelected ? `\x1b[7m${rt.value.padEnd(5)}\x1b[0m` : rt.value.padEnd(5);
			const catLabel = categoryShort(rt.category);
			lines.push(` ${marker} ${label} ${catLabel} ${rt.description}`);
		}

		// Show total count if windowed
		if (this.filteredReportTypes.length > maxVisible) {
			lines.push(`       ... ${this.filteredReportTypes.length} total report types (↑↓ to scroll)`);
		}

		lines.push("");

		// Selected item detail
		if (reportLabel) {
			lines.push(`  Selected: ${reportLabel.value} (${reportLabel.category}) [${reportLabel.supportLevel}]`);
			lines.push(`    ${reportLabel.description}`);
		} else {
			lines.push("  Selected: Auto (compiler will detect type)");
		}

		lines.push("");

		// Mode implications
		const mode = ACCP_MODE_OPTIONS[this.selectedModeIndex];
		if (mode) {
			lines.push("  Mode Implications:");
			lines.push(`    Mutation policy: ${mutationPolicyForMode(mode.value)}`);
			lines.push(`    Route signals: ${routeImplicationForMode(mode.value)}`);
			lines.push(`    Gate behavior: ${gateBehaviorForMode(mode.value)}`);
		}

		lines.push("");

		// Footer
		lines.push(centerText("Enter=Select  Esc=Cancel  1-2=Quick Mode", available, "─"));

		return lines;
	}
}

// =============================================================================
// Legacy render helpers (backward compat)
// =============================================================================

/**
 * Render the ACCP mode picker options as a simple static string.
 * @deprecated Use {@link AccpModePicker} component for interactive use.
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
	lines.push("║  Enter 1-2 to select, Esc to cancel      ║");
	lines.push("╚══════════════════════════════════════════╝");

	return lines.join("\n");
}

/**
 * Select an ACCP mode by index (1-based).
 * @deprecated Use {@link AccpModePicker} component for interactive use.
 */
export function selectAccpMode(index: number): AccpModePickerResult | null {
	if (index < 1 || index > ACCP_MODE_OPTIONS.length) return null;

	const selected = ACCP_MODE_OPTIONS[index - 1];
	return {
		selectedMode: selected.value,
		initialAction: selected.label,
	};
}

// =============================================================================
// Helpers
// =============================================================================

function centerText(text: string, width: number, fill: string): string {
	const pad = Math.max(0, Math.floor((width - text.length) / 2));
	return fill.repeat(Math.max(0, pad)) + text + fill.repeat(Math.max(0, width - text.length - pad));
}

function categoryShort(cat: AccpReportCategory): string {
	switch (cat) {
		case "core":
			return "[C] ";
		case "bugfix":
			return "[B] ";
		case "feature":
			return "[F] ";
		case "writing":
			return "[W] ";
		case "coordination":
			return "[X] ";
	}
}

function mutationPolicyForMode(mode: AccpMode): string {
	switch (mode) {
		case "off":
			return "Full mutation allowed (no ACCP gating)";
		case "warn":
			return "Mutations proceed; ACCP findings are advisory";
		case "required":
			return "Mutations gated by ACCP gate verdicts";
	}
}

function routeImplicationForMode(mode: AccpMode): string {
	switch (mode) {
		case "off":
			return "No route signals emitted";
		case "warn":
			return "Route signals emitted as advisory";
		case "required":
			return "Route signals emitted; gate may require routing before completion";
	}
}

function gateBehaviorForMode(mode: AccpMode): string {
	switch (mode) {
		case "off":
			return "No gate evaluation";
		case "warn":
			return "Gates evaluated; failures logged but non-blocking";
		case "required":
			return "Gates evaluated; failures block workspace completion";
	}
}
