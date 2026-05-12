import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useWorkspaceLogStream } from "../src/hooks/useWorkspaceLogStream";

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

interface MockWebSocket {
	url: string;
	readyState: number;
	onopen: ((event: Event) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	_triggerOpen: () => void;
	_triggerMessage: (data: string) => void;
	_triggerClose: (code: number, reason: string) => void;
	_triggerError: () => void;
}

interface MockWebSocketConstructor {
	new (url: string): MockWebSocket;
	prototype: unknown;
	CONNECTING: number;
	OPEN: number;
	CLOSING: number;
	CLOSED: number;
}

let mockWebSocket: MockWebSocket | null = null;
let wsConstructorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks().useFakeTimers();
	mockWebSocket = null;
	wsConstructorSpy = vi.fn();

	class WsMock {
		url: string;
		readyState = 0;
		onopen: ((event: Event) => void) | null = null;
		onclose: ((event: CloseEvent) => void) | null = null;
		onerror: ((event: Event) => void) | null = null;
		onmessage: ((event: MessageEvent) => void) | null = null;
		send = vi.fn();
		close = vi.fn(() => {
			this.readyState = 3;
		});
		static CONNECTING = 0;
		static OPEN = 1;
		static CLOSING = 2;
		static CLOSED = 3;

		constructor(url: string) {
			this.url = url;
			const self = this;
			// Wrap close to call onclose
			this.close = vi.fn(() => {
				self.readyState = 2;
				setTimeout(() => {
					self.readyState = 3;
					if (self.onclose) {
						self.onclose(new CloseEvent("close", { code: 1000, wasClean: true }));
					}
				}, 0);
			});
			mockWebSocket = self as unknown as MockWebSocket;
			wsConstructorSpy(url);
		}
	}

	const WsMockClass = WsMock as unknown as MockWebSocketConstructor;
	WsMockClass.CONNECTING = 0;
	WsMockClass.OPEN = 1;
	WsMockClass.CLOSING = 2;
	WsMockClass.CLOSED = 3;

	vi.stubGlobal("WebSocket", WsMockClass);

	// Attach helpers to the mock instance after construction
	// These are called from tests after the socket is created
});

