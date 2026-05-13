import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WorkerDetail } from "../src/components/WorkerDetail";
import type { WorkerInfo, WorkspaceSummary } from "../src/types";

// ---------------------------------------------------------------------------
// Mock framer-motion (doesn't work in jsdom)
// ---------------------------------------------------------------------------

vi.mock("framer-motion", () => ({
	motion: {
		div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
			<div {...props}>{children}</div>,
		span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
			<span {...props}>{children}</span>,
	},
	AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock WebSocket hook — simulate a real WebSocket
// ---------------------------------------------------------------------------

type OnStateChange = (
	state: {
		lines: string[];
		isConnected: boolean;
		isReconnecting: boolean;
		error: string | null;
	},
) => void;

let triggerStateChange: OnStateChange | null = null;
let mockCurrentState = {
	lines: [] as string[],
	isConnected: false,
	isReconnecting: false,
	error: null as string | null,
};
let connectCount = 0;
let lastConnArgs: [string | null, string | null] = [null, null];

const mockUseWorkspaceLogStream = vi.fn().mockImplementation(
	(planExecId: string | null, workspaceId: string | null) => {
		lastConnArgs = [planExecId, workspaceId];
		return mockCurrentState;
	},
);

vi.mock("../src/hooks/useWorkspaceLogStream", () => ({
	useWorkspaceLogStream: (...args: unknown[]) =>
		mockUseWorkspaceLogStream(...args),
}));

function setState(partial: Partial<typeof mockCurrentState>) {
	mockCurrentState = { ...mockCurrentState, ...partial };
	if (triggerStateChange) triggerStateChange(mockCurrentState);
}

beforeEach(() => {
	mockCurrentState = {
		lines: [],
		isConnected: false,
		isReconnecting: false,
		error: null,
	};
	connectCount = 0;
	lastConnArgs = [null, null];
	triggerStateChange = null;
	mockUseWorkspaceLogStream.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const baseWorker: WorkerInfo = {
	id: "ws-1",
	stage: "active",
	attempt: 1,
	retries: 0,
};

const baseWorkspace: WorkspaceSummary = {
	id: "ws-1",
	stage: "active",
	attempts: 1,
	error: null,
	startedAt: null,
	completedAt: null,
};

// ---------------------------------------------------------------------------
// Tests — full logging flow
// ---------------------------------------------------------------------------

describe("Logging flow (e2e-style)", () => {
	it("shows Connecting -> Connected -> receives logs -> Disconnected", async () => {
		// Phase 1: Initial mount — not connected, no lines
		const { rerender } = render(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		expect(screen.getByText(/Connecting/)).toBeInTheDocument();
		expect(screen.getByText("No logs yet...")).toBeInTheDocument();

		// Phase 2: WebSocket opens
		setState({ isConnected: true, error: null });
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		expect(screen.getByText(/Connected/)).toBeInTheDocument();
		// Still no logs
		expect(screen.getByText("No logs yet...")).toBeInTheDocument();

		// Phase 3: Log lines arrive
		setState({ lines: ["line 1", "line 2"] });
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		expect(screen.getByText(/Connected/)).toBeInTheDocument();
		expect(screen.getByText("line 1")).toBeInTheDocument();
		expect(screen.getByText("line 2")).toBeInTheDocument();
		expect(screen.queryByText("No logs yet...")).not.toBeInTheDocument();

		// Phase 4: WebSocket closes normally (server finished)
		setState({
			isConnected: false,
			isReconnecting: false,
			error: null,
		});
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		// Should show disconnected indicator (stale data present)
		expect(screen.getByText(/disconnected/)).toBeInTheDocument();
		// Log lines still visible
		expect(screen.getByText("line 1")).toBeInTheDocument();
		expect(screen.getByText("line 2")).toBeInTheDocument();
	});

	it("shows Reconnecting on unexpected disconnect, then reconnects", async () => {
		const { rerender } = render(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		// Connected with data
		setState({ lines: ["line 1"], isConnected: true });
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);
		expect(screen.getByText(/Connected/)).toBeInTheDocument();

		// Unexpected disconnect
		setState({
			isConnected: false,
			isReconnecting: true,
			error: "Connection lost",
		});
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		// Shows reconnecting status — error hidden during reconnect
		expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
		expect(screen.queryByText("Connection lost")).not.toBeInTheDocument();
		// Lines preserved
		expect(screen.getByText("line 1")).toBeInTheDocument();

		// Reconnected successfully
		setState({
			isConnected: true,
			isReconnecting: false,
			error: null,
		});
		rerender(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		expect(screen.getByText(/Connected/)).toBeInTheDocument();
		// Lines still there
		expect(screen.getByText("line 1")).toBeInTheDocument();
	});

	it("shows error text when connection fails permanently (not reconnecting)", async () => {
		// Set error state BEFORE first render
		setState({
			lines: ["line 1"],
			isConnected: false,
			isReconnecting: false,
			error: "Connection refused",
		});

		const { rerender } = render(
			<WorkerDetail worker={baseWorker} planExecId="exec-1" workspace={baseWorkspace} />,
		);

		expect(screen.getByText("Connection refused")).toBeInTheDocument();
		expect(screen.queryByText(/Connecting/)).not.toBeInTheDocument();
		expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
	});

	it("tracks which workspace is connected", async () => {
		const worker1: WorkerInfo = { ...baseWorker, id: "ws-1" };
		const worker2: WorkerInfo = { ...baseWorker, id: "ws-2" };

		const { rerender } = render(
			<WorkerDetail
				worker={worker1}
				planExecId="exec-1"
				workspace={{ ...baseWorkspace, id: "ws-1" }}
			/>,
		);

		// Verify hook is called with the right params
		const lastCall = (id: string) =>
			mockUseWorkspaceLogStream.mock.calls[
				mockUseWorkspaceLogStream.mock.calls.length - 1
			];

		expect(lastCall("ws-1")).toEqual(["exec-1", "ws-1"]);

		// Switch worker
		rerender(
			<WorkerDetail
				worker={worker2}
				planExecId="exec-1"
				workspace={{ ...baseWorkspace, id: "ws-2" }}
			/>,
		);

		expect(lastCall("ws-2")).toEqual(["exec-1", "ws-2"]);
	});
});
