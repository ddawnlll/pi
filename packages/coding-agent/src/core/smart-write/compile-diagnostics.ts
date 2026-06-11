/**
 * P44.6.20 — Compile Diagnostics for Smart Write
 *
 * Machine-readable diagnostics when artifact schema, route, or
 * acceptance requirements fail during smart write compilation.
 *
 * Contract Schema: 4.1.1
 */

import type { ModeDiagnostic } from "../mode/mode-diagnostic.js";
import type { SchemaSelectionResult } from "./artifact-schema-selector.js";
import type { RouteSignalResult } from "./route-signal-compiler.js";

// ---------------------------------------------------------------------------
// Compile Status
// ---------------------------------------------------------------------------

export type CompileStatus = "success" | "schema_failed" | "route_failed" | "write_failed";

export interface CompileDiagnosticsResult {
	status: CompileStatus;
	diagnostics: ModeDiagnostic[];
	summary: string;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export function collectCompileDiagnostics(
	schemaResult: SchemaSelectionResult,
	routeResult: RouteSignalResult,
): CompileDiagnosticsResult {
	const allDiagnostics: ModeDiagnostic[] = [...schemaResult.diagnostics, ...routeResult.diagnostics];

	if (schemaResult.markdownRejected) {
		return {
			status: "schema_failed",
			diagnostics: allDiagnostics,
			summary:
				"Schema selection failed: markdown-only plans are rejected. Smart write must produce a JSON artifact.",
		};
	}

	if (routeResult.signal.startsWith("BLOCKED")) {
		return {
			status: "route_failed",
			diagnostics: allDiagnostics,
			summary: `Route signal compilation failed: ${routeResult.signal}. ${routeResult.diagnostics.map((d) => d.message).join(" ")}`,
		};
	}

	if (allDiagnostics.some((d) => d.severity === "blocking")) {
		return {
			status: "write_failed",
			diagnostics: allDiagnostics,
			summary: "Smart write compilation failed due to blocking diagnostics.",
		};
	}

	return {
		status: "success",
		diagnostics: [],
		summary: `Smart write compiled successfully. Route: ${routeResult.signal}. Schema: ${schemaResult.schema}.`,
	};
}
