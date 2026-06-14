/**
 * ACCP Result Component (P49.32B)
 *
 * Renders structured ACCP compilation result with PASS/HOLD/FAIL status,
 * artifact paths, gate verdict, and blocked reasons as a distinct card
 * in the TUI chat area.
 *
 * @packageDocumentation
 */

import type { AccpDiagnostic, AccpGateVerdict } from "@earendil-works/pi-execution-contracts";
import { type Component, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

/** ACCP result status. */
export type AccpResultStatus = "pass" | "hold" | "fail" | "skipped";

/** Data for rendering an ACCP result. */
export interface AccpResultData {
	status: AccpResultStatus;
	reportId?: string;
	compiledArtifactPath?: string;
	gateVerdictPath?: string;
	routeSignalPath?: string;
	diagnostics: AccpDiagnostic[];
	gateVerdict?: AccpGateVerdict;
	blockedReasons: string[];
	/** Human-readable reason when status is "skipped" (shown as a summary line). */
	skipReason?: string;
	/** Detailed bullet points explaining why ACCP was skipped. */
	skipDetails?: string[];
}

/**
 * ACCP Result Component that renders as a structured card in the chat area.
 * Distinct from normal assistant Markdown messages.
 */
export class AccpResultComponent implements Component {
	private container: Container;

	constructor(private data: AccpResultData) {
		this.container = new Container();
		this.renderCard();
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	handleInput(_data: string): void {
		// No interactive behavior needed
	}

	invalidate(): void {
		this.renderCard();
	}

	private renderCard(): void {
		this.container.clear();

		const {
			status,
			reportId,
			compiledArtifactPath,
			gateVerdictPath,
			routeSignalPath,
			diagnostics,
			gateVerdict,
			blockedReasons,
		} = this.data;

		// Separator
		this.container.addChild(new Text(theme.fg("dim", "---"), 0, 0));

		// Title
		const titleText = reportId ? `ACCP Compilation Result (${reportId})` : "ACCP Compilation Result";
		this.container.addChild(new Text(theme.bold(titleText), 0, 0));

		// Status badge with color coding
		let statusBadge: string;
		switch (status) {
			case "pass":
				statusBadge = theme.fg("success", `[PASS]`);
				break;
			case "hold":
				statusBadge = theme.fg("warning", `[HOLD]`);
				break;
			case "fail":
				statusBadge = theme.fg("error", `[FAIL]`);
				break;
			case "skipped":
				statusBadge = theme.fg("warning", `[SKIPPED]`);
				break;
		}
		this.container.addChild(new Text(`Status: ${statusBadge}`, 1, 0));

		// Skipped: show explanation with specific reasons
		if (status === "skipped") {
			const reason = this.data.skipReason ?? "ACCP compilation did not run.";
			this.container.addChild(new Text(theme.fg("warning", reason), 1, 0));
			if (this.data.skipDetails?.length) {
				for (const detail of this.data.skipDetails) {
					this.container.addChild(new Text(theme.fg("dim", `  → ${detail}`), 1, 0));
				}
			}
			return;
		}

		// Diagnostics summary
		if (diagnostics.length > 0) {
			const fatalCount = diagnostics.filter((d) => d.fatal).length;
			const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
			const diagText = `Diagnostics: ${diagnostics.length} total (${fatalCount} fatal, ${warningCount} warnings)`;
			this.container.addChild(new Text(theme.fg("muted", diagText), 1, 0));
		} else {
			this.container.addChild(new Text(theme.fg("muted", "Diagnostics: none"), 1, 0));
		}

		// Gate verdict
		if (gateVerdict) {
			const verdictLabel = gateVerdict.valid ? "PASS" : "BLOCKED";
			const verdictColor = gateVerdict.valid ? theme.fg("success", verdictLabel) : theme.fg("error", verdictLabel);
			const evidenceText = `Evidence: ${gateVerdict.evidenceStatus}`;
			this.container.addChild(new Text(`Gate: ${verdictColor} | ${theme.fg("muted", evidenceText)}`, 1, 0));
		}

		// Artifact paths
		if (compiledArtifactPath) {
			this.container.addChild(new Text(theme.fg("muted", `Compiled artifact: ${compiledArtifactPath}`), 1, 0));
		}
		if (gateVerdictPath) {
			this.container.addChild(new Text(theme.fg("muted", `Gate verdict: ${gateVerdictPath}`), 1, 0));
		}
		if (routeSignalPath) {
			this.container.addChild(new Text(theme.fg("muted", `Route signal: ${routeSignalPath}`), 1, 0));
		}

		// Blocked reasons (for HOLD/FAIL)
		if (blockedReasons.length > 0 && (status === "hold" || status === "fail")) {
			this.container.addChild(new Spacer(1));
			this.container.addChild(new Text(theme.fg("warning", "Blocked reasons:"), 0, 0));
			for (const reason of blockedReasons) {
				this.container.addChild(new Text(`  • ${reason}`, 1, 0));
			}
		}

		// Separator
		this.container.addChild(new Text(theme.fg("dim", "---"), 0, 0));
	}
}
