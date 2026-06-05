/**
 * Worker Transcript Capture tests — P41.04
 *
 * Tests covering:
 * - sanitizeTranscriptData: stripping private keys, nested objects, empty results
 * - createWorkerTranscriptEvent: factory with filtering
 * - buildTranscriptSummary: human-readable summaries
 * - InMemoryWorkerTranscriptStore: CRUD operations
 * - IWorkerTranscriptStore contract (shared behavior across implementations)
 * - RuntimeEventEmitter transcript integration
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../src/event-store.js";
import { RuntimeEventEmitter } from "../src/runtime-emitter.js";
import {
	buildTranscriptSummary,
	createWorkerTranscriptEvent,
	InMemoryWorkerTranscriptStore,
	type IWorkerTranscriptStore,
	type JournalEvent,
	PRIVATE_DATA_KEYS,
	sanitizeTranscriptData,
	type WorkerTranscriptEvent,
	type WorkerTranscriptEventType,
} from "../src/worker-transcript.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranscriptEvent(
	overrides: Partial<WorkerTranscriptEvent> & {
		type: WorkerTranscriptEventType;
		workspaceId: string;
	},
): WorkerTranscriptEvent {
	return {
		timestamp: Date.now(),
		summary: "test event",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// PRIVATE_DATA_KEYS
// ---------------------------------------------------------------------------

describe("PRIVATE_DATA_KEYS", () => {
	it("should contain all expected private keys", () => {
		expect(PRIVATE_DATA_KEYS.has("thinking")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("thinkingContent")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("chainOfThought")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("rawThinking")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("privateReasoning")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("internalMonologue")).toBe(true);
		expect(PRIVATE_DATA_KEYS.has("reasoning")).toBe(true);
	});

	it("should contain expected number of keys", () => {
		expect(PRIVATE_DATA_KEYS.size).toBe(7);
	});
});

// ---------------------------------------------------------------------------
// sanitizeTranscriptData
// ---------------------------------------------------------------------------

describe("sanitizeTranscriptData", () => {
	it("should return undefined for undefined input", () => {
		expect(sanitizeTranscriptData(undefined)).toBeUndefined();
	});

	it("should return undefined for empty object", () => {
		expect(sanitizeTranscriptData({})).toBeUndefined();
	});

	it("should pass through safe data unchanged", () => {
		const data = { status: "running", workspaceId: "ws-1" };
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual(data);
	});

	it("should strip private keys at top level", () => {
		const data = {
			status: "running",
			thinking: "I should fix the bug by changing X",
			reasoning: "Because Y depends on Z",
		};
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual({ status: "running" });
	});

	it("should strip private keys from nested objects", () => {
		const data = {
			status: "running",
			inner: {
				thinking: "private",
				safe: "value",
			},
		};
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual({
			status: "running",
			inner: { safe: "value" },
		});
	});

	it("should return undefined when all fields are stripped", () => {
		const data = { thinking: "secret", reasoning: "also secret" };
		const result = sanitizeTranscriptData(data);
		expect(result).toBeUndefined();
	});

	it("should preserve arrays without modification", () => {
		const data = {
			items: ["a", "b", "c"],
			evidenceRefs: ["ref1", "ref2"],
		};
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual(data);
	});

	it("should preserve null values", () => {
		const data = { status: null };
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual({ status: null });
	});

	it("should preserve number and boolean values", () => {
		const data = { count: 42, passed: true, ratio: 0.5 };
		const result = sanitizeTranscriptData(data);
		expect(result).toEqual(data);
	});

	it("should not mutate the original object", () => {
		const data = { status: "running", thinking: "private" };
		const copy = { ...data };
		sanitizeTranscriptData(data);
		expect(data).toEqual(copy);
	});
});

// ---------------------------------------------------------------------------
// createWorkerTranscriptEvent
// ---------------------------------------------------------------------------

describe("createWorkerTranscriptEvent", () => {
	it("should create a transcript event from a valid journal event", () => {
		const journal: JournalEvent = {
			type: "worker_status",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { status: "executing", message: "Processing step 1" },
		};

		const result = createWorkerTranscriptEvent(journal, "Worker ws-1: executing");

		expect(result).not.toBeNull();
		expect(result!.type).toBe("worker_status");
		expect(result!.timestamp).toBe(1000);
		expect(result!.workspaceId).toBe("ws-1");
		expect(result!.summary).toBe("Worker ws-1: executing");
		expect(result!.data).toEqual({ status: "executing", message: "Processing step 1" });
	});

	it("should return null for events without workspaceId", () => {
		const journal: JournalEvent = {
			type: "worker_status",
			timestamp: 1000,
			data: { status: "executing" },
		};

		const result = createWorkerTranscriptEvent(journal, "summary");
		expect(result).toBeNull();
	});

	it("should return null for thinking events", () => {
		const journal: JournalEvent = {
			type: "thinking",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { content: "I should analyze the logs" },
		};

		const result = createWorkerTranscriptEvent(journal, "thinking");
		expect(result).toBeNull();
	});

	it("should return null for chain_of_thought events", () => {
		const journal: JournalEvent = {
			type: "chain_of_thought",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { content: "Step 1: read file..." },
		};

		const result = createWorkerTranscriptEvent(journal, "c ot");
		expect(result).toBeNull();
	});

	it("should sanitize data in the transcript event", () => {
		const journal: JournalEvent = {
			type: "worker_decision_summary",
			timestamp: 2000,
			workspaceId: "ws-1",
			data: {
				summary: "Decided to retry",
				reasoning: "Because the first attempt timed out",
			},
		};

		const result = createWorkerTranscriptEvent(journal, "Worker ws-1 decision: Decided to retry");

		expect(result).not.toBeNull();
		expect(result!.data).toEqual({ summary: "Decided to retry" });
		expect(result!.data!.reasoning).toBeUndefined();
	});

	it("should handle events without data", () => {
		const journal: JournalEvent = {
			type: "workspace_start",
			timestamp: 3000,
			workspaceId: "ws-1",
		};

		const result = createWorkerTranscriptEvent(journal, "Worker ws-1 started");

		expect(result).not.toBeNull();
		expect(result!.data).toBeUndefined();
	});

	it("should cast unknown event types as WorkerTranscriptEventType", () => {
		const journal: JournalEvent = {
			type: "unknown_event_type",
			timestamp: 4000,
			workspaceId: "ws-1",
		};

		const result = createWorkerTranscriptEvent(journal, "Worker ws-1 unknown_event_type");

		expect(result).not.toBeNull();
		expect(result!.type).toBe("unknown_event_type" as WorkerTranscriptEventType);
	});
});

// ---------------------------------------------------------------------------
// buildTranscriptSummary
// ---------------------------------------------------------------------------

describe("buildTranscriptSummary", () => {
	it("should summarize worker_status with message", () => {
		const event: JournalEvent = {
			type: "worker_status",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { status: "executing", message: "Compiling source" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1: executing \u2014 Compiling source");
	});

	it("should summarize worker_status without message", () => {
		const event: JournalEvent = {
			type: "worker_status",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { status: "idle" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1: idle");
	});

	it("should summarize worker_status with unknown status", () => {
		const event: JournalEvent = {
			type: "worker_status",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1: unknown");
	});

	it("should summarize worker_decision_summary", () => {
		const event: JournalEvent = {
			type: "worker_decision_summary",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { summary: "Retry with longer timeout" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 decision: Retry with longer timeout");
	});

	it("should summarize worker_decision_summary with no summary", () => {
		const event: JournalEvent = {
			type: "worker_decision_summary",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 decision: no summary");
	});

	it("should summarize validation passed", () => {
		const event: JournalEvent = {
			type: "validation",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { passed: true, criterion: "Code compiles" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 validation passed: Code compiles");
	});

	it("should summarize validation failed", () => {
		const event: JournalEvent = {
			type: "validation",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { passed: false, criterion: "Tests pass" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 validation failed: Tests pass");
	});

	it("should summarize blocker", () => {
		const event: JournalEvent = {
			type: "blocker",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { reason: "Missing dependency" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 blocker: Missing dependency");
	});

	it("should summarize tool_call", () => {
		const event: JournalEvent = {
			type: "tool_call",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { toolName: "read" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 tool call: read");
	});

	it("should summarize tool_call with unknown tool", () => {
		const event: JournalEvent = {
			type: "tool_call",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 tool call: unknown");
	});

	it("should summarize workspace_start", () => {
		const event: JournalEvent = {
			type: "workspace_start",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 started");
	});

	it("should summarize workspace_complete", () => {
		const event: JournalEvent = {
			type: "workspace_complete",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 completed");
	});

	it("should summarize workspace_failed", () => {
		const event: JournalEvent = {
			type: "workspace_failed",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { error: "Script crashed" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 failed: Script crashed");
	});

	it("should summarize workspace_blocked", () => {
		const event: JournalEvent = {
			type: "workspace_blocked",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { reason: "Dependency ws-2 failed" },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 blocked: Dependency ws-2 failed");
	});

	it("should summarize retry_attempt", () => {
		const event: JournalEvent = {
			type: "retry_attempt",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { attempt: 3 },
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 retry attempt 3");
	});

	it("should summarize plan_summary", () => {
		const event: JournalEvent = {
			type: "plan_summary",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { summary: "All workspaces completed" },
		};
		expect(buildTranscriptSummary(event)).toBe("Plan summary: All workspaces completed");
	});

	it("should summarize cleanup_workspace", () => {
		const event: JournalEvent = {
			type: "cleanup_workspace",
			timestamp: 1000,
			workspaceId: "ws-1",
			data: { message: "Removing temp files" },
		};
		expect(buildTranscriptSummary(event)).toBe("Cleanup: Removing temp files");
	});

	it("should fall back to default summary for unknown event types", () => {
		const event: JournalEvent = {
			type: "custom_event",
			timestamp: 1000,
			workspaceId: "ws-1",
		};
		expect(buildTranscriptSummary(event)).toBe("Worker ws-1 custom_event");
	});

	it("should use 'unknown' for missing workspaceId", () => {
		const event: JournalEvent = {
			type: "tool_call",
			timestamp: 1000,
			data: { toolName: "read" },
		};
		const summary = buildTranscriptSummary(event);
		expect(summary).toContain("unknown");
	});
});

// ---------------------------------------------------------------------------
// IWorkerTranscriptStore contract tests
// These are run against InMemoryWorkerTranscriptStore but validate the
// interface contract that any implementation must satisfy.
// ---------------------------------------------------------------------------

/**
 * Helper to create a fresh store for contract testing.
 */
