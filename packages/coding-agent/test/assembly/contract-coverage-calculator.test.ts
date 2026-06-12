import { describe, expect, it } from "vitest";
import {
	type ContractCoverageItem,
	type CoverageThresholds,
	calculateCoverage,
	mergeCoverageSummaries,
} from "../../src/core/assembly/contract-coverage-calculator.js";

// =============================================================================
// Helpers
// =============================================================================

function staticItem(contract: string, required = true): ContractCoverageItem {
	return { contract, evidenceClass: "static_confirmation", required };
}

function humanItem(contract: string): ContractCoverageItem {
	return { contract, evidenceClass: "human_approval", required: true };
}

function historicalItem(contract: string): ContractCoverageItem {
	return { contract, evidenceClass: "historical_pattern_confirmation", required: true };
}

function llmItem(contract: string): ContractCoverageItem {
	return { contract, evidenceClass: "llm_only", required: true };
}

function unknownItem(contract: string, required = true): ContractCoverageItem {
	return { contract, evidenceClass: "unknown", required };
}

// =============================================================================
// Positive Path Tests
// =============================================================================

describe("ContractCoverageCalculator — positive path", () => {
	it("all static confirmation produces perfect coverage", () => {
		const items = [staticItem("a"), staticItem("b"), staticItem("c")];
		const verdict = calculateCoverage(items);

		expect(verdict.admitted).toBe(true);
		expect(verdict.summary.hardCoverage).toBe(1.0);
		expect(verdict.summary.softCoverage).toBe(1.0);
		expect(verdict.summary.llmOnlyRatio).toBe(0);
		expect(verdict.summary.staticCount).toBe(3);
		expect(verdict.blockingReasons).toHaveLength(0);
	});

	it("mixed evidence classes compute correctly", () => {
		const items = [staticItem("a"), staticItem("b"), humanItem("c"), historicalItem("d"), llmItem("e")];
		const verdict = calculateCoverage(items);

		expect(verdict.summary.staticCount).toBe(2);
		expect(verdict.summary.humanCount).toBe(1);
		expect(verdict.summary.historicalCount).toBe(1);
		expect(verdict.summary.llmOnlyCount).toBe(1);
		// hard = (2+1+1)/5 = 0.8
		expect(verdict.summary.hardCoverage).toBe(0.8);
		// soft = (2+1+1+0.5)/5 = 0.9
		expect(verdict.summary.softCoverage).toBe(0.9);
		expect(verdict.summary.llmOnlyRatio).toBe(0.2);
		expect(verdict.admitted).toBe(true);
	});

	it("high hard coverage with some llm_only is still admitted", () => {
		const items = [...Array.from({ length: 8 }, (_, i) => staticItem(`s${i}`)), llmItem("l1"), llmItem("l2")];
		const verdict = calculateCoverage(items);
		// hard = 8/10 = 0.8, llm = 2/10 = 0.2
		expect(verdict.admitted).toBe(true);
		expect(verdict.summary.hardCoverage).toBe(0.8);
		expect(verdict.summary.llmOnlyRatio).toBe(0.2);
	});

	it("custom thresholds allow stricter admission", () => {
		const strictThresholds: CoverageThresholds = {
			hardThreshold: 0.9,
			softThreshold: 0.95,
			maxLlmOnlyRatio: 0.1,
		};

		// 8 static + 1 human + 1 llm = 10 total
		// hard = 9/10 = 0.9, llm = 0.1
		const items = [...Array.from({ length: 8 }, (_, i) => staticItem(`s${i}`)), humanItem("h1"), llmItem("l1")];
		const verdict = calculateCoverage(items, strictThresholds);
		expect(verdict.admitted).toBe(true);
	});

	it("unknown non-required contracts do not block when hard coverage is sufficient", () => {
		// Need enough hard evidence to hit threshold: 7 static + 1 unknown non-required = 8 total, hard = 7/8 = 0.875
		const items = [...Array.from({ length: 7 }, (_, i) => staticItem(`s${i}`)), unknownItem("u1", false)];
		const verdict = calculateCoverage(items);
		expect(verdict.admitted).toBe(true);
		expect(verdict.blockingReasons).toHaveLength(0);
		expect(verdict.summary.unknownCount).toBe(1);
		expect(verdict.summary.unknownRequiredCount).toBe(0);
	});

	it("warnings produced for soft coverage below threshold", () => {
		const items = [staticItem("a"), staticItem("b"), llmItem("l1"), llmItem("l2"), llmItem("l3")];
		// hard = 2/5 = 0.4 (below 0.7)
		const verdict = calculateCoverage(items);
		// hard coverage fails, so it blocks
		expect(verdict.admitted).toBe(false);
	});

	it("mergeCoverageSummaries combines correctly", () => {
		const s1 = calculateCoverage([staticItem("a"), staticItem("b")]).summary;
		const s2 = calculateCoverage([humanItem("c"), llmItem("d")]).summary;
		const merged = mergeCoverageSummaries([s1, s2]);

		expect(merged.totalContracts).toBe(4);
		expect(merged.staticCount).toBe(2);
		expect(merged.humanCount).toBe(1);
		expect(merged.llmOnlyCount).toBe(1);
		expect(merged.hardCoverage).toBe(0.75); // 3/4
		expect(merged.softCoverage).toBe(0.875); // 3.5/4
	});
});

