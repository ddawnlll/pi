import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WarningBanner } from "../src/components/WarningBanner";
import type { PlanExecutionDetail, WorkspaceSummary, JournalEvent } from "../src/types";

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

const baseExecutionDetail: PlanExecutionDetail = {
	planExecutionId: "exec-1",
	phase: "execute",
	title: "Test Plan",
	status: "running",
	startedAt: Date.now() - 10 * 60 * 1000,
	completedAt: null,
	workspaces: [],
};

const noEvents: JournalEvent[] = [];

describe("Workspace Activity — hung detection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("never shows hung warning for terminal (complete) workspace", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-complete",
			stage: "complete",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: fiveMinutesAgo,
			updatedAt: fiveMinutesAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.queryByText(/may be hung/)).not.toBeInTheDocument();
	});

	it("never shows hung warning for terminal (failed) workspace", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-failed",
			stage: "failed",
			attempts: 2,
			error: "timeout",
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: fiveMinutesAgo,
			updatedAt: fiveMinutesAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.queryByText(/may be hung/)).not.toBeInTheDocument();
	});

	it("shows hung warning for active stale workspace using updatedAt", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-stale",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: null,
			updatedAt: fiveMinutesAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.getByText(/may be hung/)).toBeInTheDocument();
		expect(screen.getByText(/no activity for 5m/)).toBeInTheDocument();
	});

	it("shows hung warning for active stale workspace using lastActivityAt (preferred over updatedAt)", () => {
		const threeMinutesAgo = Date.now() - 3 * 60 * 1000 - 1;
		const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-activity",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: sixMinutesAgo - 5 * 60 * 1000,
			completedAt: null,
			// updatedAt is old but lastActivityAt is more recent
			updatedAt: sixMinutesAgo,
			lastActivityAt: threeMinutesAgo,
			lastActivitySource: "tool_call",
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		// Should show hung based on lastActivityAt, not updatedAt
		// 3m1s ago ≈ just over threshold, rounds to 3m
		expect(screen.getByText(/may be hung/)).toBeInTheDocument();
	});

	it("includes lastActivitySource in hung warning message", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-source",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: null,
			lastActivityAt: fiveMinutesAgo,
			lastActivitySource: "validation",
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		const warningEl = screen.getByText(/may be hung/);
		expect(warningEl.textContent).toContain("last: validation");
	});

	it("does not show hung warning for active workspace within threshold", () => {
		const oneMinuteAgo = Date.now() - 1 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-recent",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: oneMinuteAgo - 5 * 60 * 1000,
			completedAt: null,
			updatedAt: oneMinuteAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.queryByText(/may be hung/)).not.toBeInTheDocument();
	});

	it("falls back to startedAt when no lastActivityAt or updatedAt", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-startonly",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo,
			completedAt: null,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.getByText(/may be hung/)).toBeInTheDocument();
		expect(screen.getByText(/no activity for 5m/)).toBeInTheDocument();
	});

	it("skips hung detection when no timestamps are available", () => {
		const worker: WorkspaceSummary = {
			id: "ws-nots",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: null,
			completedAt: null,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.queryByText(/may be hung/)).not.toBeInTheDocument();
	});

	it("shows different lastActivitySource values correctly", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const sources = ["journal", "tool_call", "edit", "transcript"];

		for (const source of sources) {
			const worker: WorkspaceSummary = {
				id: `ws-${source}`,
				stage: "active",
				attempts: 1,
				error: null,
				startedAt: fiveMinutesAgo - 10 * 60 * 1000,
				completedAt: null,
				lastActivityAt: fiveMinutesAgo,
				lastActivitySource: source,
			};

			const { unmount } = render(
				<WarningBanner
					executionDetail={baseExecutionDetail}
					workers={[worker]}
					events={noEvents}
				/>,
			);

			expect(screen.getByText(new RegExp(`last: ${source}`))).toBeInTheDocument();
			unmount();
		}
	});

	it("does not include source info when lastActivitySource is absent", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-nosource",
			stage: "active",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: null,
			lastActivityAt: fiveMinutesAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		const warningEl = screen.getByText(/may be hung/);
		expect(warningEl.textContent).not.toContain("last:");
	});

	it("shows hung warning for blocked stale workspace", () => {
		const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
		const worker: WorkspaceSummary = {
			id: "ws-blocked",
			stage: "blocked",
			attempts: 1,
			error: null,
			startedAt: fiveMinutesAgo - 10 * 60 * 1000,
			completedAt: null,
			updatedAt: fiveMinutesAgo,
		};

		render(
			<WarningBanner
				executionDetail={baseExecutionDetail}
				workers={[worker]}
				events={noEvents}
			/>,
		);

		expect(screen.getByText(/may be hung/)).toBeInTheDocument();
	});
});
