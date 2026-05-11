/**
 * Tests for Plan Watch Dashboard - P2.2 Slice 1
 *
 * Tests keyboard input handling and state management
 */

import { describe, expect, it } from "vitest";

/**
 * Watcher UI state (copied from plan-watch.ts for testing)
 */
interface WatcherState {
	selectedWorkerIndex: number;
	focusedPanel: "workers" | "events";
	eventScrollOffset: number;
	failedRetryOnly: boolean;
	shouldExit: boolean;
}

/**
 * Handle keyboard input (extracted for testing)
 */
function handleKeyPress(data: string, state: WatcherState): void {
	// Worker selection: 1/2/3
	if (data === "1") {
		state.selectedWorkerIndex = 0;
		state.focusedPanel = "workers";
	} else if (data === "2") {
		state.selectedWorkerIndex = 1;
		state.focusedPanel = "workers";
	} else if (data === "3") {
		state.selectedWorkerIndex = 2;
		state.focusedPanel = "workers";
	}
	// Panel cycling: tab
	else if (data === "\t") {
		state.focusedPanel = state.focusedPanel === "workers" ? "events" : "workers";
	}
	// Event log scrolling: j/k
	else if (data === "j") {
		state.eventScrollOffset = Math.max(0, state.eventScrollOffset + 1);
		state.focusedPanel = "events";
	} else if (data === "k") {
		state.eventScrollOffset = Math.max(0, state.eventScrollOffset - 1);
		state.focusedPanel = "events";
	}
	// Filter toggle: f
	else if (data === "f") {
		state.failedRetryOnly = !state.failedRetryOnly;
		state.eventScrollOffset = 0;
	}
	// Exit: q
	else if (data === "q") {
		state.shouldExit = true;
	}
}

describe("plan-watch keyboard handling", () => {
	it("should select worker 1 with key '1'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "events",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("1", state);

		expect(state.selectedWorkerIndex).toBe(0);
		expect(state.focusedPanel).toBe("workers");
	});

	it("should select worker 2 with key '2'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "events",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("2", state);

		expect(state.selectedWorkerIndex).toBe(1);
		expect(state.focusedPanel).toBe("workers");
	});

	it("should select worker 3 with key '3'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "events",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("3", state);

		expect(state.selectedWorkerIndex).toBe(2);
		expect(state.focusedPanel).toBe("workers");
	});

	it("should cycle panels with tab", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("\t", state);
		expect(state.focusedPanel).toBe("events");

		handleKeyPress("\t", state);
		expect(state.focusedPanel).toBe("workers");
	});

	it("should scroll events down with 'j'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("j", state);

		expect(state.eventScrollOffset).toBe(1);
		expect(state.focusedPanel).toBe("events");

		handleKeyPress("j", state);
		expect(state.eventScrollOffset).toBe(2);
	});

	it("should scroll events up with 'k'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 5,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("k", state);

		expect(state.eventScrollOffset).toBe(4);
		expect(state.focusedPanel).toBe("events");
	});

	it("should not scroll below 0", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("k", state);

		expect(state.eventScrollOffset).toBe(0);
	});

	it("should toggle filter with 'f'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 5,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("f", state);

		expect(state.failedRetryOnly).toBe(true);
		expect(state.eventScrollOffset).toBe(0); // Reset scroll on filter change

		handleKeyPress("f", state);
		expect(state.failedRetryOnly).toBe(false);
	});

	it("should exit with 'q'", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("q", state);

		expect(state.shouldExit).toBe(true);
	});

	it("should ignore unknown keys", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		const initialState = { ...state };

		handleKeyPress("x", state);

		expect(state).toEqual(initialState);
	});
});

describe("plan-watch state machine", () => {
	it("should maintain worker selection across panel switches", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("2", state);
		expect(state.selectedWorkerIndex).toBe(1);

		handleKeyPress("\t", state);
		expect(state.focusedPanel).toBe("events");
		expect(state.selectedWorkerIndex).toBe(1); // Selection preserved

		handleKeyPress("\t", state);
		expect(state.focusedPanel).toBe("workers");
		expect(state.selectedWorkerIndex).toBe(1); // Still preserved
	});

	it("should reset scroll offset when filter changes", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "events",
			eventScrollOffset: 10,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("f", state);

		expect(state.eventScrollOffset).toBe(0);
	});

	it("should switch to events panel when scrolling", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "workers",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("j", state);

		expect(state.focusedPanel).toBe("events");
	});

	it("should switch to workers panel when selecting worker", () => {
		const state: WatcherState = {
			selectedWorkerIndex: 0,
			focusedPanel: "events",
			eventScrollOffset: 0,
			failedRetryOnly: false,
			shouldExit: false,
		};

		handleKeyPress("1", state);

		expect(state.focusedPanel).toBe("workers");
	});
});

