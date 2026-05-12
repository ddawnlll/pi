import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkerDetail } from "../src/components/WorkerDetail";
import type { WorkerInfo, WorkspaceSummary } from "../src/types";

// Mock framer-motion to avoid animation issues in jsdom
vi.mock("framer-motion", () => ({
	motion: {
		div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
			<div {...props}>{children}</div>,
		span: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
			<span {...props}>{children}</span>,
	},
	AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock the WebSocket hook to control state
import { vi } from "vitest";

const mockUseWorkspaceLogStream = vi.fn();
vi.mock("../src/hooks/useWorkspaceLogStream", () => ({
	useWorkspaceLogStream: (...args: unknown[]) => mockUseWorkspaceLogStream(...args),
}));

describe("WorkerDetail Live Logs status", () => {
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

	const defaultDetailProps = {
		worker: baseWorker,
		planExecId: "exec-1",
		workspace: baseWorkspace,
	};

	it('shows "Connected" when WebSocket is connected and lines exist', () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: ["line 1"],
			isConnected: true,
			isReconnecting: false,
			error: null,
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("Connected")).toBeInTheDocument();
	});

	it('shows "Connecting..." when not connected and no lines', () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: [],
			isConnected: false,
			isReconnecting: false,
			error: null,
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("Connecting...")).toBeInTheDocument();
	});

	it('shows "Disconnected" when not connected but has lines (stale data)', () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: ["old line"],
			isConnected: false,
			isReconnecting: false,
			error: null,
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("Disconnected")).toBeInTheDocument();
	});

	it('shows "Reconnecting..." during reconnection attempt', () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: ["line 1"],
			isConnected: false,
			isReconnecting: true,
			error: "Connection lost",
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
	});

	it("shows error text when an error is present (not reconnecting)", () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: ["line 1"],
			isConnected: false,
			isReconnecting: false,
			error: "Connection lost",
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("Connection lost")).toBeInTheDocument();
	});

	it('shows "No logs yet..." in the log area when lines are empty', () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: [],
			isConnected: true,
			isReconnecting: false,
			error: null,
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("No logs yet...")).toBeInTheDocument();
	});

	it("renders log lines when present", () => {
		mockUseWorkspaceLogStream.mockReturnValue({
			lines: ["line 1", "line 2"],
			isConnected: true,
			isReconnecting: false,
			error: null,
		});

		render(<WorkerDetail {...defaultDetailProps} />);

		expect(screen.getByText("line 1")).toBeInTheDocument();
		expect(screen.getByText("line 2")).toBeInTheDocument();
	});
});
