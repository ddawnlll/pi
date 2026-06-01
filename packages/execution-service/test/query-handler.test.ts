/**
 * Query Handler Tests — P41.06 File Tree Read Model
 */
import { describe, expect, it } from "vitest";
import { createExecutionReadModel } from "../src/query-handler.js";

describe("createExecutionReadModel", () => {
	describe("getChangedFiles", () => {
		it("should return empty array when no journal events exist", async () => {
			const model = createExecutionReadModel({});
			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toEqual([]);
		});

		it("should extract changed files from worker_completed events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: {
							changedFiles: ["src/index.ts", "README.md"],
						},
						createdAt: new Date().toISOString(),
					},
				],
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");

			expect(files).toHaveLength(2);
			expect(files[0]).toMatchObject({
				path: "README.md",
				name: "README.md",
				ext: "md",
				status: "modified",
			});
			expect(files[1]).toMatchObject({
				path: "src/index.ts",
				name: "index.ts",
				ext: "ts",
				status: "modified",
			});
		});

		it("should filter by workspace ID", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async (planExecId, options) => {
					// Verify the query includes workspaceId filter
					expect(options?.workspaceId).toBe("ws-1");
					expect(options?.eventType).toBe("worker_completed");
					return [
						{
							seq: "1",
							eventId: "evt-1",
							planExecutionId: planExecId,
							workspaceId: "ws-1",
							eventType: "worker_completed",
							payload: { changedFiles: ["src/main.ts"] },
							createdAt: new Date().toISOString(),
						},
					];
				},
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("src/main.ts");
		});

		it("should deduplicate files across multiple events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: { changedFiles: ["src/index.ts", "README.md"] },
						createdAt: new Date().toISOString(),
					},
					{
						seq: "2",
						eventId: "evt-2",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: { changedFiles: ["src/index.ts", "src/lib.ts"] },
						createdAt: new Date().toISOString(),
					},
				],
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toHaveLength(3);
			expect(files.map((f) => f.path).sort()).toEqual(["README.md", "src/index.ts", "src/lib.ts"]);
		});

		it("should ignore non-worker_completed events", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "plan_started",
						payload: null,
						createdAt: new Date().toISOString(),
					},
					{
						seq: "2",
						eventId: "evt-2",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_started",
						payload: null,
						createdAt: new Date().toISOString(),
					},
				],
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toEqual([]);
		});

		it("should handle missing payload gracefully", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: null,
						createdAt: new Date().toISOString(),
					},
				],
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toEqual([]);
		});

		it("should handle missing changedFiles in payload", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: { verdict: "complete" },
						createdAt: new Date().toISOString(),
					},
				],
			});

			const files = await model.getChangedFiles("exec-1", "ws-1");
			expect(files).toEqual([]);
		});
	});

	describe("getFileTree", () => {
		it("should return empty array when no files changed", async () => {
			const model = createExecutionReadModel({});
			const tree = await model.getFileTree("exec-1", "ws-1");
			expect(tree).toEqual([]);
		});

		it("should build a hierarchical tree from changed files", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: { changedFiles: ["src/index.ts", "README.md"] },
						createdAt: new Date().toISOString(),
					},
				],
			});

			const tree = await model.getFileTree("exec-1", "ws-1");

			expect(tree).toHaveLength(2);

			// First: src (directory, root level)
			expect(tree[0].isDir).toBe(true);
			expect(tree[0].path).toBe("src");

			// Second: README.md (file, root level)
			expect(tree[1].isDir).toBe(false);
			expect(tree[1].path).toBe("README.md");

			// src contains index.ts
			expect(tree[0].children).toHaveLength(1);
			expect(tree[0].children![0].path).toBe("src/index.ts");
		});

		it("should return flat list when flat option is true", async () => {
			const model = createExecutionReadModel({
				getJournalEvents: async () => [
					{
						seq: "1",
						eventId: "evt-1",
						planExecutionId: "exec-1",
						workspaceId: "ws-1",
						eventType: "worker_completed",
						payload: { changedFiles: ["src/index.ts", "src/utils/helper.ts"] },
						createdAt: new Date().toISOString(),
					},
				],
			});

			const tree = await model.getFileTree("exec-1", "ws-1", { flat: true });

			// Flat list should only contain file entries (no directories)
			expect(tree).toHaveLength(2);
			tree.forEach((node) => {
				expect(node.isDir).toBe(false);
			});
			expect(tree[0].path).toBe("src/index.ts");
			expect(tree[1].path).toBe("src/utils/helper.ts");
		});
	});

	describe("getFileContent", () => {
		it("should return null (default implementation)", async () => {
			const model = createExecutionReadModel({});
			const content = await model.getFileContent("exec-1", "ws-1", "src/index.ts");
			expect(content).toBeNull();
		});
	});

	describe("getFileDiff", () => {
		it("should return empty array (default implementation)", async () => {
			const model = createExecutionReadModel({});
			const diffs = await model.getFileDiff("exec-1", "ws-1");
			expect(diffs).toEqual([]);
		});

		it("should return empty array with specific file path", async () => {
			const model = createExecutionReadModel({});
			const diffs = await model.getFileDiff("exec-1", "ws-1", "src/index.ts");
			expect(diffs).toEqual([]);
		});
	});

	describe("existing methods are unaffected", () => {
		it("should still return default plan summary", async () => {
			const model = createExecutionReadModel({});
			const summary = await model.getPlanSummary("exec-1");
			expect(summary.id).toBe("exec-1");
			expect(summary.status).toBe("unknown");
			expect(summary.dataAvailability).toBeDefined();
			expect(summary.dataAvailability!.available).toBe(false);
		});

		it("should still return empty journal events", async () => {
			const model = createExecutionReadModel({});
			const events = await model.listJournalEvents("exec-1");
			expect(events).toEqual([]);
		});

		it("should still return default final validation status", async () => {
			const model = createExecutionReadModel({});
			const status = await model.getFinalValidationStatus("exec-1", "ws-1");
			expect(status.required).toBe(true);
			expect(status.passed).toBeNull();
		});
	});
});
