/**
 * ACCP Status Component (P49.32B)
 *
 * Renders current ACCP mode, compilation status, gate verdict, and diagnostics
 * in the TUI chat area as a collapsible status card.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpGateVerdict, AccpMode } from "@earendil-works/pi-execution-contracts";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

/** ACCP compilation status states. */
export type AccpCompilationStatus =
	| "idle"
	| "compiling"
	| "compiled"
	| "gate_running"
	| "pass"
	| "hold"
	| "fail"
	| "artifact_missing"
	| "stale_ignored";

/** Data for rendering ACCP status. */
export interface AccpStatusData {
	mode: AccpMode;
	compilationStatus: AccpCompilationStatus;
	diagnostics: AccpDiagnostic[];
	gateVerdict?: AccpGateVerdict;
	lastCompiledReport?: string;
	blockedReasons?: string[];
}

/**
 * ACCP Status Component that renders as a collapsible card in the chat area.
 */
export class AccpStatusComponent implements Component {
	private container: Container;
	private expanded = true;

	constructor(private data: AccpStatusData) {
		this.container = new Container();
	}

	/** Update the component with new data. */
	update(data: AccpStatusData): void {
		this.data = data;
	}

	/** Toggle expansion state. */
	toggleExpanded(): void {
		this.expanded = !this.expanded;
	}

	render(width: number): string[] {
		this.container.clear();

		// Header line with mode indicator
		const modeLabel = this.getModeLabel(this.data.mode);
		const statusLabel = this.getStatusLabel(this.data.compilationStatus);
		const headerText = `${modeLabel} | ${statusLabel}`;

		// Color-code based on severity
		let headerColor: string;
		if (this.data.compilationStatus === "fail") {
			headerColor = theme.fg("error", headerText);
		} else if (this.data.compilationStatus === "hold" || this.data.compilationStatus === "stale_ignored") {
			headerColor = theme.fg("warning", headerText);
		} else if (this.data.compilationStatus === "pass") {
			headerColor = theme.fg("success", headerText);
		} else {
			headerColor = theme.fg("dim", headerText);
		}

		this.container.addChild(new Text(headerColor, 1, 0));

		if (this.expanded) {
			// Diagnostics summary
			if (this.data.diagnostics.length > 0) {
				const fatalCount = this.data.diagnostics.filter((d) => d.fatal).length;
				const warningCount = this.data.diagnostics.filter((d) => d.severity === "warning").length;
				const diagText = `Diagnostics: ${this.data.diagnostics.length} (${fatalCount} fatal, ${warningCount} warnings)`;
				this.container.addChild(new Text(theme.fg("muted", diagText), 2, 0));
			}

			// Gate verdict
			if (this.data.gateVerdict) {
				const verdictText = this.data.gateVerdict.valid ? "PASS" : "BLOCKED";
				const verdictColor = this.data.gateVerdict.valid
					? theme.fg("success", verdictText)
					: theme.fg("error", verdictText);
				const evidenceText = `Evidence: ${this.data.gateVerdict.evidenceStatus}`;
				this.container.addChild(new Text(`${verdictColor} | ${theme.fg("muted", evidenceText)}`, 2, 0));
			}

			// Blocked reasons
			if (this.data.blockedReasons && this.data.blockedReasons.length > 0) {
				this.container.addChild(new Text(theme.fg("warning", "Blocked reasons:"), 2, 0));
				for (const reason of this.data.blockedReasons) {
					this.container.addChild(new Text(`  • ${reason}`, 3, 0));
				}
			}

			// Compiled artifact path
			if (this.data.lastCompiledReport) {
				const reportPath = `Compiled: ${this.data.lastCompiledReport}`;
				this.container.addChild(new Text(theme.fg("muted", reportPath), 2, 0));
			}
		}

		return this.container.render(width);
	}

	handleInput(data: string): void {
		// Handle collapse/expand toggle
		if (data === "enter" || data === "\r" || data === "\n") {
			this.toggleExpanded();
		}
	}

	invalidate(): void {
		this.render(80); // Will re-render on next requestRender
	}

	private getModeLabel(mode: AccpMode): string {
		switch (mode) {
			case "required":
				return "ACCP[req]";
			case "warn":
				return "ACCP[warn]";
			case "off":
				return "ACCP[off]";
			default:
				return "ACCP[...]";
		}
	}

	private getStatusLabel(status: AccpCompilationStatus): string {
		switch (status) {
			case "compiling":
				return "compiling...";
			case "compiled":
				return "compiled";
			case "gate_running":
				return "gate evaluating...";
			case "pass":
				return "PASS";
			case "hold":
				return "HOLD";
			case "fail":
				return "FAIL";
			case "artifact_missing":
				return "artifact missing";
			case "stale_ignored":
				return "stale verdict ignored";
			default:
				return "idle";
		}
	}
}
