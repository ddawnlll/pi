import { describe, expect, it } from "vitest";
import {
	generateFixtureConflicts,
	generateFixtureCoverageItems,
	generateFixtureLedgerEntries,
	generateGovernorProfile,
	runFeedbackLoop,
} from "../../src/core/assembly/realistic-fixtures.js";

// =============================================================================
// Fixture Generation Tests
// =============================================================================

describe("RealisticFixtures — generation", () => {
	it("generates the requested number of ledger entries", () => {
		const entries = generateFixtureLedgerEntries(50);
		expect(entries).toHaveLength(50);
		expect(entries[0].id).toBe("fixture-0");
		expect(entries[49].id).toBe("fixture-49");
	});

	it("ledger entries span all outcome types", () => {
		const entries = generateFixtureLedgerEntries(20);
		const outcomes = new Set(entries.map((e) => e.actualOutcome));
		expect(outcomes.size).toBeGreaterThanOrEqual(4); // diverse
	});

	it("generates coverage items for all namespaces", () => {
		const items = generateFixtureCoverageItems();
		expect(items.length).toBeGreaterThan(5);
		expect(items.some((i) => i.evidenceClass === "static_confirmation")).toBe(true);
		expect(items.some((i) => i.evidenceClass === "llm_only")).toBe(true);
		expect(items.some((i) => i.evidenceClass === "unknown")).toBe(true);
	});

	it("generates conflict matrix with conflicts", () => {
		const analyzer = generateFixtureConflicts();
		const matrix = analyzer.buildMatrix();
		expect(matrix.totalConflicts).toBeGreaterThan(0);
		expect(matrix.conflicts.length).toBeGreaterThan(0);
	});

	it("generates green governor profile", () => {
		const input = generateGovernorProfile("green");
		expect(input.resources.cpuUsage).toBe(0);
		expect(input.rateLimit.tokensRemaining).toBeGreaterThan(0);
	});

	it("generates yellow governor profile", () => {
		const input = generateGovernorProfile("yellow");
		expect(input.resources.cpuUsage).toBeGreaterThan(0.5);
		expect(input.rateLimit.tokensRemaining).toBeLessThan(10);
	});

	it("generates red governor profile", () => {
		const input = generateGovernorProfile("red");
		expect(input.resources.cpuUsage).toBeGreaterThan(0.8);
		expect(input.rateLimit.tokensRemaining).toBe(0);
		expect(input.failureRate.failureRate).toBeGreaterThanOrEqual(0.25);
	});
});

// =============================================================================
// Feedback Loop Integration Tests
// =============================================================================

describe("FeedbackLoop — integration", () => {
	it("green profile with good coverage allows proceed", () => {
		const result = runFeedbackLoop({
			ledgerEntries: generateFixtureLedgerEntries(50),
			coverageItems: generateFixtureCoverageItems(),
			namespaces: ["ns-core", "ns-api", "ns-ui", "ns-data", "ns-accp"],
			governorInput: generateGovernorProfile("green"),
			ledgerReliable: true,
		});

		// Should proceed since all coverage items have >70% hard coverage
		expect(result.coverage.admitted).toBe(true);
		expect(result.governor.signal).toBe("green");
	});

	it("red governor profile blocks proceed", () => {
		const result = runFeedbackLoop({
			ledgerEntries: generateFixtureLedgerEntries(50),
			coverageItems: generateFixtureCoverageItems(),
			namespaces: ["ns-core", "ns-api", "ns-ui", "ns-data", "ns-accp"],
			governorInput: generateGovernorProfile("red"),
			ledgerReliable: true,
		});

		expect(result.governor.canAdmit).toBe(false);
		expect(result.canProceed).toBe(false);
	});

	it("empty coverage items block proceed", () => {
		const result = runFeedbackLoop({
			ledgerEntries: generateFixtureLedgerEntries(50),
			coverageItems: [],
			namespaces: ["ns-a", "ns-b"],
			governorInput: generateGovernorProfile("green"),
			ledgerReliable: true,
		});

		expect(result.coverage.admitted).toBe(false);
		expect(result.canProceed).toBe(false);
		expect(result.blockingReasons.length).toBeGreaterThan(0);
	});

	it("feedback loop produces complete output structure", () => {
		const result = runFeedbackLoop({
			ledgerEntries: generateFixtureLedgerEntries(50),
			coverageItems: generateFixtureCoverageItems(),
			namespaces: ["ns-core", "ns-api", "ns-ui", "ns-data", "ns-accp"],
			governorInput: generateGovernorProfile("green"),
			ledgerReliable: true,
		});

		expect(result.coverage).toBeDefined();
		expect(result.qualityGate).toBeDefined();
		expect(result.conflictMatrix).toBeDefined();
		expect(result.asyncReadiness).toBeDefined();
		expect(result.governor).toBeDefined();
		expect(result.canProceed).toBeDefined();
		expect(result.blockingReasons).toBeDefined();
	});

	it("single namespace cannot run async", () => {
		const result = runFeedbackLoop({
			ledgerEntries: generateFixtureLedgerEntries(50),
			coverageItems: generateFixtureCoverageItems(),
			namespaces: ["ns-core"],
			governorInput: generateGovernorProfile("green"),
			ledgerReliable: true,
		});

		expect(result.asyncReadiness.asyncAllowed).toBe(false);
	});
});