// =============================================================================
// Negative Path Tests
// =============================================================================

describe("ContractCoverageCalculator — negative path", () => {
	it("empty contract list blocks admission", () => {
		const verdict = calculateCoverage([]);
		expect(verdict.admitted).toBe(false);
		expect(verdict.blockingReasons.length).toBeGreaterThan(0);
		expect(verdict.blockingReasons[0]).toContain("No contracts");
	});

	it("hard coverage below default threshold blocks", () => {
		// 6 static + 4 llm = 10, hard = 6/10 = 0.6 (< 0.7)
		const items = [
			...Array.from({ length: 6 }, (_, i) => staticItem(`s${i}`)),
			...Array.from({ length: 4 }, (_, i) => llmItem(`l${i}`)),
		];
		const verdict = calculateCoverage(items);
		expect(verdict.admitted).toBe(false);
		expect(verdict.blockingReasons.some((r) => r.includes("Hard coverage"))).toBe(true);
	});

	it("unknown required contracts block admission", () => {
		const items = [staticItem("a"), staticItem("b"), unknownItem("u1", true)];
		const verdict = calculateCoverage(items);
		expect(verdict.admitted).toBe(false);
		expect(verdict.blockingReasons.some((r) => r.includes("unknown evidence"))).toBe(true);
		expect(verdict.summary.unknownRequiredCount).toBe(1);
	});

	it("llm_only ratio exceeding threshold blocks", () => {
		// 4 static + 6 llm = 10, llm ratio = 0.6 (> 0.3)
		const items = [
			...Array.from({ length: 4 }, (_, i) => staticItem(`s${i}`)),
			...Array.from({ length: 6 }, (_, i) => llmItem(`l${i}`)),
		];
		const verdict = calculateCoverage(items);
		expect(verdict.admitted).toBe(false);
		expect(verdict.blockingReasons.some((r) => r.includes("LLM-only ratio"))).toBe(true);
		expect(verdict.summary.llmOnlyRatioExceeded).toBe(true);
	});

	it("multiple blocking reasons can coexist", () => {
		const items = [llmItem("l1"), llmItem("l2"), llmItem("l3"), unknownItem("u1", true)];
		// hard = 0/4 = 0, llm ratio = 3/4 = 0.75, unknown required
		const verdict = calculateCoverage(items);
		expect(verdict.admitted).toBe(false);
		expect(verdict.blockingReasons.length).toBeGreaterThanOrEqual(2);
	});

	it("custom strict thresholds reject borderline coverage", () => {
		const strict: CoverageThresholds = { hardThreshold: 0.95, softThreshold: 0.98, maxLlmOnlyRatio: 0.05 };
		// 9 static + 1 llm = 10, hard = 0.9 (< 0.95), llm = 0.1 (> 0.05)
		const items = [...Array.from({ length: 9 }, (_, i) => staticItem(`s${i}`)), llmItem("l1")];
		const verdict = calculateCoverage(items, strict);
		expect(verdict.admitted).toBe(false);
	});

	it("all unknown contracts yield zero coverage", () => {
		const items = [unknownItem("u1"), unknownItem("u2"), unknownItem("u3", false)];
		const verdict = calculateCoverage(items);
		expect(verdict.summary.hardCoverage).toBe(0);
		expect(verdict.summary.softCoverage).toBe(0);
		expect(verdict.admitted).toBe(false);
	});

	it("merge empty summary list returns empty summary", () => {
		const merged = mergeCoverageSummaries([]);
		expect(merged.totalContracts).toBe(0);
	});

	it("summary counts are exact even with large item sets", () => {
		const items = Array.from({ length: 1000 }, (_, i) => {
			if (i < 700) return staticItem(`s${i}`);
			if (i < 850) return humanItem(`h${i}`);
			if (i < 950) return historicalItem(`r${i}`);
			if (i < 990) return llmItem(`l${i}`);
			return unknownItem(`u${i}`, false); // non-required unknowns
		});

		const verdict = calculateCoverage(items);
		expect(verdict.summary.totalContracts).toBe(1000);
		expect(verdict.summary.staticCount).toBe(700);
		expect(verdict.summary.humanCount).toBe(150);
		expect(verdict.summary.historicalCount).toBe(100);
		expect(verdict.summary.llmOnlyCount).toBe(40);
		expect(verdict.summary.unknownCount).toBe(10);
		expect(verdict.summary.unknownRequiredCount).toBe(0);
		// hard = 950/1000 = 0.95
		expect(verdict.summary.hardCoverage).toBe(0.95);
		expect(verdict.admitted).toBe(true);
	});
});
