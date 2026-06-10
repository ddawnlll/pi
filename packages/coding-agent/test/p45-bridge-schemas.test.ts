/**
 * P45.B1 — Accepted WriteSet Export and Ownership Summary Tests
 *
 * Tests verify:
 * - AcceptedWriteSet type construction
 * - OwnershipSummary type construction
 * - buildAcceptedWriteSet from WorkspaceWriteSet data
 * - buildOwnershipSummary from multiple write sets
 * - Shared/unclaimed file detection
 * - JSON report generation
 * - Markdown report formatting
 * - Schema version and metadata propagation
 */

import { describe, expect, it } from "vitest";
import {
	buildAcceptedWriteSet,
	buildOwnershipSummary,
	formatAcceptedWriteSetReport,
	formatOwnershipSummaryReport,
	P45_BRIDGE_SCHEMA_VERSION,
	serializeAcceptedWriteSet,
	serializeOwnershipSummary,
	toAcceptedWriteSetJSON,
	toOwnershipSummaryJSON,
} from "../src/core/completion/p45-bridge-exporter.js";
import type { CompletionCommitGateResult } from "../src/core/completion/workspace-commit-gate.js";
import type { WorkspaceWriteSet, WriteSetFileEntry } from "../src/core/completion/workspace-write-set.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWriteSetFile(
	path: string,
	status: WriteSetFileEntry["status"] = "unchanged",
	declared = true,
): WriteSetFileEntry {
	return { path, status, size: 100, declared };
}

function makeWorkspaceWriteSet(
	workspaceId: string,
	planExecId: string,
	files: WriteSetFileEntry[],
	declaredPatterns: string[] = [],
	artifactPatterns: string[] = [],
): WorkspaceWriteSet {
	return {
		workspaceId,
		planExecId,
		declaredPatterns,
		artifactPatterns,
		files,
	};
}

