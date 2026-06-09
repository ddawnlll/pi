/**
 * P45.B3 — Evidence Ledger and Mutation Report Export Tests
 *
 * Tests verify:
 * - EvidenceLedgerExport construction from EvidenceLedgerSnapshot
 * - MutationReportExport construction from MutationReport arrays
 * - Summary statistics computation
 * - JSON report generation
 * - Markdown report formatting
 * - Schema version and metadata propagation
 * - Edge cases: empty ledger, empty reports, null fields
 */

import { describe, expect, it } from "vitest";
import type { EvidenceLedgerSnapshot } from "../../src/core/completion/evidence-ledger.js";
import type { EvidenceLedgerEntry, EvidenceSummary } from "../../src/core/completion/evidence-types.js";
import type { MutationReport } from "../../src/core/mutation/mutation-types.js";
import {
	buildEvidenceLedgerExport,
	buildMutationReportExport,
	DEFAULT_EVIDENCE_LEDGER_PATH,
	DEFAULT_MUTATION_REPORT_PATH,
	formatEvidenceLedgerReport,
	formatMutationReportReport,
	P45_EVIDENCE_MUTATION_SCHEMA_VERSION,
	serializeEvidenceLedgerExport,
	serializeMutationReportExport,
	toEvidenceLedgerJSON,
	toMutationReportJSON,
} from "../../src/core/p44/p45-bridge/evidence-mutation-export.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvidenceEntry(id: string, overrides: Partial<EvidenceLedgerEntry> = {}): EvidenceLedgerEntry {
	return {
		id,
		type: "test_run",
		description: `Evidence ${id}`,
		source: "test",
		timestamp: Date.now(),
		verdict: "pass",
		confidence: "high",
		content: "test output content for evidence entry",
		criterionIds: ["AC-001"],
		...overrides,
	};
}

function makeEvidenceSummary(overrides: Partial<EvidenceSummary> = {}): EvidenceSummary {
	return {
		total: 0,
		byType: {},
		byVerdict: {},
		byConfidence: {},
		passRate: 0,
		...overrides,
	};
}

function makeLedgerSnapshot(
	scopeId: string,
	entries: EvidenceLedgerEntry[],
	overrides: Partial<EvidenceLedgerSnapshot> = {},
): EvidenceLedgerSnapshot {
	const summary = makeEvidenceSummary({
		total: entries.length,
		byType: { test_run: entries.length },
		byVerdict: { pass: entries.length },
		byConfidence: { high: entries.length },
		passRate: entries.length > 0 ? 1 : 0,
	});
	return {
		scopeId,
		schemaVersion: "1.0.0",
		generatedAt: Date.now(),
		total: entries.length,
		summary,
		entries,
		...overrides,
	};
}

