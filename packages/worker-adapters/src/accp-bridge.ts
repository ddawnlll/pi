/**
 * ACCP detection bridge for the Local Pi Worker Adapter (P49.31 FIX-004).
 *
 * Detects ACCP YAML output in an agent's report and produces an
 * `AccpWorkerOutput` value. The detection is non-fabricating: if no
 * ACCP source is present, the bridge returns `detected: false` and the
 * adapter leaves `workerResult.accp` unset. If the agent explicitly
 * provides ACCP metadata in `request.metadata.accp`, the bridge uses
 * that directly.
 *
 * Detection rules (deterministic, no heuristics on prose):
 * 1. If `request.metadata.accp` is a partial AccpWorkerOutput, adopt it.
 * 2. If `agentResult.report` contains an `accp_version: "2.0.0"` line
 *    followed by `source_format: "ACCP-YAML"`, treat the report as raw
 *    ACCP YAML and surface it via `accp.sourceYaml` with `shouldCompile: true`.
 * 3. Otherwise: not detected.
 *
 * Report type and report id are parsed from the YAML's `report_type` /
 * `report_id` fields when present; otherwise they fall back to safe
 * defaults derived from the workspace id.
 */

import type { AccpReportType, AccpWorkerOutput, WorkerRunRequest } from "@earendil-works/pi-execution-contracts";

export interface AccpDetectionResult {
	detected: boolean;
	output?: AccpWorkerOutput;
}

interface MinimalAgentResult {
	report?: string;
	success: boolean;
	verdict: string;
	logs: string[];
}

export function detectAccpOutput(agentResult: MinimalAgentResult, request: WorkerRunRequest): AccpDetectionResult {
	// Rule 1: explicit metadata wins.
	const meta = request.metadata ?? {};
	const metaAccp = meta.accp as Partial<AccpWorkerOutput> | undefined;
	if (metaAccp && typeof metaAccp === "object") {
		const output: AccpWorkerOutput = {
			reportType: (metaAccp.reportType as AccpReportType | undefined) ?? "RIR",
			reportId: metaAccp.reportId ?? `${request.workspaceId}-RIR`,
			sourceYaml: metaAccp.sourceYaml,
			shouldCompile: metaAccp.shouldCompile ?? Boolean(metaAccp.sourceYaml),
			compiledArtifactPath: metaAccp.compiledArtifactPath,
			routeSignal: metaAccp.routeSignal,
			gateVerdict: metaAccp.gateVerdict,
			diagnostics: metaAccp.diagnostics,
			repairPrompt: metaAccp.repairPrompt,
		};
		return { detected: true, output };
	}

	// Rule 2: scan the report for ACCP YAML markers.
	const report = agentResult.report ?? "";
	if (isAccpYaml(report)) {
		const reportType = extractField(report, "report_type") as AccpReportType | null;
		const reportId = extractField(report, "report_id");
		const output: AccpWorkerOutput = {
			reportType: reportType ?? "RIR",
			reportId: reportId ?? `${request.workspaceId}-${Date.now()}`,
			sourceYaml: report,
			shouldCompile: true,
		};
		return { detected: true, output };
	}

	// Rule 3: nothing detected.
	return { detected: false };
}

function isAccpYaml(text: string): boolean {
	if (!text) return false;
	// ACCP-YAML reports declare their protocol. The agent may also embed
	// the YAML inside a fenced code block; strip the fences first.
	const stripped = text.replace(/```(?:yaml|yml|accp)?\n/g, "\n").replace(/```/g, "");
	return /accp_version:\s*"?2\.0\.0"?/m.test(stripped) && /source_format:\s*"?ACCP-YAML"?/m.test(stripped);
}

function extractField(text: string, field: string): string | null {
	const re = new RegExp(`^${field}:\\s*"?([^"\\n]+)"?\\s*$`, "m");
	const m = re.exec(text);
	return m ? m[1].trim() : null;
}
