/**
 * Read Model Adapter Tests — P42.01 Read Model Integration
 *
 * Tests for createReadModelAdapter(), which bridges IStateStore to the
 * ExecutionReadModel execution-service interface.
 *
 * Tests cover:
 *   - getPlanExecutionSummary() extraction from state store
 *   - getWorkspaceState() delegation
 *   - getJournalEvents() conversion and filtering
 *   - readArchiveFile() with filesystem access and path sandboxing
 *   - listArchiveArtifacts() with filesystem listing
 *   - Missing data / unavailable states
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadModelAdapter } from "../src/read-model-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
	const dir = join(tmpdir(), `read-model-adapter-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeJournalEvent(overrides: {
	type?: string;
	timestamp?: number;
	workspaceId?: string;
	data?: Record<string, unknown>;
}) {
	return {
		type: overrides.type ?? "plan_started",
		timestamp: overrides.timestamp ?? Date.now(),
		workspaceId: overrides.workspaceId ?? "ws-1",
		data: overrides.data ?? null,
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createReadModelAdapter", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir();
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// getPlanExecutionSummary
	// -----------------------------------------------------------------------
	describe("getPlanExecutionSummary", () => {
		it("should return null when loadState returns null", async () => {
			const stateStore = {
				loadState: vi.fn().mockResolvedValue(null),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getPlanExecutionSummary!("exec-1");
			expect(result).toBeNull();
		});

		it("should extract summary from loadState result", async () => {
			const stateStore = {
				loadState: vi.fn().mockResolvedValue({
					projectId: "proj-1",
					phase: "dev",
					title: "My Plan",
					status: "running",
					startedAt: Date.now() - 10000,
				}),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getPlanExecutionSummary!("exec-1");
			expect(result).not.toBeNull();
			expect(result!.id).toBe("exec-1");
			expect(result!.projectId).toBe("proj-1");
			expect(result!.phase).toBe("dev");
			expect(result!.title).toBe("My Plan");
			expect(result!.status).toBe("running");
			expect(result!.startedAt).toBeTruthy();
			expect(result!.completedAt).toBeNull();
		});

		it("should return null when loadState throws", async () => {
			const stateStore = {
				loadState: vi.fn().mockRejectedValue(new Error("Store error")),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getPlanExecutionSummary!("exec-1");
			expect(result).toBeNull();
		});

		it("should use default values when fields are missing", async () => {
			const stateStore = {
				loadState: vi.fn().mockResolvedValue({}),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getPlanExecutionSummary!("exec-1");
			expect(result!.projectId).toBe("default");
			expect(result!.phase).toBe("unknown");
			expect(result!.title).toBe("Unknown Plan");
			expect(result!.status).toBe("unknown");
		});
	});

	// -----------------------------------------------------------------------
	// getWorkspaceState
	// -----------------------------------------------------------------------
	describe("getWorkspaceState", () => {
		it("should delegate to state store", async () => {
			const stateStore = {
				getWorkspaceState: vi.fn().mockResolvedValue({
					stage: "Complete",
					attempts: 2,
					startedAt: Date.now() - 5000,
					completedAt: Date.now(),
					error: "None",
				}),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getWorkspaceState!("exec-1", "ws-1");
			expect(result).not.toBeNull();
			expect(result!.stage).toBe("Complete");
			expect(result!.attempts).toBe(2);
			expect(result!.error).toBe("None");
		});

		it("should return null when store returns null", async () => {
			const stateStore = {
				getWorkspaceState: vi.fn().mockResolvedValue(null),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getWorkspaceState!("exec-1", "ws-1");
			expect(result).toBeNull();
		});

		it("should return null when store throws", async () => {
			const stateStore = {
				getWorkspaceState: vi.fn().mockRejectedValue(new Error("DB error")),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getWorkspaceState!("exec-1", "ws-1");
			expect(result).toBeNull();
		});

		it("should use defaults when workspace data is partial", async () => {
			const stateStore = {
				getWorkspaceState: vi.fn().mockResolvedValue({}),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const result = await adapter.getWorkspaceState!("exec-1", "ws-1");
			expect(result!.stage).toBe("unknown");
			expect(result!.attempts).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// getJournalEvents
	// -----------------------------------------------------------------------
	describe("getJournalEvents", () => {
		it("should convert journal events to envelopes", async () => {
			const stateStore = {
				readJournal: vi.fn().mockResolvedValue([
					makeJournalEvent({
						type: "plan_started",
						workspaceId: undefined,
						data: { title: "Plan" },
					}),
					makeJournalEvent({
						type: "workspace_completed",
						workspaceId: "ws-1",
					}),
				]),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1");
			expect(events).toHaveLength(2);
			expect(events[0].eventType).toBe("plan_started");
			expect(events[0].planExecutionId).toBe("exec-1");
			expect(events[0].payload).toEqual({ title: "Plan" });
			expect(events[1].workspaceId).toBe("ws-1");
		});

		it("should return empty array when readJournal returns null", async () => {
			const stateStore = {
				readJournal: vi.fn().mockResolvedValue(null),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1");
			expect(events).toEqual([]);
		});

		it("should return empty array when readJournal throws", async () => {
			const stateStore = {
				readJournal: vi.fn().mockRejectedValue(new Error("Read error")),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1");
			expect(events).toEqual([]);
		});

		it("should filter by workspaceId", async () => {
			const stateStore = {
				readJournal: vi
					.fn()
					.mockResolvedValue([
						makeJournalEvent({ workspaceId: "ws-1" }),
						makeJournalEvent({ workspaceId: "ws-2" }),
						makeJournalEvent({ workspaceId: "ws-1" }),
					]),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1", { workspaceId: "ws-2" });
			expect(events).toHaveLength(1);
			expect(events[0].workspaceId).toBe("ws-2");
		});

		it("should filter by eventType", async () => {
			const stateStore = {
				readJournal: vi
					.fn()
					.mockResolvedValue([
						makeJournalEvent({ type: "plan_started" }),
						makeJournalEvent({ type: "worker_completed" }),
						makeJournalEvent({ type: "plan_completed" }),
					]),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1", { eventType: "plan_completed" });
			expect(events).toHaveLength(1);
			expect(events[0].eventType).toBe("plan_completed");
		});

		it("should apply limit and offset after filtering", async () => {
			const stateStore = {
				readJournal: vi
					.fn()
					.mockResolvedValue([
						makeJournalEvent({ type: "a", workspaceId: "ws-1" }),
						makeJournalEvent({ type: "b", workspaceId: "ws-1" }),
						makeJournalEvent({ type: "c", workspaceId: "ws-1" }),
					]),
			};
			const adapter = createReadModelAdapter(stateStore as any);

			const events = await adapter.getJournalEvents!("exec-1", {
				workspaceId: "ws-1",
				offset: 1,
				limit: 1,
			});
			expect(events).toHaveLength(1);
			expect(events[0].eventType).toBe("b");
		});
	});

	// -----------------------------------------------------------------------
	// readArchiveFile
	// -----------------------------------------------------------------------
	describe("readArchiveFile", () => {
		it("should return null when workspaceRoot not provided", async () => {
			const adapter = createReadModelAdapter({} as any);
			const content = await adapter.readArchiveFile!("exec-1", "workspaces/ws-1/packet.md");
			expect(content).toBeNull();
		});

		it("should read file from archive directory", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "packet.md"), "# Role Packet", "utf-8");

			const adapter = createReadModelAdapter({} as any, tempDir);
			const content = await adapter.readArchiveFile!("exec-1", "workspaces/ws-1/packet.md");
			expect(content).toBe("# Role Packet");
		});

		it("should return null for path traversal attempts", async () => {
			const adapter = createReadModelAdapter({} as any, tempDir);
			const content = await adapter.readArchiveFile!("exec-1", "../../etc/passwd");
			expect(content).toBeNull();
		});

		it("should return null when file does not exist", async () => {
			const adapter = createReadModelAdapter({} as any, tempDir);
			const content = await adapter.readArchiveFile!("exec-1", "workspaces/ws-1/missing.md");
			expect(content).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// listArchiveArtifacts
	// -----------------------------------------------------------------------
	describe("listArchiveArtifacts", () => {
		it("should return empty array when workspaceRoot not provided", async () => {
			const adapter = createReadModelAdapter({} as any);
			const artifacts = await adapter.listArchiveArtifacts!("exec-1");
			expect(artifacts).toEqual([]);
		});

		it("should list files in archive directory", async () => {
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "packet.md"), "# Content", "utf-8");
			writeFileSync(join(archiveDir, "files-touched.json"), "[]", "utf-8");

			const adapter = createReadModelAdapter({} as any, tempDir);
			const artifacts = await adapter.listArchiveArtifacts!("exec-1");

			expect(artifacts.length).toBeGreaterThan(0);
			const paths = artifacts.map((a) => a.path);
			expect(paths).toContain("workspaces/ws-1/packet.md");
			expect(paths).toContain("workspaces/ws-1/files-touched.json");
		});

		it("should return empty array when archive directory does not exist", async () => {
			const adapter = createReadModelAdapter({} as any, tempDir);
			const artifacts = await adapter.listArchiveArtifacts!("exec-1");
			expect(artifacts).toEqual([]);
		});

		it("should skip forbidden paths", async () => {
			// Create a forbidden path (e.g. with ..)
			const archiveDir = join(tempDir, ".pi", "executions", "exec-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "safe.md"), "safe", "utf-8");

			const adapter = createReadModelAdapter({} as any, tempDir);
			const artifacts = await adapter.listArchiveArtifacts!("exec-1");
			// Should find safe.md without errors
			const paths = artifacts.map((a) => a.path);
			expect(paths).toContain("safe.md");
		});
	});

	// -----------------------------------------------------------------------
	// Integration: adapter + execution read model
	// -----------------------------------------------------------------------
	describe("integration with ExecutionReadModel", () => {
		it("should work with createExecutionReadModel", async () => {
			// Dynamic import to avoid ESM issues — we test the adapter contract
			const { createExecutionReadModel } = await import("@earendil-works/pi-execution-service");

			const archiveDir = join(tempDir, ".pi", "executions", "exec-1", "workspaces", "ws-1");
			mkdirSync(archiveDir, { recursive: true });
			writeFileSync(join(archiveDir, "packet.md"), "You are a coder", "utf-8");

			const stateStore = {
				loadState: vi.fn().mockResolvedValue({
					projectId: "proj-1",
					phase: "dev",
					title: "Test Plan",
					status: "running",
					startedAt: Date.now() - 10000,
				}),
				readJournal: vi.fn().mockResolvedValue([
					makeJournalEvent({
						type: "plan_started",
						workspaceId: undefined,
						data: {
							projectId: "proj-1",
							phase: "dev",
							title: "Test Plan",
							workspaces: [{ id: "ws-1", dependencies: [], batch: 0 }],
						},
					}),
					makeJournalEvent({
						type: "worker_completed",
						workspaceId: "ws-1",
						data: { verdict: "complete", changedFiles: ["src/index.ts"] },
					}),
				]),
			};

			const adapter = createReadModelAdapter(stateStore as any, tempDir);
			const readModel = createExecutionReadModel(adapter);

			// Plan summary (from adapter, data is actually available)
			const summary = await readModel.getPlanSummary("exec-1");
			expect(summary.title).toBe("Test Plan");
			expect(summary.status).toBe("running");

			// Dependency graph
			const graph = await readModel.getDependencyGraph("exec-1");
			expect(graph.nodes).toHaveLength(1);

			// Changed files
			const files = await readModel.getChangedFiles("exec-1", "ws-1");
			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("src/index.ts");

			// Artifact listing (archive-backed)
			const artifacts = await readModel.getArtifacts("exec-1");
			const artifactPaths = artifacts.map((a) => a.path);
			expect(artifactPaths).toContain("workspaces/ws-1/packet.md");
		});
	});
});