function makeGateResult(allowedFiles: string[]): CompletionCommitGateResult {
	return {
		passed: true,
		blockReasons: [],
		rawResult: {
			allowed: true,
			stagedFiles: allowedFiles,
			unstagedModifiedFiles: [],
			unexpectedStagedFiles: [],
			unexpectedModifiedFiles: [],
			allowedFiles,
			blockedCommands: [],
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P45.B1 — Accepted WriteSet Export and Ownership Summary", () => {
	describe("AcceptedWriteSet — buildAcceptedWriteSet", () => {
		it("should build an accepted write set from a WorkspaceWriteSet", () => {
			const files: WriteSetFileEntry[] = [
				makeWriteSetFile("src/main.ts", "modified"),
				makeWriteSetFile("src/utils.ts", "unchanged"),
				makeWriteSetFile("src/new.ts", "created"),
			];

			const ws = makeWorkspaceWriteSet("P44.01", "plan-001", files, ["src/**"]);
			const accepted = buildAcceptedWriteSet(ws);

			expect(accepted.schemaVersion).toBe(P45_BRIDGE_SCHEMA_VERSION);
			expect(accepted.workspaceId).toBe("P44.01");
			expect(accepted.planExecId).toBe("plan-001");
			expect(accepted.acceptedAt).toBeGreaterThan(0);
			// Should include declared or changed files (sorted)
			expect(accepted.acceptedFiles).toEqual(["src/main.ts", "src/new.ts", "src/utils.ts"]);
			expect(accepted.changedFiles).toEqual(["src/main.ts", "src/new.ts"]);
			expect(accepted.declaredPatterns).toEqual(["src/**"]);
		});

		it("should intersect with gate result allowed files when provided", () => {
			const files: WriteSetFileEntry[] = [
				makeWriteSetFile("src/main.ts", "modified"),
				makeWriteSetFile("src/blocked.ts", "modified"),
			];

			const ws = makeWorkspaceWriteSet("P44.01", "plan-001", files, ["src/**"]);
			const gateResult = makeGateResult(["src/main.ts"]);
			const accepted = buildAcceptedWriteSet(ws, gateResult);

			expect(accepted.acceptedFiles).toEqual(["src/main.ts"]);
			expect(accepted.changedFiles).toEqual(["src/blocked.ts", "src/main.ts"]);
		});

		it("should propagate lock hash and metadata", () => {
			const ws = makeWorkspaceWriteSet("P44.02", "plan-002", []);
			const lockHash = "abc123def456";
			const metadata = { source: "test" };

			const accepted = buildAcceptedWriteSet(ws, undefined, { lockHash, metadata });

			expect(accepted.lockHash).toBe(lockHash);
			expect(accepted.metadata).toEqual(metadata);
		});

		it("should handle empty write set", () => {
			const ws = makeWorkspaceWriteSet("P44.03", "plan-003", []);
			const accepted = buildAcceptedWriteSet(ws);

			expect(accepted.acceptedFiles).toEqual([]);
			expect(accepted.changedFiles).toEqual([]);
			expect(accepted.declaredPatterns).toEqual([]);
			expect(accepted.workspaceId).toBe("P44.03");
		});

		it("should exclude files not declared and not changed", () => {
			const files: WriteSetFileEntry[] = [
				makeWriteSetFile("src/unchanged.ts", "unchanged", true),
				makeWriteSetFile("src/unexpected.ts", "unchanged", false),
			];

			const ws = makeWorkspaceWriteSet("P44.04", "plan-004", files, ["src/unchanged.ts"]);
			const accepted = buildAcceptedWriteSet(ws);

			// Only declared or changed files are included
			expect(accepted.acceptedFiles).toEqual(["src/unchanged.ts"]);
		});
	});

	describe("OwnershipSummary — buildOwnershipSummary", () => {
		it("should build ownership summary from multiple accepted write sets", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [
					makeWriteSetFile("src/a.ts", "modified"),
					makeWriteSetFile("src/b.ts", "modified"),
				]),
			);

			const ws2 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-2", "plan-001", [makeWriteSetFile("src/c.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1, ws2]);

			expect(summary.schemaVersion).toBe(P45_BRIDGE_SCHEMA_VERSION);
			expect(summary.planExecId).toBe("plan-001");
			expect(summary.statistics.totalWorkspaces).toBe(2);
			expect(summary.statistics.totalOwnedFiles).toBe(3);
			expect(summary.ownership).toHaveLength(2);

			const entry1 = summary.ownership.find((e) => e.workspaceId === "WS-1")!;
			expect(entry1).toBeDefined();
			expect(entry1.fileCount).toBe(2);
			expect(entry1.ownedFiles).toEqual(["src/a.ts", "src/b.ts"]);

			const entry2 = summary.ownership.find((e) => e.workspaceId === "WS-2")!;
			expect(entry2).toBeDefined();
			expect(entry2.fileCount).toBe(1);
			expect(entry2.ownedFiles).toEqual(["src/c.ts"]);
		});

		it("should detect shared files when multiple workspaces claim the same file", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("shared.ts", "modified")]),
			);

			const ws2 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-2", "plan-001", [makeWriteSetFile("shared.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1, ws2]);

			expect(summary.sharedOrUnclaimedFiles).toContain("shared.ts");
			expect(summary.statistics.totalSharedOrUnclaimed).toBeGreaterThanOrEqual(1);
		});

		it("should report unclaimed files from allTrackedFiles", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("src/a.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1], ["src/a.ts", "src/unclaimed.ts", "src/other.ts"]);

			expect(summary.sharedOrUnclaimedFiles).toContain("src/unclaimed.ts");
			expect(summary.sharedOrUnclaimedFiles).toContain("src/other.ts");
			expect(summary.sharedOrUnclaimedFiles).not.toContain("src/a.ts");
		});

		it("should compute mean files per workspace", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [
					makeWriteSetFile("a.ts", "modified"),
					makeWriteSetFile("b.ts", "modified"),
				]),
			);

			const ws2 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-2", "plan-001", [
					makeWriteSetFile("c.ts", "modified"),
					makeWriteSetFile("d.ts", "modified"),
					makeWriteSetFile("e.ts", "modified"),
				]),
			);

			const summary = buildOwnershipSummary([ws1, ws2]);

			expect(summary.statistics.meanFilesPerWorkspace).toBe(2.5);
		});

		it("should handle empty write sets array", () => {
			const summary = buildOwnershipSummary([]);

			expect(summary.ownership).toEqual([]);
			expect(summary.statistics.totalWorkspaces).toBe(0);
			expect(summary.statistics.totalOwnedFiles).toBe(0);
			expect(summary.statistics.meanFilesPerWorkspace).toBe(0);
			expect(summary.sharedOrUnclaimedFiles).toEqual([]);
		});

		it("should propagate metadata", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("a.ts", "modified")]),
			);

			const metadata = { phase: "P44", wave: "W7" };
			const summary = buildOwnershipSummary([ws1], undefined, { metadata });

			expect(summary.metadata).toEqual(metadata);
		});

		it("should sort ownership entries by workspace ID", () => {
			const wsB = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("B", "plan-001", [makeWriteSetFile("b.ts", "modified")]),
			);

			const wsA = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("A", "plan-001", [makeWriteSetFile("a.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([wsB, wsA]);

			expect(summary.ownership[0].workspaceId).toBe("A");
			expect(summary.ownership[1].workspaceId).toBe("B");
		});
	});

	describe("JSON Serialization", () => {
		it("should serialize AcceptedWriteSet to JSON", () => {
			const ws = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("P44.01", "plan-001", [makeWriteSetFile("src/main.ts", "modified")]),
			);

			const json = toAcceptedWriteSetJSON(ws);
			expect(json.schemaVersion).toBe(P45_BRIDGE_SCHEMA_VERSION);
			expect(json.workspaceId).toBe("P44.01");
			expect(json.acceptedFiles).toEqual(["src/main.ts"]);
		});

		it("should omit optional fields when not set in JSON", () => {
			const ws = buildAcceptedWriteSet(makeWorkspaceWriteSet("P44.01", "plan-001", []));

			const json = toAcceptedWriteSetJSON(ws);
			expect(json.lockHash).toBeUndefined();
			expect(json.metadata).toBeUndefined();
		});

		it("should serialize OwnershipSummary to JSON", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("a.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1]);
			const json = toOwnershipSummaryJSON(summary);

			expect(json.schemaVersion).toBe(P45_BRIDGE_SCHEMA_VERSION);
			expect(json.ownership).toHaveLength(1);
			expect(json.statistics).toBeDefined();
			expect((json.ownership as Array<Record<string, unknown>>)[0].workspaceId).toBe("WS-1");
		});

		it("should produce parseable JSON strings", () => {
			const ws = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("P44.01", "plan-001", [makeWriteSetFile("src/main.ts", "modified")]),
			);

			const jsonStr = serializeAcceptedWriteSet(ws);
			const parsed = JSON.parse(jsonStr);
			expect(parsed.workspaceId).toBe("P44.01");
			expect(parsed.acceptedFiles).toEqual(["src/main.ts"]);
		});

		it("should produce parseable JSON strings for ownership summary", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("a.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1]);
			const jsonStr = serializeOwnershipSummary(summary);
			const parsed = JSON.parse(jsonStr);
			expect(parsed.ownership).toHaveLength(1);
			expect(parsed.statistics.totalWorkspaces).toBe(1);
		});
	});

	describe("Markdown Formatting", () => {
		it("should format AcceptedWriteSet as Markdown report", () => {
			const ws = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("P44.01", "plan-001", [makeWriteSetFile("src/main.ts", "modified")]),
			);

			const md = formatAcceptedWriteSetReport(ws);
			expect(md).toContain("# Accepted WriteSet Report");
			expect(md).toContain("P44.01");
			expect(md).toContain("`src/main.ts`");
			expect(md).toContain("plan-001");
		});

		it("should handle empty accepted write set in Markdown", () => {
			const ws = buildAcceptedWriteSet(makeWorkspaceWriteSet("P44.01", "plan-001", []));

			const md = formatAcceptedWriteSetReport(ws);
			expect(md).toContain("No accepted files");
		});

		it("should include lock hash in Markdown when present", () => {
			const ws = buildAcceptedWriteSet(makeWorkspaceWriteSet("P44.01", "plan-001", []), undefined, {
				lockHash: "abc123",
			});

			const md = formatAcceptedWriteSetReport(ws);
			expect(md).toContain("abc123");
			expect(md).toContain("Lock Hash");
		});

		it("should format OwnershipSummary as Markdown report", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [
					makeWriteSetFile("src/a.ts", "modified"),
					makeWriteSetFile("src/b.ts", "modified"),
				]),
			);

			const summary = buildOwnershipSummary([ws1]);
			const md = formatOwnershipSummaryReport(summary);

			expect(md).toContain("# Ownership Summary");
			expect(md).toContain("WS-1");
			expect(md).toContain("2 files");
			expect(md).toContain("`src/a.ts`");
			expect(md).toContain("`src/b.ts`");
			expect(md).toContain("Statistics");
			expect(md).toContain("Total Owned Files");
		});

		it("should include shared/unclaimed files section when present", () => {
			const ws1 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-1", "plan-001", [makeWriteSetFile("shared.ts", "modified")]),
			);

			const ws2 = buildAcceptedWriteSet(
				makeWorkspaceWriteSet("WS-2", "plan-001", [makeWriteSetFile("shared.ts", "modified")]),
			);

			const summary = buildOwnershipSummary([ws1, ws2]);
			const md = formatOwnershipSummaryReport(summary);

			expect(md).toContain("Shared / Unclaimed Files");
			expect(md).toContain("`shared.ts`");
		});
	});
});
