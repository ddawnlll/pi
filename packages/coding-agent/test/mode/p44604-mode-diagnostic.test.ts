/**
 * P44.6.04 — Mode Diagnostic Model
 *
 * Unit tests for:
 * - ModeDiagnostic type structure
 * - Diagnostic severity levels (blocking, warning)
 * - DiagnosticCollection helpers
 * - Factory functions (blockingDiagnostic, warningDiagnostic)
 * - Filter functions (filterBySeverity, filterByCode)
 *
 * Contract Schema: 4.1.1
 */

import { describe, expect, it } from "vitest";
import {
	blockingDiagnostic,
	type DiagnosticCollection,
	filterByCode,
	filterBySeverity,
	hasBlockingDiagnostics,
	type ModeDiagnostic,
	type ModeDiagnosticCode,
	warningDiagnostic,
} from "../../src/core/mode/mode-diagnostic.js";

// ---------------------------------------------------------------------------
// Type Structure
// ---------------------------------------------------------------------------

describe("ModeDiagnostic type structure", () => {
	it("supports blocking severity", () => {
		const diagnostic: ModeDiagnostic = {
			severity: "blocking",
			code: "BLOCKED_AMBIGUOUS_MODE",
			message: "Cannot determine mode.",
		};
		expect(diagnostic.severity).toBe("blocking");
		expect(diagnostic.code).toBe("BLOCKED_AMBIGUOUS_MODE");
	});

	it("supports warning severity", () => {
		const diagnostic: ModeDiagnostic = {
			severity: "warning",
			code: "WARN_INFERRED_MODE",
			message: "Mode was inferred.",
		};
		expect(diagnostic.severity).toBe("warning");
	});

	it("supports all standard diagnostic codes", () => {
		const blockingCodes: ModeDiagnosticCode[] = [
			"BLOCKED_AMBIGUOUS_INPUT",
			"BLOCKED_AMBIGUOUS_MODE",
			"BLOCKED_MISSING_TARGET",
			"BLOCKED_LARGE_OVERWRITE",
			"BLOCKED_UNSUPPORTED_INTENT",
			"BLOCKED_READINESS_FAILURE",
			"BLOCKED_EVIDENCE_MISSING",
			"BLOCKED_PATCH_NOT_TRACEABLE",
			"BLOCKED_REGRESSION_DETECTED",
		];
		const warningCodes: ModeDiagnosticCode[] = [
			"WARN_INFERRED_MODE",
			"WARN_READ_ONLY_INTENT",
			"WARN_STALE_EVIDENCE",
			"WARN_OVERWRITE_UNCONFIRMED",
			"WARN_MISSING_CONSTRAINTS",
			"WARN_LARGE_TARGET",
		];
		const routeCodes: ModeDiagnosticCode[] = ["ROUTE_TO_WRITE", "ROUTE_TO_PLAN_JSON", "ROUTE_TO_ARTIFACT_EXPORT"];
		const all: ModeDiagnosticCode[] = [...blockingCodes, ...warningCodes, ...routeCodes, "CUSTOM"];
		expect(all.length).toBeGreaterThan(0);
	});

	it("supports optional fileRef", () => {
		const diagnostic: ModeDiagnostic = {
			severity: "blocking",
			code: "BLOCKED_MISSING_TARGET",
			message: "No target.",
			fileRef: "src/foo.ts",
		};
		expect(diagnostic.fileRef).toBe("src/foo.ts");
	});

	it("supports optional lineRange", () => {
		const diagnostic: ModeDiagnostic = {
			severity: "warning",
			code: "WARN_LARGE_TARGET",
			message: "Large file.",
			fileRef: "src/foo.ts",
			lineRange: { start: 1, end: 1000 },
		};
		expect(diagnostic.lineRange!.start).toBe(1);
		expect(diagnostic.lineRange!.end).toBe(1000);
	});

	it("supports optional details", () => {
		const diagnostic: ModeDiagnostic = {
			severity: "blocking",
			code: "CUSTOM",
			message: "Custom issue.",
			details: "Additional structured info about the issue.",
		};
		expect(diagnostic.details).toBe("Additional structured info about the issue.");
	});
});

