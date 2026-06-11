import { describe, expect, it } from "vitest";
import { selectSchema } from "../../src/core/smart-write/artifact-schema-selector.js";
import { collectCompileDiagnostics } from "../../src/core/smart-write/compile-diagnostics.js";

describe("collectCompileDiagnostics", () => {
	it("reports success for valid schema and route", () => {
		const schemaResult = selectSchema("create a file");
		const routeResult = { signal: "ROUTE_TO_WRITE" as const, schema: "artifact" as const, diagnostics: [] };
		const result = collectCompileDiagnostics(schemaResult, routeResult);
		expect(result.status).toBe("success");
	});

	it("reports schema_failed for markdown rejection", () => {
		const schemaResult = selectSchema("plan", "out.md");
		const routeResult = { signal: "ROUTE_TO_WRITE" as const, schema: "artifact" as const, diagnostics: [] };
		const result = collectCompileDiagnostics(schemaResult, routeResult);
		expect(result.status).toBe("schema_failed");
	});
});