function createStore(): IWorkerTranscriptStore {
	return new InMemoryWorkerTranscriptStore();
}

describe("IWorkerTranscriptStore contract", () => {
	let store: IWorkerTranscriptStore;

	beforeEach(() => {
		store = createStore();
	});

	// -----------------------------------------------------------------------
	// appendTranscriptEvent
	// -----------------------------------------------------------------------

	describe("appendTranscriptEvent", () => {
		it("should append a single event and make it readable", async () => {
			const event = makeTranscriptEvent({
				type: "worker_status",
				workspaceId: "ws-1",
				summary: "Worker started",
			});

			await store.appendTranscriptEvent("exec-1", "ws-1", event);

			const events = await store.readTranscriptEvents("exec-1", "ws-1");
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("worker_status");
			expect(events[0].summary).toBe("Worker started");
		});

		it("should append multiple events in order", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1", summary: "event-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "tool_call", workspaceId: "ws-1", summary: "event-2" }),
			);
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "workspace_complete", workspaceId: "ws-1", summary: "event-3" }),
			);

			const events = await store.readTranscriptEvents("exec-1", "ws-1");
			expect(events).toHaveLength(3);
			expect(events[0].summary).toBe("event-1");
			expect(events[1].summary).toBe("event-2");
			expect(events[2].summary).toBe("event-3");
		});

		it("should isolate events between different workspaces", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1", summary: "ws1 event" }),
			);
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-2",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-2", summary: "ws2 event" }),
			);

			const ws1Events = await store.readTranscriptEvents("exec-1", "ws-1");
			expect(ws1Events).toHaveLength(1);
			expect(ws1Events[0].summary).toBe("ws1 event");

			const ws2Events = await store.readTranscriptEvents("exec-1", "ws-2");
			expect(ws2Events).toHaveLength(1);
			expect(ws2Events[0].summary).toBe("ws2 event");
		});

		it("should isolate events between different plan executions", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1", summary: "exec1 event" }),
			);
			await store.appendTranscriptEvent(
				"exec-2",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1", summary: "exec2 event" }),
			);

			const exec1Events = await store.readTranscriptEvents("exec-1", "ws-1");
			expect(exec1Events).toHaveLength(1);
			expect(exec1Events[0].summary).toBe("exec1 event");

			const exec2Events = await store.readTranscriptEvents("exec-2", "ws-1");
			expect(exec2Events).toHaveLength(1);
			expect(exec2Events[0].summary).toBe("exec2 event");
		});
	});

	// -----------------------------------------------------------------------
	// readTranscriptEvents
	// -----------------------------------------------------------------------

	describe("readTranscriptEvents", () => {
		it("should return empty array for unknown plan execution", async () => {
			const events = await store.readTranscriptEvents("nonexistent", "ws-1");
			expect(events).toEqual([]);
		});

		it("should return empty array for unknown workspace", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);

			const events = await store.readTranscriptEvents("exec-1", "nonexistent-ws");
			expect(events).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// listWorkspacesWithTranscript
	// -----------------------------------------------------------------------

	describe("listWorkspacesWithTranscript", () => {
		it("should return empty array for empty store", async () => {
			const workspaces = await store.listWorkspacesWithTranscript("exec-1");
			expect(workspaces).toEqual([]);
		});

		it("should list workspace IDs with events", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-2",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-2" }),
			);

			const workspaces = await store.listWorkspacesWithTranscript("exec-1");
			expect(workspaces).toEqual(["ws-1", "ws-2"]);
		});

		it("should not list workspaces from different plan executions", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-2",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);

			const workspaces = await store.listWorkspacesWithTranscript("exec-1");
			expect(workspaces).toEqual(["ws-1"]);
		});
	});

	// -----------------------------------------------------------------------
	// deleteTranscriptEvents
	// -----------------------------------------------------------------------

	describe("deleteTranscriptEvents", () => {
		it("should remove all events for a plan execution", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-2",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-2" }),
			);

			await store.deleteTranscriptEvents("exec-1");

			expect(await store.readTranscriptEvents("exec-1", "ws-1")).toEqual([]);
			expect(await store.readTranscriptEvents("exec-1", "ws-2")).toEqual([]);
			expect(await store.listWorkspacesWithTranscript("exec-1")).toEqual([]);
		});

		it("should not affect other plan executions", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-2",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);

			await store.deleteTranscriptEvents("exec-1");

			expect(await store.readTranscriptEvents("exec-2", "ws-1")).toHaveLength(1);
		});

		it("should be idempotent on non-existent plan execution", async () => {
			await expect(store.deleteTranscriptEvents("nonexistent")).resolves.toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// InMemoryWorkerTranscriptStore-specific tests
// ---------------------------------------------------------------------------

describe("InMemoryWorkerTranscriptStore", () => {
	let store: InMemoryWorkerTranscriptStore;

	beforeEach(() => {
		store = new InMemoryWorkerTranscriptStore();
	});

	describe("clear", () => {
		it("should remove all events across all plan executions", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.appendTranscriptEvent(
				"exec-2",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);

			await store.clear();

			expect(await store.readTranscriptEvents("exec-1", "ws-1")).toEqual([]);
			expect(await store.readTranscriptEvents("exec-2", "ws-1")).toEqual([]);
		});

		it("should allow reuse after clear", async () => {
			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
			);
			await store.clear();

			await store.appendTranscriptEvent(
				"exec-1",
				"ws-1",
				makeTranscriptEvent({ type: "tool_call", workspaceId: "ws-1", summary: "after clear" }),
			);

			const events = await store.readTranscriptEvents("exec-1", "ws-1");
			expect(events).toHaveLength(1);
			expect(events[0].summary).toBe("after clear");
		});
	});

	describe("error handling", () => {
		it("should throw when planExecutionId is empty", async () => {
			await expect(
				store.appendTranscriptEvent(
					"",
					"ws-1",
					makeTranscriptEvent({ type: "worker_status", workspaceId: "ws-1" }),
				),
			).rejects.toThrow("planExecutionId is required");
		});

		it("should throw when workspaceId is empty", async () => {
			await expect(
				store.appendTranscriptEvent("exec-1", "", makeTranscriptEvent({ type: "worker_status", workspaceId: "" })),
			).rejects.toThrow("workspaceId is required");
		});
	});
});

