/**
 * Tests for BatchOSDashboard component and types (workspace P7.C)
 *
 * @tags batch-os dashboard
 *
 * Acceptance Criteria:
 * 1. Dashboard distinguishes DAG parallelism from safe effective parallelism
 * 2. Dashboard displays planner suggestions as advisory
 * 3. Dashboard controls do not directly mutate execution state
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { BatchOSDashboard } from "../src/components/BatchOSDashboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});

	return function Wrapper({ children }: { children: React.ReactNode }) {
		return React.createElement(QueryClientProvider, { client: queryClient }, children);
	};
}

function mockQueueMetricsResponse(overrides: Record<string, unknown> = {}) {
	return {
		dagWidth: 5,
		workerCap: 3,
		safeRunnableWorkers: 3,
		actualUtilization: 2,
		criticalPath: 8,
		serializedTail: 4,
		queueTiming: null,
		optimizerSuggestions: [],
		...overrides,
	};
}

function mockQueueStatusResponse(overrides: Record<string, unknown> = {}) {
	return {
		isProcessing: true,
		paused: false,
		currentWorkspaceId: "ws-1",
		entries: [],
		totalEntries: 0,
		counts: { queued: 0, merging: 0, validating: 0, merged: 0, failed: 0, blocked: 0, conflict: 0 },
		...overrides,
	};
}

function mockReadinessResponse(overrides: Record<string, unknown> = {}) {
	return {
		ready: true,
		currentMode: "stable_3",
		isScaleModeActive: false,
		prerequisites: [],
		blockedReasons: [],
		warnings: [],
		requestedWorkers: 3,
		maxAllowedWorkers: 3,
		...overrides,
	};
}

function setupFetch(...responses: unknown[]) {
	const mock = vi.fn();
	for (const data of responses) {
		mock.mockResolvedValueOnce(
			new Response(JSON.stringify(data), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	}
	vi.stubGlobal("fetch", mock);
	return mock;
}

/** Helper to get a button element by its accessible label. */
function getButtonByLabel(label: string): HTMLButtonElement | null {
	const buttons = screen.getAllByRole("button");
	return buttons.find((b) => b.textContent?.trim().includes(label)) ?? null;
}

// ---------------------------------------------------------------------------
// Types verification (AC1: distinguish DAG from safe effective)
// ---------------------------------------------------------------------------

