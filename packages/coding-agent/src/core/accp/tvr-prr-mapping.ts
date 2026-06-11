/**
 * P44.6.31 — TVR and PRR Mapping for P44.6
 *
 * Maps validation and promotion readiness to TVR/PRR report requirements
 * with stable artifact paths.
 *
 * Contract Schema: 4.1.1
 */

export type ReportMappingKind = "TVR" | "PRR";

export interface ReportMapping {
	kind: ReportMappingKind;
	workspaceId: string;
	artifactPath: string;
	required: boolean;
}

export function createReportMapping(kind: ReportMappingKind, workspaceId: string): ReportMapping {
	return {
		kind,
		workspaceId,
		artifactPath: `reports/accp/P44.6/source/P44_6_${workspaceId.replace("P44.6.", "")}_${kind}.accp.yaml`,
		required: true,
	};
}
