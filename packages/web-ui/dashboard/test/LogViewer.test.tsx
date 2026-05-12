import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LogViewer } from "../src/components/LogViewer";

describe("LogViewer", () => {
	const defaultProps = {
		lines: [] as string[],
		isConnected: false,
		hasData: undefined,
		activeStream: "stdout" as const,
		onSwitchStream: () => {},
		selectedWorkerId: "ws-1",
	};

	it('shows "Select a worker" when no worker is selected', () => {
		render(
			<LogViewer {...defaultProps} selectedWorkerId={null} />,
		);

		expect(
			screen.getByText("Select a worker to view details and logs"),
		).toBeInTheDocument();
	});

	it('shows "Connecting..." when not connected and no lines', () => {
		render(<LogViewer {...defaultProps} />);

		expect(screen.getByText("Connecting...")).toBeInTheDocument();
	});

	it('shows "No logs yet..." when connected but no lines', () => {
		render(<LogViewer {...defaultProps} isConnected={true} />);

		expect(screen.getByText("No logs yet...")).toBeInTheDocument();
	});

	it("renders log lines when present", () => {
		render(
			<LogViewer
				{...defaultProps}
				lines={["line 1", "line 2"]}
				isConnected={true}
			/>,
		);

		expect(screen.getByText("line 1")).toBeInTheDocument();
		expect(screen.getByText("line 2")).toBeInTheDocument();
		expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
		expect(screen.queryByText("No logs yet...")).not.toBeInTheDocument();
	});

	it("renders log lines even when disconnected (stale data)", () => {
		render(
			<LogViewer
				{...defaultProps}
				lines={["stale line"]}
				isConnected={false}
			/>,
		);

		expect(screen.getByText("stale line")).toBeInTheDocument();
		expect(screen.queryByText("Connecting...")).not.toBeInTheDocument();
	});

	it("shows stream switching buttons", () => {
		render(<LogViewer {...defaultProps} />);

		expect(screen.getByText("stdout")).toBeInTheDocument();
		expect(screen.getByText("stderr")).toBeInTheDocument();
		expect(screen.getByText("error")).toBeInTheDocument();
	});

	it("highlights the active stream button", () => {
		render(
			<LogViewer {...defaultProps} activeStream="stderr" />,
		);

		const stderrBtn = screen.getByText("stderr");
		expect(stderrBtn.className).toContain("bg-blue-600");
	});
});
