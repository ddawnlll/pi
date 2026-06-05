/**
 * P44.06 — Worker Report Contract Tests
 *
 * Tests for the WorkerReport schema, WorkerReportBuilder,
 * verdict determination, report formatting, and the
 * buildReportFromCriteria factory.
 */

import { describe, expect, it } from "vitest";
import {
	WorkerReportBuilder,
	WorkerReport,
	WorkerVerdict,
	CriterionReportItem,
	MutationSummary,
	determineVerdict,
	buildReportFromCriteria,
	formatReport,
	isReportSuccessful,
	getReportBlockingReasons,
	generateReportId,
} from "../src/core/completion/worker-report-contract.js";
import { createCriterion, AcceptanceCriterion } from "../src/core/completion/acceptance-criteria.js";
import type { EvidenceLedgerEntry } from "../src/core/completion/evidence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCriterion(id: string, status: AcceptanceCriterion["verificationStatus"]): AcceptanceCriterion {
	return createCriterion(id, `Criterion ${id}`, { verificationStatus: status });
}

function makeEvidenceEntry(id: string, verdict: EvidenceLedgerEntry["verdict"] = "pass"): EvidenceLedgerEntry {
	return {
		id,
		type: "test_run",
		description: `Evidence ${id}`,
		source: "test",
		timestamp: Date.now(),
		verdict,
		confidence: "high",
		content: "output",
		criterionIds: [id.replace("EV", "AC")],
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P44.06 — Worker Report Contract", () => {
	describe("generateReportId", () => {
		it("should generate a report ID from workspace ID", () => {
			const id = generateReportId("P44.01");
			expect(id).toMatch(/^WR-P4401-\d+$/);
		});
	});

	describe("determineVerdict", () => {
		it("should return inconclusive for empty criteria", () => {
			expect(determineVerdict([])).toBe("inconclusive");
		});

		it("should return pass if all are satisfied", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-002", description: "B", status: "satisfied", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("pass");
		});

		it("should return pass if all are satisfied or skipped", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-002", description: "B", status: "skipped", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("pass");
		});

		it("should return fail if any criterion failed", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-002", description: "B", status: "failed", evidenceIds: [], notes: "Failed" },
			];
			expect(determineVerdict(items)).toBe("fail");
		});

		it("should return inconclusive if in progress", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "in_progress", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("inconclusive");
		});

		it("should return inconclusive if unverified", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "unverified", evidenceIds: [], notes: "" },
			];
			expect(determineVerdict(items)).toBe("inconclusive");
		});
	});

	describe("WorkerReportBuilder", () => {
		it("should build a report with default values", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withSummary("Test run completed")
				.build();

			expect(report.workerId).toBe("worker-1");
			expect(report.workspaceId).toBe("P44.01");
			expect(report.planId).toBe("P44");
			expect(report.schemaVersion).toBe("1.0.0");
			expect(report.summary).toBe("Test run completed");
			expect(report.verdict).toBe("inconclusive"); // no criteria → inconclusive
		});

		it("should accept explicit verdict", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withVerdict("pass")
				.build();
			expect(report.verdict).toBe("pass");
		});

		it("should add criterion status items", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withCriterionStatus({
					id: "AC-P4401-001",
					description: "Must work",
					status: "satisfied",
					evidenceIds: ["EV-001"],
					notes: "",
				})
				.build();

			expect(report.criteriaStatus).toHaveLength(1);
			expect(report.criteriaStatus[0].id).toBe("AC-P4401-001");
		});

		it("should add multiple criterion status items at once", () => {
			const items: CriterionReportItem[] = [
				{ id: "AC-001", description: "A", status: "satisfied", evidenceIds: [], notes: "" },
				{ id: "AC-002", description: "B", status: "failed", evidenceIds: [], notes: "" },
			];
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withCriteriaStatuses(items)
				.build();

			expect(report.criteriaStatus).toHaveLength(2);
		});

		it("should set mutation summary", () => {
			const mutations: MutationSummary = {
				created: ["file1.ts"],
				modified: ["file2.ts"],
				deleted: [],
				commandsExecuted: ["npm test"],
				editCount: 3,
			};
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withMutation(mutations)
				.build();

			expect(report.mutations.created).toEqual(["file1.ts"]);
			expect(report.mutations.editCount).toBe(3);
		});

		it("should add mutation items individually", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withCreatedFile("new.ts")
				.withModifiedFile("mod.ts")
				.withDeletedFile("del.ts")
				.withExecutedCommand("npm run build")
				.withEditCount(5)
				.build();

			expect(report.mutations.created).toEqual(["new.ts"]);
			expect(report.mutations.modified).toEqual(["mod.ts"]);
			expect(report.mutations.deleted).toEqual(["del.ts"]);
			expect(report.mutations.commandsExecuted).toEqual(["npm run build"]);
			expect(report.mutations.editCount).toBe(5);
		});

		it("should set evidence summary", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withEvidenceSummary(10, 8, 2)
				.build();

			expect(report.evidenceSummary.total).toBe(10);
			expect(report.evidenceSummary.passed).toBe(8);
			expect(report.evidenceSummary.failed).toBe(2);
		});

		it("should set evidence summary from entries", () => {
			const entries = [
				makeEvidenceEntry("EV-001", "pass"),
				makeEvidenceEntry("EV-002", "pass"),
				makeEvidenceEntry("EV-003", "fail"),
			];
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withEvidenceFromEntries(entries)
				.build();

			expect(report.evidenceSummary.total).toBe(3);
			expect(report.evidenceSummary.passed).toBe(2);
			expect(report.evidenceSummary.failed).toBe(1);
		});

		it("should set custom metadata", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withMetadata({ source: "manual", version: 2 })
				.build();

			expect(report.metadata).toEqual({ source: "manual", version: 2 });
		});

		it("should auto-determine verdict from criteria", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withCriterionStatus({
					id: "AC-001",
					description: "A",
					status: "satisfied",
					evidenceIds: [],
					notes: "",
				})
				.withCriterionStatus({
					id: "AC-002",
					description: "B",
					status: "satisfied",
					evidenceIds: [],
					notes: "",
				})
				.withSummary("All good")
				.build();

			expect(report.verdict).toBe("pass");
		});
	});

	describe("buildReportFromCriteria", () => {
		it("should build a report from criteria and evidence", () => {
			const criteria = [
				makeCriterion("AC-P4401-001", "satisfied"),
				makeCriterion("AC-P4401-002", "failed"),
			];
			const evidence = [
				makeEvidenceEntry("EV-P4401-001", "pass"),
				makeEvidenceEntry("EV-P4401-002", "fail"),
			];
			const mutations: MutationSummary = {
				created: [],
				modified: ["file.ts"],
				deleted: [],
				commandsExecuted: [],
				editCount: 1,
			};

			const report = buildReportFromCriteria(
				"worker-1",
				"P44.01",
				"P44",
				criteria,
				evidence,
				mutations,
				"Completed with failures",
			);

			expect(report.workerId).toBe("worker-1");
			expect(report.workspaceId).toBe("P44.01");
			expect(report.verdict).toBe("fail");
			expect(report.criteriaStatus).toHaveLength(2);
			expect(report.evidenceSummary.total).toBe(2);
			expect(report.evidenceSummary.passed).toBe(1);
			expect(report.evidenceSummary.failed).toBe(1);
		});
	});

	describe("formatReport", () => {
		it("should format a report as a readable string", () => {
			const report = new WorkerReportBuilder("worker-1", "P44.01", "P44")
				.withCriterionStatus({
					id: "AC-P4401-001",
					description: "Works",
					status: "satisfied",
					evidenceIds: ["EV-001"],
					notes: "",
				})
				.withMutation({
					created: ["new.ts"],
					modified: [],
					deleted: [],
					commandsExecuted: [],
					editCount: 1,
				})
				.withEvidenceSummary(1, 1, 0)
				.withSummary("All good")
				.build();

			const formatted = formatReport(report);
			expect(formatted).toContain("Worker Completion Report");
			expect(formatted).toContain("P44.01");
			expect(formatted).toContain("worker-1");
			expect(formatted).toContain("PASS");
			expect(formatted).toContain("All good");
		});
	});

	describe("isReportSuccessful", () => {
		it("should return true for pass verdict", () => {
			const report = new WorkerReportBuilder("w", "ws", "p").withVerdict("pass").build();
			expect(isReportSuccessful(report)).toBe(true);
		});

		it("should return false for non-pass verdicts", () => {
			const fail = new WorkerReportBuilder("w", "ws", "p").withVerdict("fail").build();
			const inc = new WorkerReportBuilder("w", "ws", "p").withVerdict("inconclusive").build();
			expect(isReportSuccessful(fail)).toBe(false);
			expect(isReportSuccessful(inc)).toBe(false);
		});
	});

	describe("getReportBlockingReasons", () => {
		it("should return reasons from failed criteria", () => {
			const report = new WorkerReportBuilder("w", "P44.01", "P44")
				.withCriterionStatus({
					id: "AC-001",
					description: "Failed test",
					status: "failed",
					evidenceIds: [],
					notes: "Did not pass",
				})
				.withCriterionStatus({
					id: "AC-002",
					description: "Unverified",
					status: "unverified",
					evidenceIds: [],
					notes: "",
				})
				.build();

			const reasons = getReportBlockingReasons(report);
			expect(reasons).toHaveLength(3); // workspace fail + criterion fail + unverified
			expect(reasons[0]).toContain("P44.01");
			expect(reasons[1]).toContain("AC-001");
			expect(reasons[2]).toContain("AC-002");
		});

		it("should return empty for successful report", () => {
			const report = new WorkerReportBuilder("w", "ws", "p")
				.withVerdict("pass")
				.build();
			expect(getReportBlockingReasons(report)).toHaveLength(0);
		});
	});
});