// ---------------------------------------------------------------------------
// RuntimeEventEmitter transcript integration
// ---------------------------------------------------------------------------

describe("RuntimeEventEmitter transcript integration", () => {
	let eventStore: InMemoryEventStore;
	let transcriptStore: InMemoryWorkerTranscriptStore;
	let emitter: RuntimeEventEmitter;
	const planExecutionId = "exec-1";

	beforeEach(() => {
		eventStore = new InMemoryEventStore();
		transcriptStore = new InMemoryWorkerTranscriptStore();
		emitter = new RuntimeEventEmitter(eventStore, planExecutionId, "ws-1", undefined, transcriptStore);
	});

	describe("emitTranscriptFromJournal", () => {
		it("should emit a transcript event from a journal event", async () => {
			const journal: JournalEvent = {
				type: "worker_status",
				timestamp: Date.now(),
				workspaceId: "ws-1",
				data: { status: "executing", message: "Processing step 1" },
			};

			const result = await emitter.emitTranscriptFromJournal(journal);

			expect(result).not.toBeNull();
			expect(result!.type).toBe("worker_status");
			expect(result!.workspaceId).toBe("ws-1");
			expect(result!.summary).toContain("Processing step 1");

			// Verify it was persisted
			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-1");
			expect(stored).toHaveLength(1);
			expect(stored[0]).toEqual(result);
		});

		it("should return null when no transcript store is configured", async () => {
			const emitterWithoutStore = new RuntimeEventEmitter(eventStore, planExecutionId);

			const journal: JournalEvent = {
				type: "worker_status",
				timestamp: Date.now(),
				workspaceId: "ws-1",
				data: { status: "executing" },
			};

			const result = await emitterWithoutStore.emitTranscriptFromJournal(journal);
			expect(result).toBeNull();
		});

		it("should return null for thinking events", async () => {
			const journal: JournalEvent = {
				type: "thinking",
				timestamp: Date.now(),
				workspaceId: "ws-1",
				data: { content: "I should look at the error logs" },
			};

			const result = await emitter.emitTranscriptFromJournal(journal);
			expect(result).toBeNull();
		});

		it("should emit transcript events tagged with the correct workspaceId", async () => {
			const childEmitter = emitter.child({ workspaceId: "ws-2" });

			const journal: JournalEvent = {
				type: "worker_status",
				timestamp: Date.now(),
				workspaceId: "ws-2",
				data: { status: "running" },
			};

			await childEmitter.emitTranscriptFromJournal(journal);

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-2");
			expect(stored).toHaveLength(1);
			expect(stored[0].workspaceId).toBe("ws-2");
		});

		it("should pass workspaceId override to store", async () => {
			const journal: JournalEvent = {
				type: "worker_status",
				timestamp: Date.now(),
				data: { status: "running" },
			};

			// No workspaceId in journal, but passed explicitly
			const result = await emitter.emitTranscriptFromJournal(journal, "ws-override");
			expect(result).not.toBeNull();
			expect(result!.workspaceId).toBe("ws-override");

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-override");
			expect(stored).toHaveLength(1);
		});

		it("should sanitize private data before storing", async () => {
			const journal: JournalEvent = {
				type: "worker_decision_summary",
				timestamp: Date.now(),
				workspaceId: "ws-1",
				data: {
					summary: "Retry with different approach",
					reasoning: "The previous method had a race condition",
				},
			};

			const result = await emitter.emitTranscriptFromJournal(journal);

			expect(result).not.toBeNull();
			expect(result!.data).toEqual({ summary: "Retry with different approach" });
			expect(result!.data!.reasoning).toBeUndefined();
		});
	});

	describe("emitTranscriptEvent", () => {
		it("should emit a pre-built transcript event", async () => {
			const event = makeTranscriptEvent({
				type: "worker_status",
				workspaceId: "ws-1",
				summary: "Direct emit",
				data: { status: "running" },
			});

			await emitter.emitTranscriptEvent("ws-1", event);

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-1");
			expect(stored).toHaveLength(1);
			expect(stored[0].summary).toBe("Direct emit");
			expect(stored[0].data).toEqual({ status: "running" });
		});

		it("should not throw when no transcript store is configured", async () => {
			const emitterWithoutStore = new RuntimeEventEmitter(eventStore, planExecutionId);

			const event = makeTranscriptEvent({
				type: "worker_status",
				workspaceId: "ws-1",
				summary: "no store",
			});

			await expect(emitterWithoutStore.emitTranscriptEvent("ws-1", event)).resolves.toBeUndefined();
		});
	});

	describe("child derivation inherits transcript store", () => {
		it("should inherit the transcript store from parent", async () => {
			const child = emitter.child({ workspaceId: "ws-child" });

			const journal: JournalEvent = {
				type: "tool_call",
				timestamp: Date.now(),
				workspaceId: "ws-child",
				data: { toolName: "write" },
			};

			await child.emitTranscriptFromJournal(journal);

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-child");
			expect(stored).toHaveLength(1);
			expect(stored[0].type).toBe("tool_call");
		});
	});

	describe("full pipeline integration", () => {
		it("should emit sequence of transcript events from journal chain", async () => {
			const events: JournalEvent[] = [
				{ type: "workspace_start", timestamp: 1000, workspaceId: "ws-1" },
				{ type: "worker_status", timestamp: 1001, workspaceId: "ws-1", data: { status: "executing" } },
				{ type: "tool_call", timestamp: 1002, workspaceId: "ws-1", data: { toolName: "read" } },
				{ type: "tool_call", timestamp: 1003, workspaceId: "ws-1", data: { toolName: "write" } },
				{
					type: "worker_decision_summary",
					timestamp: 1004,
					workspaceId: "ws-1",
					data: { summary: "Fix implemented" },
				},
				{ type: "workspace_complete", timestamp: 1005, workspaceId: "ws-1" },
			];

			for (const journal of events) {
				await emitter.emitTranscriptFromJournal(journal);
			}

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-1");
			expect(stored).toHaveLength(6);

			// Verify order
			expect(stored[0].type).toBe("workspace_start");
			expect(stored[1].type).toBe("worker_status");
			expect(stored[2].type).toBe("tool_call");
			expect(stored[3].type).toBe("tool_call");
			expect(stored[4].type).toBe("worker_decision_summary");
			expect(stored[5].type).toBe("workspace_complete");

			// Verify timestamps are preserved
			expect(stored[0].timestamp).toBe(1000);
			expect(stored[5].timestamp).toBe(1005);
		});

		it("should skip private events in the pipeline", async () => {
			const events: JournalEvent[] = [
				{ type: "workspace_start", timestamp: 1000, workspaceId: "ws-1" },
				{ type: "thinking", timestamp: 1001, workspaceId: "ws-1", data: { content: "private" } },
				{ type: "worker_status", timestamp: 1002, workspaceId: "ws-1", data: { status: "running" } },
			];

			for (const journal of events) {
				await emitter.emitTranscriptFromJournal(journal);
			}

			const stored = await transcriptStore.readTranscriptEvents(planExecutionId, "ws-1");
			expect(stored).toHaveLength(2);
			expect(stored[0].type).toBe("workspace_start");
			expect(stored[1].type).toBe("worker_status");
		});
	});
});
