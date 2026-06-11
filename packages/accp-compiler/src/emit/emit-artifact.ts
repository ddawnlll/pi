/**
 * ACCP Artifact Writer
 *
 * Writes compiled ACCP artifacts to disk in the standard layout:
 *   reports/accp/{plan_id}/compiled/{report_id}.compiled.json
 *   reports/accp/{plan_id}/ir/{report_id}.ir.json
 *   reports/accp/{plan_id}/verdict/{report_id}.gate-verdict.json
 *   reports/accp/{plan_id}/route/{report_id}.route-signal.json
 *   reports/accp/{plan_id}/index.json
 *   reports/accp/{plan_id}/graph.json
 *
 * @packageDocumentation
 */

import type { AccpCompileResult, AccpRouteSignal } from "@earendil-works/pi-execution-contracts";

/** Paths for ACCP artifacts. */
export interface AccpArtifactPaths {
	compiledJson: string;
	irJson: string;
	verdictJson: string;
	routeJson: string;
	renderedMarkdown?: string;
}

/**
 * Build artifact paths for a given report.
 *
 * @param planId - Plan ID (e.g. "P49").
 * @param reportId - Report ID.
 * @returns Artifact paths.
 */
export function buildArtifactPaths(planId: string, reportId: string): AccpArtifactPaths {
	const base = `reports/accp/${planId}`;
	return {
		compiledJson: `${base}/compiled/${reportId}.compiled.json`,
		irJson: `${base}/ir/${reportId}.ir.json`,
		verdictJson: `${base}/verdict/${reportId}.gate-verdict.json`,
		routeJson: `${base}/route/${reportId}.route-signal.json`,
		renderedMarkdown: `${base}/rendered/${reportId}.accp.md`,
	};
}

/** Index entry for a report. */
export interface AccpIndexEntry {
	reportId: string;
	reportType: string;
	sourcePath: string;
	compiledPath: string;
	irPath: string;
	verdictPath: string;
	routeSignalPath: string;
	status: string;
}

/** Graph edge representing a routing recommendation. */
export interface AccpGraphEdge {
	source: string;
	target: string;
	action: string;
	confidence: string;
}

/** Complete index.json content. */
export interface AccpIndex {
	planId: string;
	accpVersion: string;
	timestamp: string;
	entries: AccpIndexEntry[];
}

/** Complete graph.json content. */
export interface AccpGraph {
	planId: string;
	nodes: { id: string; type: string }[];
	edges: AccpGraphEdge[];
}

/**
 * Create an index entry for a report.
 */
export function createIndexEntry(
	reportId: string,
	reportType: string,
	sourcePath: string,
	compileResult: AccpCompileResult,
	paths: AccpArtifactPaths,
): AccpIndexEntry {
	return {
		reportId,
		reportType,
		sourcePath,
		compiledPath: paths.compiledJson,
		irPath: paths.irJson,
		verdictPath: paths.verdictJson,
		routeSignalPath: paths.routeJson,
		status: compileResult.status,
	};
}

/**
 * Create a graph edge from a route signal.
 */
export function createGraphEdge(signal: AccpRouteSignal): AccpGraphEdge {
	return {
		source: signal.sourceReportId,
		target: signal.recommendedNextRoute || "(unresolved)",
		action: signal.recommendedNextAction,
		confidence: signal.confidence,
	};
}