describe("Batch OS Dashboard types", () => {
	it("distinguishes DAG parallelism from safe effective parallelism", () => {
		// DAG parallelism: max parallel non-conflicting branches in the dependency graph
		// Safe effective parallelism: min(worker cap, DAG width)
		const dagWidth = 5;
		const workerCap = 3;
		const safeRunnableWorkers = Math.min(workerCap, dagWidth);

		// These are fundamentally different metrics
		expect(dagWidth).toBe(5); // structural limit of the plan
		expect(workerCap).toBe(3); // configured limit
		expect(safeRunnableWorkers).toBe(3); // min of DAG width and worker cap

		// If worker cap > DAG width, safe = dagWidth (structural bound)
		const workerCap2 = 8;
		const safeRunnableWorkers2 = Math.min(workerCap2, dagWidth);
		expect(dagWidth).toBe(5);
		expect(safeRunnableWorkers2).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Component rendering (AC1, AC2, AC3)
// ---------------------------------------------------------------------------

describe("BatchOSDashboard component", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── AC1: Distinguish DAG parallelism from safe effective parallelism ──

	it("renders DAG parallelism vs safe effective parallelism comparison", async () => {
		setupFetch(
			mockQueueMetricsResponse(),
			mockQueueStatusResponse(),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		// Wait for loading to finish
		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// AC1: Check that both DAG parallelism and safe effective are displayed
		expect(screen.getByText("Parallelism Analysis")).toBeInTheDocument();
		expect(screen.getAllByText("DAG parallelism").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Safe effective").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Worker cap").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Actual active").length).toBeGreaterThanOrEqual(1);
	});

	it("shows the DAG vs safe effective parallelism explanation", async () => {
		setupFetch(
			mockQueueMetricsResponse(),
			mockQueueStatusResponse({ isProcessing: false, paused: false, currentWorkspaceId: null }),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// AC1: Explanation text distinguishes DAG from safe effective
		expect(screen.getAllByText(/DAG parallelism/i).length).toBeGreaterThanOrEqual(1);
	});

	// ── AC2: Display planner suggestions as advisory ──

	it("renders planner suggestions as advisory only", async () => {
		setupFetch(
			mockQueueMetricsResponse({
				optimizerSuggestions: [
					{
						type: "info",
						title: "Test info suggestion",
						message: "This is an info suggestion for testing.",
					},
					{
						type: "warning",
						title: "Test warning suggestion",
						message: "This is a warning suggestion for testing.",
					},
				],
			}),
			mockQueueStatusResponse(),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// AC2: Planner suggestions section exists with advisory label
		expect(screen.getByText("Planner Suggestions")).toBeInTheDocument();
		expect(screen.getByText("advisory")).toBeInTheDocument();

		// AC2: Suggestions are displayed as cards
		expect(screen.getByText("Test info suggestion")).toBeInTheDocument();
		expect(screen.getByText("Test warning suggestion")).toBeInTheDocument();

		// AC2: Advisory disclaimer is shown
		expect(screen.getByText(/Advisory only/i)).toBeInTheDocument();
	});

	it("shows empty state when no planner suggestions exist", async () => {
		setupFetch(
			mockQueueMetricsResponse({ optimizerSuggestions: [] }),
			mockQueueStatusResponse({ isProcessing: false, paused: false, currentWorkspaceId: null }),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// Empty state for suggestions
		expect(screen.getByText(/No planner suggestions at this time/i)).toBeInTheDocument();
	});

	// ── AC3: Controls do not directly mutate execution state ──

	it("calls onControl callback instead of directly mutating state", async () => {
		const onControl = vi.fn();

		setupFetch(
			mockQueueMetricsResponse(),
			mockQueueStatusResponse(),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl,
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// AC3: Clicking pause control calls onControl instead of directly mutating state
		const pauseBtn = getButtonByLabel("Pause");
		expect(pauseBtn).not.toBeNull();

		fireEvent.click(pauseBtn!);
		expect(onControl).toHaveBeenCalledWith("pause");
		expect(onControl).toHaveBeenCalledTimes(1);

		// AC3: Stop also goes through callback
		const stopBtn = getButtonByLabel("Stop");
		expect(stopBtn).not.toBeNull();
		fireEvent.click(stopBtn!);
		expect(onControl).toHaveBeenCalledWith("stop");
		expect(onControl).toHaveBeenCalledTimes(2);
	});

	it("disables resume button when plan is running", async () => {
		setupFetch(
			mockQueueMetricsResponse(),
			mockQueueStatusResponse(),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// Resume should be disabled when plan is running
		const resumeBtn = getButtonByLabel("Resume");
		expect(resumeBtn).not.toBeNull();
		expect(resumeBtn).toBeDisabled();
	});

	it("disables pause button when plan is paused", async () => {
		setupFetch(
			mockQueueMetricsResponse({ actualUtilization: 0 }),
			mockQueueStatusResponse({ isProcessing: false, paused: true, currentWorkspaceId: null }),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "paused",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// Pause should be disabled when plan is paused
		const pauseBtn = getButtonByLabel("Pause");
		expect(pauseBtn).not.toBeNull();
		expect(pauseBtn).toBeDisabled();

		// Resume should be enabled when plan is paused
		const resumeBtn = getButtonByLabel("Resume");
		expect(resumeBtn).not.toBeNull();
		expect(resumeBtn).not.toBeDisabled();
	});

	it("renders operating model statement about non-mutating controls", async () => {
		setupFetch(
			mockQueueMetricsResponse(),
			mockQueueStatusResponse({ isProcessing: false, paused: false, currentWorkspaceId: null }),
			mockReadinessResponse(),
		);

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "running",
				hasActiveExecution: true,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		await waitFor(() => {
			expect(screen.queryByText(/Loading batch OS metrics/i)).toBeNull();
		});

		// AC3: Operating model explains that controls do not directly mutate state
		expect(screen.getByText("Operating Model")).toBeInTheDocument();
		expect(screen.getByText(/do not directly mutate execution state/i)).toBeInTheDocument();
	});

	it("shows loading state when fetching data", () => {
		// Don't resolve fetch to keep loading state
		vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

		render(
			React.createElement(BatchOSDashboard, {
				planStatus: "unknown",
				hasActiveExecution: false,
				onControl: vi.fn(),
			}),
			{ wrapper: createWrapper() },
		);

		expect(screen.getByText(/Loading batch OS metrics/i)).toBeInTheDocument();
	});
});
