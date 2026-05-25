/**
 * Tests for DigestPage component (workspace 24.O — Daily Intelligence)
 *
 * @tags digest daily-intelligence
 *
 * Acceptance Criteria:
 * 1. DigestPage renders loading, error, and success states correctly
 * 2. Loading state shows skeleton placeholders
 * 3. Error state shows error message with retry button
 * 4. Success state renders MorningCard, SignalFeed, ProposalNudge, goals, reflections
 * 5. Inline error banner appears when refresh fails with existing data
 * 6. All sub-components handle empty state gracefully
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { DigestPage } from "../src/pages/DigestPage";

// ---------------------------------------------------------------------------
// Mock the useDigest hook
// ---------------------------------------------------------------------------

const mockUseDigest = vi.fn();

vi.mock("../src/hooks/useDigest", () => ({
	useDigest: () => mockUseDigest(),
}));

// ---------------------------------------------------------------------------
// Mock sub-components to simplify testing
// ---------------------------------------------------------------------------

vi.mock("../src/components/digest/MorningCard", () => ({
	MorningCard: ({ digest, loading, error, onRefresh }: any) =>
		React.createElement("div", {
			"data-testid": "morning-card",
			"data-digest": digest ? "loaded" : "null",
			"data-loading": String(loading),
			"data-error": error ?? "",
		}),
}));

vi.mock("../src/components/digest/SignalFeed", () => ({
	SignalFeed: ({ signals, loading, error, onRefresh }: any) =>
		React.createElement("div", {
			"data-testid": "signal-feed",
			"data-signals": signals ? String(signals.length) : "null",
			"data-loading": String(loading),
			"data-error": error ?? "",
		}),
}));

vi.mock("../src/components/digest/ProposalNudge", () => ({
	ProposalNudge: ({ proposals, loading, error, onRefresh }: any) =>
		React.createElement("div", {
			"data-testid": "proposal-nudge",
			"data-proposals": proposals ? String(proposals.length) : "null",
			"data-loading": String(loading),
			"data-error": error ?? "",
		}),
}));

vi.mock("../src/components/brain/common", () => ({
	LoadingSkeleton: ({ variant, count }: any) =>
		React.createElement("div", {
			"data-testid": "loading-skeleton",
			"data-variant": variant,
			"data-count": count,
		}),
	ErrorState: ({ message, details, onRetry }: any) =>
		React.createElement("div", {
			"data-testid": "error-state",
			"data-message": message,
			"data-details": details ?? "",
		}),
}));

// ---------------------------------------------------------------------------
// Mock morning digest data
// ---------------------------------------------------------------------------

function createMockDigest() {
	return {
		summary: {
			daemonState: "running",
			daemonUptime: "2h 34m",
			totalObservations: 24,
			criticalObservations: 2,
			activeSignals: 1,
			pendingProposals: 3,
			lastUpdated: new Date().toISOString(),
		},
		topSignals: [
			{
				id: "sig-001",
				type: "memory_pressure",
				title: "High memory pressure detected",
				severity: "warning",
				timestamp: new Date().toISOString(),
				resolved: false,
				details: "Memory usage at 85% of threshold",
			},
		],
		recentObservations: [],
		pendingProposals: [
			{
				id: "prop-001",
				title: "Optimize git lock contention",
				description: "Reduce lock contention in concurrent git operations",
				score: 78,
				riskLevel: "low",
				status: "pending",
				evidence: { memories: 3, observations: 2 },
				createdAt: new Date(Date.now() - 3600000).toISOString(),
			},
		],
		goalProgress: [
			{
				id: "goal-001",
				title: "Stable 6 rollout",
				progress: 85,
				status: "active",
				priority: "critical",
			},
		],
		reflectionCounts: {
			total: 12,
			today: 3,
			newMemories: 5,
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DigestPage", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	// ── Loading state (AC2) ─────────────────────────────────────────────────

	it("renders loading skeletons when digest is null and loading is true", () => {
		mockUseDigest.mockReturnValue({
			digest: null,
			loading: true,
			error: null,
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Should show loading skeletons
		const skeletons = screen.getAllByTestId("loading-skeleton");
		expect(skeletons.length).toBeGreaterThan(0);

		// Should not show content components
		expect(screen.queryByTestId("morning-card")).not.toBeInTheDocument();
		expect(screen.queryByTestId("error-state")).not.toBeInTheDocument();
	});

	// ── Error state (AC3) ───────────────────────────────────────────────────

	it("renders error state when digest is null and error is set", () => {
		mockUseDigest.mockReturnValue({
			digest: null,
			loading: false,
			error: "Unable to load morning digest",
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Should show error state
		const errorState = screen.getByTestId("error-state");
		expect(errorState).toBeInTheDocument();
		expect(errorState.getAttribute("data-message")).toBe("Unable to load morning digest");

		// Should not show content components
		expect(screen.queryByTestId("morning-card")).not.toBeInTheDocument();
		expect(screen.queryByTestId("loading-skeleton")).not.toBeInTheDocument();
	});

	// ── Success state (AC4) ─────────────────────────────────────────────────

	it("renders full digest layout when data is loaded", () => {
		const digest = createMockDigest();
		mockUseDigest.mockReturnValue({
			digest,
			loading: false,
			error: null,
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Should show MorningCard with digest data
		const morningCard = screen.getByTestId("morning-card");
		expect(morningCard).toBeInTheDocument();
		expect(morningCard.getAttribute("data-digest")).toBe("loaded");
		expect(morningCard.getAttribute("data-loading")).toBe("false");

		// Should show SignalFeed with signals
		const signalFeed = screen.getByTestId("signal-feed");
		expect(signalFeed).toBeInTheDocument();
		expect(signalFeed.getAttribute("data-signals")).toBe("1");

		// Should show ProposalNudge with proposals
		const proposalNudge = screen.getByTestId("proposal-nudge");
		expect(proposalNudge).toBeInTheDocument();
		expect(proposalNudge.getAttribute("data-proposals")).toBe("1");

		// Should render the date header
		expect(screen.getByText("Morning Digest")).toBeInTheDocument();

		// Should render goal progress section
		expect(screen.getByText("Goal Progress")).toBeInTheDocument();

		// Should render reflection counts
		expect(screen.getByText(/total reflections/)).toBeInTheDocument();
		expect(screen.getByText(/today/)).toBeInTheDocument();
	});

	// ── Inline error banner (AC5) ──────────────────────────────────────────

	it("shows inline error banner when refresh fails with existing data", () => {
		const digest = createMockDigest();
		mockUseDigest.mockReturnValue({
			digest,
			loading: false,
			error: "Failed to refresh",
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Should still show MorningCard with existing data
		const morningCard = screen.getByTestId("morning-card");
		expect(morningCard).toBeInTheDocument();
		expect(morningCard.getAttribute("data-digest")).toBe("loaded");

		// Should show error banner with the error text
		expect(screen.getByText(/Failed to refresh/)).toBeInTheDocument();
	});

	// ── Empty states (AC6) ─────────────────────────────────────────────────

	it("renders sub-components with empty arrays when no signals or proposals", () => {
		const digest = createMockDigest();
		digest.topSignals = [];
		digest.pendingProposals = [];

		mockUseDigest.mockReturnValue({
			digest,
			loading: false,
			error: null,
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// SignalFeed should receive empty array
		const signalFeed = screen.getByTestId("signal-feed");
		expect(signalFeed.getAttribute("data-signals")).toBe("0");

		// ProposalNudge should receive empty array
		const proposalNudge = screen.getByTestId("proposal-nudge");
		expect(proposalNudge.getAttribute("data-proposals")).toBe("0");

		// MorningCard should still render
		const morningCard = screen.getByTestId("morning-card");
		expect(morningCard).toBeInTheDocument();
	});

	it("does not render goal progress section when no goals exist", () => {
		const digest = createMockDigest();
		digest.goalProgress = [];

		mockUseDigest.mockReturnValue({
			digest,
			loading: false,
			error: null,
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Goal progress section should not be rendered
		expect(screen.queryByText("Goal Progress")).not.toBeInTheDocument();
	});

	it("passes loading state to sub-components during initial load", () => {
		mockUseDigest.mockReturnValue({
			digest: null,
			loading: true,
			error: null,
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// Only loading skeletons shown during initial load
		expect(screen.getAllByTestId("loading-skeleton").length).toBeGreaterThan(0);
	});

	it("passes error state to sub-components when data exists but error occurs", () => {
		const digest = createMockDigest();
		mockUseDigest.mockReturnValue({
			digest,
			loading: false,
			error: "Refresh failed",
			refresh: vi.fn(),
		});

		render(React.createElement(DigestPage));

		// MorningCard should receive error prop
		const morningCard = screen.getByTestId("morning-card");
		expect(morningCard.getAttribute("data-error")).toBe("Refresh failed");

		// SignalFeed should receive error prop
		const signalFeed = screen.getByTestId("signal-feed");
		expect(signalFeed.getAttribute("data-error")).toBe("Refresh failed");
	});
});