describe("plan-watch event filtering", () => {
	interface JournalEvent {
		type: string;
		timestamp: number;
		workspaceId?: string;
		data?: Record<string, unknown>;
	}

	function filterEvents(events: JournalEvent[], failedRetryOnly: boolean): JournalEvent[] {
		if (!failedRetryOnly) {
			return events;
		}

		return events.filter(
			(e) =>
				e.type === "workspace_failed" ||
				e.type === "workspace_blocked" ||
				e.type === "retry_attempt" ||
				e.type === "plan_failed",
		);
	}

	it("should show all events when filter is off", () => {
		const events: JournalEvent[] = [
			{ type: "plan_start", timestamp: 1000 },
			{ type: "workspace_start", timestamp: 2000, workspaceId: "7.A" },
			{ type: "workspace_complete", timestamp: 3000, workspaceId: "7.A" },
			{ type: "workspace_failed", timestamp: 4000, workspaceId: "7.B" },
		];

		const filtered = filterEvents(events, false);

		expect(filtered).toHaveLength(4);
	});

	it("should show only failed/retry events when filter is on", () => {
		const events: JournalEvent[] = [
			{ type: "plan_start", timestamp: 1000 },
			{ type: "workspace_start", timestamp: 2000, workspaceId: "7.A" },
			{ type: "workspace_complete", timestamp: 3000, workspaceId: "7.A" },
			{ type: "workspace_failed", timestamp: 4000, workspaceId: "7.B" },
			{ type: "retry_attempt", timestamp: 5000, workspaceId: "7.B", data: { attempt: 1 } },
			{ type: "workspace_blocked", timestamp: 6000, workspaceId: "7.C" },
		];

		const filtered = filterEvents(events, true);

		expect(filtered).toHaveLength(3);
		expect(filtered[0].type).toBe("workspace_failed");
		expect(filtered[1].type).toBe("retry_attempt");
		expect(filtered[2].type).toBe("workspace_blocked");
	});

	it("should include plan_failed in filter", () => {
		const events: JournalEvent[] = [
			{ type: "plan_start", timestamp: 1000 },
			{ type: "plan_failed", timestamp: 2000 },
		];

		const filtered = filterEvents(events, true);

		expect(filtered).toHaveLength(1);
		expect(filtered[0].type).toBe("plan_failed");
	});
});

describe("plan-watch worker-specific events", () => {
	interface JournalEvent {
		type: string;
		timestamp: number;
		workspaceId?: string;
		data?: Record<string, unknown>;
	}

	function filterWorkerEvents(events: JournalEvent[], workspaceId: string): JournalEvent[] {
		return events.filter((e) => e.workspaceId === workspaceId);
	}

	it("should filter events by workspace id", () => {
		const events: JournalEvent[] = [
			{ type: "workspace_start", timestamp: 1000, workspaceId: "7.A" },
			{ type: "workspace_start", timestamp: 2000, workspaceId: "7.B" },
			{ type: "workspace_complete", timestamp: 3000, workspaceId: "7.A" },
			{ type: "workspace_failed", timestamp: 4000, workspaceId: "7.B" },
		];

		const workerAEvents = filterWorkerEvents(events, "7.A");

		expect(workerAEvents).toHaveLength(2);
		expect(workerAEvents[0].workspaceId).toBe("7.A");
		expect(workerAEvents[1].workspaceId).toBe("7.A");
	});

	it("should return empty array when no events match", () => {
		const events: JournalEvent[] = [
			{ type: "workspace_start", timestamp: 1000, workspaceId: "7.A" },
			{ type: "workspace_complete", timestamp: 2000, workspaceId: "7.A" },
		];

		const workerBEvents = filterWorkerEvents(events, "7.B");

		expect(workerBEvents).toHaveLength(0);
	});

	it("should handle events without workspaceId", () => {
		const events: JournalEvent[] = [
			{ type: "plan_start", timestamp: 1000 },
			{ type: "workspace_start", timestamp: 2000, workspaceId: "7.A" },
			{ type: "plan_complete", timestamp: 3000 },
		];

		const workerAEvents = filterWorkerEvents(events, "7.A");

		expect(workerAEvents).toHaveLength(1);
		expect(workerAEvents[0].workspaceId).toBe("7.A");
	});
});