function makeMutationReport(path: string, overrides: Partial<MutationReport> = {}): MutationReport {
	return {
		path,
		mode: "edit",
		safetyLevel: "safe",
		preHash: "abc123",
		postHash: "def456",
		blocked: false,
		blockReason: null,
		rolledBack: false,
		rollbackReason: null,
		editRecoveryStrategy: null,
		parserOk: true,
		parserName: "typescript",
		writeSetOk: true,
		timestamp: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests: Builders
// ---------------------------------------------------------------------------

describe("P45.B3 — Evidence Ledger and Mutation Report Export", () => {
	describe("buildEvidenceLedgerExport", () => {
		it("should build export from EvidenceLedgerSnapshot", () => {
			const entries = [makeEvidenceEntry("EV-001")];
			const snapshot = makeLedgerSnapshot("P44.01", entries);
			const exportData = buildEvidenceLedgerExport(snapshot);

			expect(exportData.schemaVersion).toBe(P45_EVIDENCE_MUTATION_SCHEMA_VERSION);
			expect(exportData.scopeId).toBe("P44.01");
			expect(exportData.total).toBe(1);
			expect(exportData.entries).toHaveLength(1);
			expect(exportData.entries[0].id).toBe("EV-001");
			expect(exportData.summary.total).toBe(1);
			expect(exportData.summary.passRate).toBe(1);
		});

		it("should preserve all entry fields in export", () => {
			const entry = makeEvidenceEntry("EV-002", {
				type: "source_file",
				description: "Source implements feature",
				source: "src/feature.ts",
				verdict: "pass",
				confidence: "high",
				content: "file content",
				producedBy: "WS-01",
				criterionIds: ["AC-001", "AC-002"],
				planLockHash: "plan-hash-123",
				workspaceLockHash: "ws-hash-456",
				metadata: { key: "value" },
			});
			const snapshot = makeLedgerSnapshot("P44.01", [entry]);
			const exportData = buildEvidenceLedgerExport(snapshot);

			const exported = exportData.entries[0];
			expect(exported.id).toBe("EV-002");
			expect(exported.type).toBe("source_file");
			expect(exported.description).toBe("Source implements feature");
			expect(exported.source).toBe("src/feature.ts");
			expect(exported.verdict).toBe("pass");
			expect(exported.confidence).toBe("high");
			expect(exported.content).toBe("file content");
			expect(exported.producedBy).toBe("WS-01");
			expect(exported.criterionIds).toEqual(["AC-001", "AC-002"]);
			expect(exported.planLockHash).toBe("plan-hash-123");
			expect(exported.workspaceLockHash).toBe("ws-hash-456");
			expect(exported.metadata).toEqual({ key: "value" });
		});

		it("should propagate metadata from options", () => {
			const snapshot = makeLedgerSnapshot("P44.01", []);
			const metadata = { phase: "P44", wave: "W7" };
			const exportData = buildEvidenceLedgerExport(snapshot, { metadata });

			expect(exportData.metadata).toEqual(metadata);
		});

		it("should handle empty ledger snapshot", () => {
			const snapshot = makeLedgerSnapshot("P44.01", []);
			const exportData = buildEvidenceLedgerExport(snapshot);

			expect(exportData.total).toBe(0);
			expect(exportData.entries).toEqual([]);
			expect(exportData.summary.total).toBe(0);
			expect(exportData.summary.passRate).toBe(0);
		});

		it("should handle multiple entries with mixed verdicts", () => {
			const entries = [
				makeEvidenceEntry("EV-001", { verdict: "pass", confidence: "high" }),
				makeEvidenceEntry("EV-002", { verdict: "fail", confidence: "medium" }),
				makeEvidenceEntry("EV-003", { verdict: "pass", confidence: "low" }),
				makeEvidenceEntry("EV-004", { verdict: "inconclusive", confidence: "unknown" }),
			];
			const snapshot = makeLedgerSnapshot("P44.01", entries);
			const exportData = buildEvidenceLedgerExport(snapshot);

			expect(exportData.total).toBe(4);
			expect(exportData.entries).toHaveLength(4);
		});

		it("should accept custom generatedAt", () => {
			const snapshot = makeLedgerSnapshot("P44.01", [makeEvidenceEntry("EV-001")]);
			const customTime = 1_234_567_890;
			const exportData = buildEvidenceLedgerExport(snapshot, { generatedAt: customTime });

			expect(exportData.generatedAt).toBe(customTime);
		});
	});

	describe("buildMutationReportExport", () => {
		it("should build export from MutationReport array", () => {
			const reports = [makeMutationReport("src/main.ts")];
			const exportData = buildMutationReportExport(reports);

			expect(exportData.schemaVersion).toBe(P45_EVIDENCE_MUTATION_SCHEMA_VERSION);
			expect(exportData.totalMutations).toBe(1);
			expect(exportData.reports).toHaveLength(1);
			expect(exportData.reports[0].path).toBe("src/main.ts");
		});

		it("should compute summary statistics", () => {
			const reports = [
				makeMutationReport("src/a.ts", { mode: "edit", safetyLevel: "safe" }),
				makeMutationReport("src/b.ts", { mode: "create", safetyLevel: "guarded", blocked: true }),
				makeMutationReport("src/c.ts", { mode: "delete", safetyLevel: "dangerous", rolledBack: true }),
				makeMutationReport("src/d.ts", { mode: "edit", safetyLevel: "safe" }),
			];
			const exportData = buildMutationReportExport(reports);

			expect(exportData.summary.totalMutations).toBe(4);
			expect(exportData.summary.passedCount).toBe(2);
			expect(exportData.summary.blockedCount).toBe(1);
			expect(exportData.summary.rolledBackCount).toBe(1);
			expect(exportData.summary.byMode).toEqual({ edit: 2, create: 1, delete: 1 });
			expect(exportData.summary.bySafetyLevel).toEqual({ safe: 2, guarded: 1, dangerous: 1 });
		});

		it("should handle empty report array", () => {
			const exportData = buildMutationReportExport([]);

			expect(exportData.totalMutations).toBe(0);
			expect(exportData.reports).toEqual([]);
			expect(exportData.summary.totalMutations).toBe(0);
			expect(exportData.summary.passedCount).toBe(0);
			expect(exportData.summary.blockedCount).toBe(0);
			expect(exportData.summary.rolledBackCount).toBe(0);
			expect(exportData.summary.byMode).toEqual({});
			expect(exportData.summary.bySafetyLevel).toEqual({});
		});

		it("should preserve all mutation report fields", () => {
			const report = makeMutationReport("src/main.ts", {
				mode: "overwrite",
				safetyLevel: "guarded",
				preHash: "pre-hash",
				postHash: "post-hash",
				blocked: true,
				blockReason: "Write set violation",
				rolledBack: true,
				rollbackReason: "Parser validation failed",
				editRecoveryStrategy: "exact",
				parserOk: false,
				parserName: "typescript",
				writeSetOk: false,
			});
			const exportData = buildMutationReportExport([report]);
			const exported = exportData.reports[0];

			expect(exported.path).toBe("src/main.ts");
			expect(exported.mode).toBe("overwrite");
			expect(exported.safetyLevel).toBe("guarded");
			expect(exported.preHash).toBe("pre-hash");
			expect(exported.postHash).toBe("post-hash");
			expect(exported.blocked).toBe(true);
			expect(exported.blockReason).toBe("Write set violation");
			expect(exported.rolledBack).toBe(true);
			expect(exported.rollbackReason).toBe("Parser validation failed");
			expect(exported.editRecoveryStrategy).toBe("exact");
			expect(exported.parserOk).toBe(false);
			expect(exported.parserName).toBe("typescript");
			expect(exported.writeSetOk).toBe(false);
		});

		it("should propagate planExecId and metadata from options", () => {
			const reports = [makeMutationReport("src/main.ts")];
			const metadata = { phase: "P44", wave: "W7" };
			const exportData = buildMutationReportExport(reports, {
				planExecId: "plan-001",
				metadata,
			});

			expect(exportData.planExecId).toBe("plan-001");
			expect(exportData.metadata).toEqual(metadata);
		});

		it("should handle null-fields correctly in statistics", () => {
			const reports = [
				makeMutationReport("src/a.ts", { blocked: false, blockReason: null }),
				makeMutationReport("src/b.ts", { blocked: true, blockReason: "Test block" }),
				makeMutationReport("src/c.ts", { rolledBack: false, rollbackReason: null }),
				makeMutationReport("src/d.ts", { rolledBack: true, rollbackReason: "Test rollback" }),
			];
			const exportData = buildMutationReportExport(reports);

			expect(exportData.summary.blockedCount).toBe(1);
			expect(exportData.summary.rolledBackCount).toBe(1);
			expect(exportData.summary.passedCount).toBe(2);
		});
	});

	describe("JSON Serialization", () => {
		describe("toEvidenceLedgerJSON", () => {
			it("should serialize evidence ledger export to JSON", () => {
				const entries = [makeEvidenceEntry("EV-001")];
				const snapshot = makeLedgerSnapshot("P44.01", entries);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const json = toEvidenceLedgerJSON(exportData);

				expect(json.schemaVersion).toBe(P45_EVIDENCE_MUTATION_SCHEMA_VERSION);
				expect(json.scopeId).toBe("P44.01");
				expect(json.total).toBe(1);
				expect(json.summary).toBeDefined();
				expect(json.entries).toHaveLength(1);
				expect((json.entries as Array<Record<string, unknown>>)[0].id).toBe("EV-001");
			});

			it("should omit optional fields when not set", () => {
				const entries = [makeEvidenceEntry("EV-001")];
				const snapshot = makeLedgerSnapshot("P44.01", entries);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const json = toEvidenceLedgerJSON(exportData);

				expect(json.metadata).toBeUndefined();
				const entry = (json.entries as Array<Record<string, unknown>>)[0];
				expect(entry.metadata).toBeUndefined();
				expect(entry.producedBy).toBeUndefined();
				expect(entry.planLockHash).toBeUndefined();
				expect(entry.workspaceLockHash).toBeUndefined();
			});

			it("should include optional fields when present", () => {
				const entry = makeEvidenceEntry("EV-001", {
					producedBy: "WS-01",
					planLockHash: "plan-hash",
					workspaceLockHash: "ws-hash",
					metadata: { key: "val" },
				});
				const snapshot = makeLedgerSnapshot("P44.01", [entry]);
				const exportData = buildEvidenceLedgerExport(snapshot, { metadata: { phase: "P44" } });
				const json = toEvidenceLedgerJSON(exportData);

				expect(json.metadata).toEqual({ phase: "P44" });
				const jsonEntry = (json.entries as Array<Record<string, unknown>>)[0];
				expect(jsonEntry.producedBy).toBe("WS-01");
				expect(jsonEntry.planLockHash).toBe("plan-hash");
				expect(jsonEntry.workspaceLockHash).toBe("ws-hash");
				expect(jsonEntry.metadata).toEqual({ key: "val" });
			});
		});

		describe("toMutationReportJSON", () => {
			it("should serialize mutation report export to JSON", () => {
				const reports = [makeMutationReport("src/main.ts")];
				const exportData = buildMutationReportExport(reports);
				const json = toMutationReportJSON(exportData);

				expect(json.schemaVersion).toBe(P45_EVIDENCE_MUTATION_SCHEMA_VERSION);
				expect(json.totalMutations).toBe(1);
				expect(json.reports).toHaveLength(1);
				expect(json.summary).toBeDefined();
				expect((json.reports as Array<Record<string, unknown>>)[0].path).toBe("src/main.ts");
			});

			it("should include planExecId and metadata when present", () => {
				const reports = [makeMutationReport("src/main.ts")];
				const exportData = buildMutationReportExport(reports, {
					planExecId: "plan-001",
					metadata: { key: "val" },
				});
				const json = toMutationReportJSON(exportData);

				expect(json.planExecId).toBe("plan-001");
				expect(json.metadata).toEqual({ key: "val" });
			});

			it("should omit optional fields when not set", () => {
				const reports = [makeMutationReport("src/main.ts")];
				const exportData = buildMutationReportExport(reports);
				const json = toMutationReportJSON(exportData);

				expect(json.planExecId).toBeUndefined();
				expect(json.metadata).toBeUndefined();
			});

			it("should include null fields in mutation reports", () => {
				const report = makeMutationReport("src/main.ts", {
					blockReason: null,
					rollbackReason: null,
					editRecoveryStrategy: null,
				});
				const exportData = buildMutationReportExport([report]);
				const json = toMutationReportJSON(exportData);
				const jsonReport = (json.reports as Array<Record<string, unknown>>)[0];

				expect(jsonReport.blockReason).toBeNull();
				expect(jsonReport.rollbackReason).toBeNull();
				expect(jsonReport.editRecoveryStrategy).toBeNull();
			});
		});

		describe("serializeEvidenceLedgerExport", () => {
			it("should produce parseable JSON string", () => {
				const entries = [makeEvidenceEntry("EV-001")];
				const snapshot = makeLedgerSnapshot("P44.01", entries);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const jsonStr = serializeEvidenceLedgerExport(exportData);
				const parsed = JSON.parse(jsonStr);

				expect(parsed.scopeId).toBe("P44.01");
				expect(parsed.total).toBe(1);
				expect(parsed.entries).toHaveLength(1);
			});

			it("should produce valid JSON for empty ledger", () => {
				const snapshot = makeLedgerSnapshot("P44.01", []);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const jsonStr = serializeEvidenceLedgerExport(exportData);
				const parsed = JSON.parse(jsonStr);

				expect(parsed.total).toBe(0);
				expect(parsed.entries).toEqual([]);
			});
		});

		describe("serializeMutationReportExport", () => {
			it("should produce parseable JSON string", () => {
				const reports = [makeMutationReport("src/main.ts")];
				const exportData = buildMutationReportExport(reports);
				const jsonStr = serializeMutationReportExport(exportData);
				const parsed = JSON.parse(jsonStr);

				expect(parsed.totalMutations).toBe(1);
				expect(parsed.reports).toHaveLength(1);
			});

			it("should produce valid JSON for empty report array", () => {
				const exportData = buildMutationReportExport([]);
				const jsonStr = serializeMutationReportExport(exportData);
				const parsed = JSON.parse(jsonStr);

				expect(parsed.totalMutations).toBe(0);
				expect(parsed.reports).toEqual([]);
			});
		});
	});

	describe("Markdown Formatting", () => {
		describe("formatEvidenceLedgerReport", () => {
			it("should format evidence ledger as Markdown report", () => {
				const entries = [makeEvidenceEntry("EV-001")];
				const snapshot = makeLedgerSnapshot("P44.01", entries);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const md = formatEvidenceLedgerReport(exportData);

				expect(md).toContain("# Evidence Ledger Export");
				expect(md).toContain("P44.01");
				expect(md).toContain("EV-001");
				expect(md).toContain("Pass Rate");
				expect(md).toContain("100.0%");
			});

			it("should handle empty ledger in Markdown", () => {
				const snapshot = makeLedgerSnapshot("P44.01", []);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const md = formatEvidenceLedgerReport(exportData);

				expect(md).toContain("# Evidence Ledger Export");
				expect(md).toContain("P44.01");
				expect(md).toContain("No evidence entries");
			});

			it("should include by-type, by-verdict, by-confidence sections", () => {
				const entries = [
					makeEvidenceEntry("EV-001", { type: "test_run", verdict: "pass", confidence: "high" }),
					makeEvidenceEntry("EV-002", { type: "source_file", verdict: "fail", confidence: "medium" }),
				];
				const snapshot = makeLedgerSnapshot("P44.01", entries);
				const exportData = buildEvidenceLedgerExport(snapshot);
				const md = formatEvidenceLedgerReport(exportData);

				expect(md).toContain("By Type");
				expect(md).toContain("test_run");
				expect(md).toContain("source_file");
				expect(md).toContain("By Verdict");
				expect(md).toContain("By Confidence");
			});
		});

		describe("formatMutationReportReport", () => {
			it("should format mutation report as Markdown", () => {
				const reports = [makeMutationReport("src/main.ts")];
				const exportData = buildMutationReportExport(reports, { planExecId: "plan-001" });
				const md = formatMutationReportReport(exportData);

				expect(md).toContain("# Mutation Report Export");
				expect(md).toContain("plan-001");
				expect(md).toContain("src/main.ts");
				expect(md).toContain("Total Mutations");
				expect(md).toContain("Passed");
				expect(md).toContain("Blocked");
				expect(md).toContain("Rolled Back");
			});

			it("should handle empty reports in Markdown", () => {
				const exportData = buildMutationReportExport([]);
				const md = formatMutationReportReport(exportData);

				expect(md).toContain("# Mutation Report Export");
				expect(md).toContain("No mutation reports");
				expect(md).toContain("Total Mutations | 0 |");
			});

			it("should include by-mode and by-safety-level sections", () => {
				const reports = [
					makeMutationReport("src/a.ts", { mode: "edit", safetyLevel: "safe" }),
					makeMutationReport("src/b.ts", { mode: "create", safetyLevel: "guarded" }),
				];
				const exportData = buildMutationReportExport(reports);
				const md = formatMutationReportReport(exportData);

				expect(md).toContain("By Mode");
				expect(md).toContain("edit");
				expect(md).toContain("create");
				expect(md).toContain("By Safety Level");
				expect(md).toContain("safe");
				expect(md).toContain("guarded");
			});

			it("should include blocked and rollback details when present", () => {
				const reports = [
					makeMutationReport("src/a.ts", {
						blocked: true,
						blockReason: "Write set violation",
						rolledBack: true,
						rollbackReason: "Parser failure",
						editRecoveryStrategy: "exact",
					}),
				];
				const exportData = buildMutationReportExport(reports);
				const md = formatMutationReportReport(exportData);

				expect(md).toContain("Write set violation");
				expect(md).toContain("Parser failure");
				expect(md).toContain("exact");
			});
		});
	});

	describe("Constants", () => {
		it("should have correct schema version", () => {
			expect(P45_EVIDENCE_MUTATION_SCHEMA_VERSION).toBe("1.0.0");
		});

		it("should have correct default evidence ledger path", () => {
			expect(DEFAULT_EVIDENCE_LEDGER_PATH).toBe("reports/p44-verified-completion/evidence-ledger-export.json");
		});

		it("should have correct default mutation report path", () => {
			expect(DEFAULT_MUTATION_REPORT_PATH).toBe("reports/p44-verified-completion/mutation-report.json");
		});
	});
});
