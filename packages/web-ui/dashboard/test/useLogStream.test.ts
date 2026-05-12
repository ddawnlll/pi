import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useLogStream } from "../src/hooks/useLogStream";

// ---------------------------------------------------------------------------
// EventSource mock
// ---------------------------------------------------------------------------

interface MockEventSource {
	url: string;
	withCredentials: boolean;
	readyState: number;
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
	close: ReturnType<typeof vi.fn>;
	_triggerOpen: () => void;
	_triggerMessage: (data: string) => void;
	_triggerError: () => void;
}

let mockEventSource: MockEventSource | null = null;
let esConstructorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockEventSource = null;
	esConstructorSpy = vi.fn();

	class EsMock {
		url: string;
		withCredentials = false;
		readyState = 0;
		onopen: ((event: Event) => void) | null = null;
		onmessage: ((event: MessageEvent) => void) | null = null;
		onerror: ((event: Event) => void) | null = null;
		close = vi.fn(() => {
			this.readyState = 2;
		});
		static CONNECTING = 0;
		static OPEN = 1;
		static CLOSED = 2;

		constructor(url: string | URL) {
			this.url = String(url);
			const self = this;
			mockEventSource = self as unknown as MockEventSource;
			esConstructorSpy(String(url));

			// Attach test helpers
			(self as unknown as MockEventSource)._triggerOpen = () => {
				self.readyState = 1;
				if (self.onopen) self.onopen(new Event("open"));
			};
			(self as unknown as MockEventSource)._triggerMessage = (data: string) => {
				if (self.onmessage) {
					self.onmessage(new MessageEvent("message", { data }));
				}
			};
			(self as unknown as MockEventSource)._triggerError = () => {
				self.readyState = 2;
				if (self.onerror) self.onerror(new Event("error"));
			};
		}
	}

	const EsMockClass = EsMock as unknown as typeof globalThis.EventSource;
	EsMockClass.CONNECTING = 0;
	EsMockClass.OPEN = 1;
	EsMockClass.CLOSED = 2;
	EsMock.prototype.CONNECTING = 0;
	EsMock.prototype.OPEN = 1;
	EsMock.prototype.CLOSED = 2;

	vi.stubGlobal("EventSource", EsMockClass);
});

afterEach(() => {
	vi.restoreAllMocks();
	mockEventSource = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLogStream", () => {
	it("connects to the correct SSE URL", () => {
		renderHook(() => useLogStream("ws-1", 1, "stdout"));

		expect(esConstructorSpy).toHaveBeenCalledWith("/api/logs/ws-1/1/stdout");
	});

	it("sets isConnected=true on open", async () => {
		const { result } = renderHook(() => useLogStream("ws-1", 1, "stdout"));

		expect(result.current.isConnected).toBe(false);

		await act(async () => {
			mockEventSource!._triggerOpen();
		});

		expect(result.current.isConnected).toBe(true);
	});

	it("skips __NO_LOGS__ sentinel and sets hasData=false", async () => {
		const { result } = renderHook(() => useLogStream("ws-1", 1, "stdout"));

		await act(async () => {
			mockEventSource!._triggerMessage("__NO_LOGS__");
		});

		expect(result.current.lines).toEqual([]);
		expect(result.current.hasData).toBe(false);
	});

	it("accumulates messages on onmessage", async () => {
		const { result } = renderHook(() => useLogStream("ws-1", 1, "stdout"));

		await act(async () => {
			mockEventSource!._triggerMessage("line 1");
		});
		expect(result.current.lines).toEqual(["line 1"]);

		await act(async () => {
			mockEventSource!._triggerMessage("line 2");
		});
		expect(result.current.lines).toEqual(["line 1", "line 2"]);
	});

	it("sets isConnected=false on error", async () => {
		const { result } = renderHook(() => useLogStream("ws-1", 1, "stdout"));

		await act(async () => {
			mockEventSource!._triggerOpen();
		});
		expect(result.current.isConnected).toBe(true);

		await act(async () => {
			mockEventSource!._triggerError();
		});
		expect(result.current.isConnected).toBe(false);
	});

	it("does NOT clear lines on error/reconnect to same target", async () => {
		const { result } = renderHook(() => useLogStream("ws-1", 1, "stdout"));

		await act(async () => {
			mockEventSource!._triggerMessage("line 1");
		});
		expect(result.current.lines).toEqual(["line 1"]);

		// Simulate connection error
		await act(async () => {
			mockEventSource!._triggerError();
		});

		// Lines should be preserved
		expect(result.current.lines).toEqual(["line 1"]);
	});

	it("clears lines when switching to a different stream target", async () => {
		const { result, rerender } = renderHook(
			({
				workspaceId,
				attempt,
				stream,
			}: {
				workspaceId: string | null;
				attempt: number | null;
				stream: "stdout" | "stderr" | "error" | "test" | null;
			}) => useLogStream(workspaceId, attempt, stream),
			{
				initialProps: {
					workspaceId: "ws-1",
					attempt: 1,
					stream: "stdout" as const,
				},
			},
		);

		await act(async () => {
			mockEventSource!._triggerMessage("line 1");
		});
		expect(result.current.lines).toEqual(["line 1"]);

		// Switch to stderr
		await act(async () => {
			rerender({
				workspaceId: "ws-1",
				attempt: 1,
				stream: "stderr" as const,
			});
		});

		expect(result.current.lines).toEqual([]);
	});

	it("returns empty lines for null params", () => {
		const { result } = renderHook(() => useLogStream(null, null, null));

		expect(result.current.lines).toEqual([]);
		expect(result.current.isConnected).toBe(false);
		expect(esConstructorSpy).not.toHaveBeenCalled();
	});
});