// ---------------------------------------------------------------------------
// Diagnostic Factory Functions
// ---------------------------------------------------------------------------

describe("blockingDiagnostic", () => {
	it("creates a blocking diagnostic", () => {
		const d = blockingDiagnostic("BLOCKED_MISSING_TARGET", "Target path not found");
		expect(d.severity).toBe("blocking");
		expect(d.code).toBe("BLOCKED_MISSING_TARGET");
		expect(d.message).toBe("Target path not found");
	});

	it("accepts optional fileRef", () => {
		const d = blockingDiagnostic("BLOCKED_AMBIGUOUS_MODE", "Ambiguous", "src/bar.ts");
		expect(d.fileRef).toBe("src/bar.ts");
	});
});

describe("warningDiagnostic", () => {
	it("creates a warning diagnostic", () => {
		const d = warningDiagnostic("WARN_INFERRED_MODE", "Mode inferred");
		expect(d.severity).toBe("warning");
		expect(d.code).toBe("WARN_INFERRED_MODE");
	});
});

// ---------------------------------------------------------------------------
// DiagnosticCollection Helpers
// ---------------------------------------------------------------------------

describe("hasBlockingDiagnostics", () => {
	it("returns false for empty collection", () => {
		expect(hasBlockingDiagnostics({ diagnostics: [] })).toBe(false);
	});

	it("returns false when only warnings exist", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [{ severity: "warning", code: "WARN_INFERRED_MODE", message: "Inferred" }],
		};
		expect(hasBlockingDiagnostics(collection)).toBe(false);
	});

	it("returns true when blocking diagnostics exist", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [{ severity: "blocking", code: "BLOCKED_AMBIGUOUS_MODE", message: "Ambiguous" }],
		};
		expect(hasBlockingDiagnostics(collection)).toBe(true);
	});

	it("returns true when both blocking and warnings exist", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [
				{ severity: "warning", code: "WARN_INFERRED_MODE", message: "Inferred" },
				{ severity: "blocking", code: "BLOCKED_MISSING_TARGET", message: "Missing" },
			],
		};
		expect(hasBlockingDiagnostics(collection)).toBe(true);
	});
});

describe("filterBySeverity", () => {
	it("filters blocking diagnostics", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [
				{ severity: "blocking", code: "BLOCKED_AMBIGUOUS_MODE", message: "A" },
				{ severity: "warning", code: "WARN_INFERRED_MODE", message: "B" },
				{ severity: "blocking", code: "BLOCKED_MISSING_TARGET", message: "C" },
			],
		};
		const blocking = filterBySeverity(collection, "blocking");
		expect(blocking).toHaveLength(2);
		expect(blocking[0].code).toBe("BLOCKED_AMBIGUOUS_MODE");
		expect(blocking[1].code).toBe("BLOCKED_MISSING_TARGET");
	});

	it("filters warning diagnostics", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [
				{ severity: "blocking", code: "BLOCKED_AMBIGUOUS_MODE", message: "A" },
				{ severity: "warning", code: "WARN_INFERRED_MODE", message: "B" },
			],
		};
		const warnings = filterBySeverity(collection, "warning");
		expect(warnings).toHaveLength(1);
		expect(warnings[0].code).toBe("WARN_INFERRED_MODE");
	});
});

describe("filterByCode", () => {
	it("filters by specific code", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [
				{ severity: "blocking", code: "BLOCKED_AMBIGUOUS_MODE", message: "A" },
				{ severity: "blocking", code: "BLOCKED_MISSING_TARGET", message: "B" },
			],
		};
		const matches = filterByCode(collection, "BLOCKED_AMBIGUOUS_MODE");
		expect(matches).toHaveLength(1);
		expect(matches[0].code).toBe("BLOCKED_AMBIGUOUS_MODE");
	});

	it("returns empty array when no match", () => {
		const collection: DiagnosticCollection = {
			diagnostics: [{ severity: "blocking", code: "BLOCKED_AMBIGUOUS_MODE", message: "A" }],
		};
		const matches = filterByCode(collection, "ROUTE_TO_WRITE");
		expect(matches).toHaveLength(0);
	});
});
