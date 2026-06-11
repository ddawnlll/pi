/**
 * ACCP Artifact Writer Tests
 */

import type { AccpCompileResult, AccpIntermediateRepresentation } from "@earendil-works/pi-execution-contracts";
import { describe, expect, it } from "vitest";
import { buildArtifactPaths, createGraphEdge, createIndexEntry } from "../src/emit/emit-artifact.js";
import { compileGateVerdict } from "../src/emit/emit-gate-verdict.js";
import { renderAsMarkdown } from "../src/emit/emit-rendered-markdown.js";
import { compileRouteSignal } from "../src/emit/emit-route-signal.js";

describe("ACCP Artifact Writer", () => {
	it("should build correct artifact paths", () => {
		const paths = buildArtifactPaths("P49", "TEST_001");
		expect(paths.compiledJson).toContain("reports/accp/P49/compiled/TEST_001.compiled.json");
		expect(paths.irJson).toContain("reports/accp/P49/ir/TEST_001.ir.json");
		expect(paths.verdictJson).toContain("reports/accp/P49/verdict/TEST_001.gate-verdict.json");
		expect(paths.routeJson).toContain("reports/accp/P49/route/TEST_001.route-signal.json");
		expect(paths.renderedMarkdown).toContain("reports/accp/P49/rendered/TEST_001.accp.md");
	});

	it("should create a valid index entry", () => {
		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};
		const paths = buildArtifactPaths("P49", "TEST_001");
		const entry = createIndexEntry("TEST_001", "TVR", "source/test.accp.yaml", compileResult, paths);
		expect(entry.reportId).toBe("TEST_001");
		expect(entry.status).toBe("compiled");
		expect(entry.compiledPath).toBe(paths.compiledJson);
	});

	it("should create a graph edge from a route signal", () => {
		const { signal } = compileRouteSignal("TEST_001", "TVR", []);
		const edge = createGraphEdge(signal);
		expect(edge.source).toBe("TEST_001");
		expect(edge.target).toBe("PRR");
		expect(edge.confidence).toBe("high");
	});
});

describe("ACCP Rendered Markdown", () => {
	it("should mark rendered output as human-preview-only", () => {
		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};
		const rendered = renderAsMarkdown(compileResult);
		expect(rendered.isHumanPreviewOnly).toBe(true);
		expect(rendered.content).toContain("human preview only");
	});

	it("should include gate verdict and route signal when provided", () => {
		const compileResult: AccpCompileResult = {
			status: "compiled_with_warnings",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [{ code: "ACCP_PARSE_YAML_INVALID", message: "minor issue", severity: "warning", fatal: false }],
			hasBlockingFindings: false,
		};
		const verdict = compileGateVerdict("TEST_001", "TVR", compileResult.diagnostics, "complete");
		const { signal } = compileRouteSignal("TEST_001", "TVR", compileResult.diagnostics);

		const rendered = renderAsMarkdown(compileResult, undefined, verdict, signal);
		expect(rendered.content).toContain("Gate Verdict");
		expect(rendered.content).toContain("Route Signal");
		expect(rendered.content).toContain("human preview only");
	});

	it("should include IR section when provided", () => {
		const compileResult: AccpCompileResult = {
			status: "compiled",
			reportId: "TEST_001",
			reportType: "TVR",
			diagnostics: [],
			hasBlockingFindings: false,
		};
		const ir: AccpIntermediateRepresentation = {
			sourceReportId: "TEST_001",
			reportType: "TVR",
			family: "core",
			sections: { validation_summary: "passed" },
			diagnostics: [],
			references: [],
		};
		const rendered = renderAsMarkdown(compileResult, ir);
		expect(rendered.content).toContain("Intermediate Representation");
		expect(rendered.content).toContain("validation_summary");
	});
});