function attachHelpers(ws: MockWebSocket | null): MockWebSocket | null {
	if (!ws) return ws;
	(ws as MockWebSocket & {
		_triggerOpen: () => void;
		_triggerMessage: (data: string) => void;
		_triggerClose: (code: number, reason: string) => void;
		_triggerError: () => void;
	})._triggerOpen = function () {
		this.readyState = 1;
		if (this.onopen) this.onopen(new Event("open"));
	};
	(ws as Record<string, unknown>)._triggerMessage = function (data: string) {
		if (this.onmessage) {
			this.onmessage(new MessageEvent("message", { data }));
		}
	};
	(ws as Record<string, unknown>)._triggerClose = function (
		code: number,
		reason: string,
	) {
		this.readyState = 3;
		if (this.onclose) {
			this.onclose(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
		}
	};
	(ws as Record<string, unknown>)._triggerError = function () {
		this.readyState = 3;
		if (this.onerror) this.onerror(new Event("error"));
		if (this.onclose) {
			this.onclose(
				new CloseEvent("close", { code: 1006, wasClean: false }),
			);
		}
	};
	return ws;
}

afterEach(() => {
	vi.restoreAllMocks();
	mockWebSocket = null;
});

// ---------------------------------------------------------------------------
// Helper to connect and wait for async state updates
// ---------------------------------------------------------------------------

async function connectAndOpen(planExecId: string, workspaceId: string) {
	const { result } = renderHook(() =>
		useWorkspaceLogStream(planExecId, workspaceId),
	);

	// Simulate WebSocket opening
	await act(async () => {
		attachHelpers(mockWebSocket);
		mockWebSocket!._triggerOpen();
	});

	// Flush React updates
	await act(async () => {});

	return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useWorkspaceLogStream", () => {
	it("connects to the correct WebSocket URL", async () => {
		renderHook(() => useWorkspaceLogStream("exec-1", "ws-1"));

		expect(wsConstructorSpy).toHaveBeenCalledWith(
			expect.stringContaining("/api/ws/logs/exec-1/ws-1"),
		);
	});

	it("sets isConnected=true on open", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");
		expect(result.current.isConnected).toBe(true);
	});

	it("receives log lines via messages", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");

		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "log", data: "line 1" }),
			);
		});
		expect(result.current.lines).toEqual(["line 1"]);

		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "log", data: "line 2" }),
			);
		});
		expect(result.current.lines).toEqual(["line 1", "line 2"]);
	});

	it("handles the ready signal without adding a line", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");

		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "ready" }),
			);
		});
		expect(result.current.lines).toEqual([]);
	});

	it("reconnects on unexpected close (code != 1000/1001)", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");
		expect(result.current.isConnected).toBe(true);

		// Simulate unexpected close
		await act(async () => {
			mockWebSocket!._triggerClose(1006, "Connection lost");
		});

		// Should show as reconnecting
		expect(result.current.isConnected).toBe(false);
		expect(result.current.isReconnecting).toBe(true);
		expect(result.current.error).toBe("Connection lost");

		// Wait for reconnection timer (starts at 1s)
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		// New WebSocket should be created
		expect(wsConstructorSpy).toHaveBeenCalledTimes(2);

		// Open the new connection
		await act(async () => {
			attachHelpers(mockWebSocket);
			mockWebSocket!._triggerOpen();
		});

		expect(result.current.isConnected).toBe(true);
		expect(result.current.isReconnecting).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it("preserves lines across reconnects to the same workspace", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");

		// Receive some lines
		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "log", data: "line 1" }),
			);
		});
		expect(result.current.lines).toEqual(["line 1"]);

		// Unexpected close
		await act(async () => {
			mockWebSocket!._triggerClose(1006, "Connection lost");
		});

		// Advance timer to reconnect
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		// Open new connection
		await act(async () => {
			attachHelpers(mockWebSocket);
			mockWebSocket!._triggerOpen();
		});

		// Lines should be preserved
		expect(result.current.lines).toEqual(["line 1"]);

		// New lines should accumulate
		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "log", data: "line 2" }),
			);
		});
		expect(result.current.lines).toEqual(["line 1", "line 2"]);
	});

	it("clears lines when switching to a different workspace", async () => {
		const { result, rerender } = renderHook(
			({ planExecId, workspaceId }: { planExecId: string; workspaceId: string }) =>
				useWorkspaceLogStream(planExecId, workspaceId),
			{ initialProps: { planExecId: "exec-1", workspaceId: "ws-1" } },
		);

		// Connect and receive lines
		await act(async () => {
			attachHelpers(mockWebSocket);
			mockWebSocket!._triggerOpen();
		});
		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "log", data: "line 1" }),
			);
		});
		expect(result.current.lines).toEqual(["line 1"]);

		// Switch workspace
		await act(async () => {
			rerender({ planExecId: "exec-1", workspaceId: "ws-2" });
		});

		// Lines should be cleared
		expect(result.current.lines).toEqual([]);
	});

	it("reports error on error messages from server", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");

		await act(async () => {
			mockWebSocket!._triggerMessage(
				JSON.stringify({ type: "error", message: "Something broke" }),
			);
		});

		expect(result.current.error).toBe("Something broke");
	});

	it("does not reconnect on normal close (code 1000)", async () => {
		const result = await connectAndOpen("exec-1", "ws-1");

		// Normal close — server finished streaming
		await act(async () => {
			mockWebSocket!._triggerClose(1000, "Normal closure");
		});

		expect(result.current.isConnected).toBe(false);
		expect(result.current.isReconnecting).toBe(false);
		expect(result.current.error).toBeNull();

		// Should NOT have created a new WebSocket
		expect(wsConstructorSpy).toHaveBeenCalledTimes(1);
	});

	it("returns empty for null params", () => {
		const { result } = renderHook(() =>
			useWorkspaceLogStream(null, null),
		);

		expect(result.current.isConnected).toBe(false);
		expect(result.current.lines).toEqual([]);
		expect(wsConstructorSpy).not.toHaveBeenCalled();
	});
});
