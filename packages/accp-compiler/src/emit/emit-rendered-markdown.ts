/**
 * ACCP Rendered Markdown Emitter
 *
 * Produces human-readable Markdown preview from compiled ACCP artifacts.
 * Rendered Markdown is explicitly marked as human-preview-only.
 * No runtime consumer may parse rendered Markdown for authority decisions.
 *
 * @packageDocumentation
 */

import type {
	AccpCompileResult,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";

/** Rendered Markdown content with metadata. */
export interface RenderedMarkdown {
	/** The rendered Markdown string. */
	content: string;
	/** Whether this is human-preview-only (always true). */
	isHumanPreviewOnly: boolean;
}

/**
 * Render a compiled ACCP report as human-readable Markdown.
 *
 * The output is annotated with a warning that it must not be parsed
 * for authority decisions.
 */
export function renderAsMarkdown(
	compileResult: AccpCompileResult,
	ir?: AccpIntermediateRepresentation,
	verdict?: AccpGateVerdict,
	signal?: AccpRouteSignal,
): RenderedMarkdown {
	const lines: string[] = [];

	// Header with human-preview-only warning
	lines.push(`# ACCP Report: ${compileResult.reportId}`);
	lines.push("");
	lines.push("> **Warning**: This rendered Markdown is a human preview only.");
	lines.push("> Do NOT parse this document for execution authority decisions.");
	lines.push("> Use the compiled JSON artifacts (compiled.json, route-signal.json,");
	lines.push("> gate-verdict.json) as machine-readable inputs.");
	lines.push("");

	// Status
	lines.push("## Status");
	lines.push("");
	lines.push(`- **Report ID**: ${compileResult.reportId}`);
	lines.push(`- **Report Type**: ${compileResult.reportType}`);
	lines.push(`- **Compile Status**: ${compileResult.status}`);
	lines.push(`- **Blocking Findings**: ${compileResult.hasBlockingFindings ? "Yes" : "No"}`);
	lines.push("");

	// Diagnostics
	if (compileResult.diagnostics.length > 0) {
		lines.push("## Diagnostics");
		lines.push("");
		for (const d of compileResult.diagnostics) {
			const icon = d.fatal ? "x" : d.severity === "warning" ? "!" : "i";
			lines.push(`- [${icon}] \`${d.code}\`: ${d.message}`);
		}
		lines.push("");
	}

	// Gate verdict
	if (verdict) {
		lines.push("## Gate Verdict");
		lines.push("");
		lines.push(`- **Valid**: ${verdict.valid}`);
		lines.push(`- **Promotion Ready**: ${verdict.promotionReady}`);
		lines.push(`- **Evidence Status**: ${verdict.evidenceStatus}`);
		if (verdict.fatalErrors.length > 0) {
			lines.push("- **Fatal Errors**:");
			for (const e of verdict.fatalErrors) lines.push(`  - ${e}`);
		}
		if (verdict.warnings.length > 0) {
			lines.push("- **Warnings**:");
			for (const w of verdict.warnings) lines.push(`  - ${w}`);
		}
		lines.push("");
	}

	// Route signal
	if (signal) {
		lines.push("## Route Signal (Advisory)");
		lines.push("");
		lines.push(`- **Recommended Next Route**: ${signal.recommendedNextRoute}`);
		lines.push(`- **Recommended Next Action**: ${signal.recommendedNextAction}`);
		lines.push(`- **Confidence**: ${signal.confidence}`);
		lines.push(`- **Mutation Policy Needed**: ${signal.mutationPolicyNeeded}`);
		lines.push(`- **Target Resolved**: ${signal.targetResolved}`);
		lines.push("");
		lines.push("> This route signal is advisory. Runtime must check PlanSpec authority");
		lines.push("> before acting on this recommendation.");
		lines.push("");
	}

	// IR summary
	if (ir) {
		lines.push("## Intermediate Representation");
		lines.push("");
		lines.push(`- **Source Report**: ${ir.sourceReportId}`);
		lines.push(`- **Family**: ${ir.family}`);
		lines.push(`- **Sections**: ${Object.keys(ir.sections).join(", ")}`);
		lines.push(`- **References**: ${ir.references.join(", ") || "none"}`);
		lines.push("");
	}

	lines.push("---");
	lines.push(`*Rendered at ${new Date().toISOString()}*`);

	return {
		content: lines.join("\n"),
		isHumanPreviewOnly: true,
	};
}
