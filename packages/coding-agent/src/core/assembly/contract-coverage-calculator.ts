/**
 * P45.S2 — Contract Coverage Calculator with Evidence-Class Metrics
 *
 * Calculates hardCoverage, softCoverage, llmOnlyRatio, and unknownRequiredContracts
 * using evidence classes. Coverage is not LLM confidence — it is calculated from
 * static confirmation, human approval, historical pattern confirmation, LLM-only
 * proposals, and unknown required contracts.
 *
 * Evidence classes (from most to least authoritative):
 * - static_confirmation: proven by static analysis or compiler
 * - human_approval: explicitly approved by human operator
 * - historical_pattern_confirmation: confirmed by repeated past success
 * - llm_only: only predicted by LLM, no external verification
 * - unknown: no evidence whatsoever
 *
 * Hard coverage threshold (must pass for admission):
 *   (static + human + historical) / total >= hardThreshold
 *
 * Soft coverage threshold (warn/downgrade if below):
 *   (static + human + historical + llm_only * 0.5) / total >= softThreshold
 */

// =============================================================================
// Types
// =============================================================================

export type CoverageEvidenceClass =
	| "static_confirmation"
	| "human_approval"
	| "historical_pattern_confirmation"
	| "llm_only"
	| "unknown";

export interface ContractCoverageItem {
	/** Contract identifier (name, path, or route key). */
	contract: string;
	/** Evidence class assigned to this contract's coverage. */
	evidenceClass: CoverageEvidenceClass;
	/** Whether this contract was explicitly required by the spec. */
	required: boolean;
}

export interface CoverageSummary {
	/** Total number of contracts assessed. */
	totalContracts: number;
	/** Number of contracts confirmed by static analysis. */
	staticCount: number;
	/** Number of contracts approved by human. */
	humanCount: number;
	/** Number of contracts confirmed by historical pattern. */
	historicalCount: number;
	/** Number of contracts with only LLM prediction. */
	llmOnlyCount: number;
	/** Number of contracts with unknown evidence. */
	unknownCount: number;
	/** Hard coverage ratio: (static+human+historical) / total. */
	hardCoverage: number;
	/** Soft coverage ratio: (static+human+historical + llm*0.5) / total. */
	softCoverage: number;
	/** Ratio of LLM-only contracts to total. */
	llmOnlyRatio: number;
	/** Count of unknown required contracts (blocking). */
	unknownRequiredCount: number;
	/** Whether hard coverage threshold is met. */
	hardCoveragePassed: boolean;
	/** Whether soft coverage threshold is met. */
	softCoveragePassed: boolean;
	/** Whether llm_only ratio exceeds the allowed maximum. */
	llmOnlyRatioExceeded: boolean;
}

export interface CoverageThresholds {
	/** Minimum hard coverage ratio (default: 0.70). */
	hardThreshold: number;
	/** Minimum soft coverage ratio (default: 0.85). */
	softThreshold: number;
	/** Maximum allowed llm_only ratio (default: 0.30). */
	maxLlmOnlyRatio: number;
}

export interface CoverageVerdict {
	/** Whether coverage is sufficient for admission. */
	admitted: boolean;
	/** Detailed summary of coverage. */
	summary: CoverageSummary;
	/** Blocking reasons if admission is denied. */
	blockingReasons: string[];
	/** Warnings that don't block but should be addressed. */
	warnings: string[];
}

// =============================================================================
// Default Thresholds
// =============================================================================

export const DEFAULT_COVERAGE_THRESHOLDS: CoverageThresholds = {
	hardThreshold: 0.7,
	softThreshold: 0.85,
	maxLlmOnlyRatio: 0.3,
};

// =============================================================================
// Calculator
// =============================================================================

/**
 * Calculate contract coverage from a list of contract items.
 */
export function calculateCoverage(
	items: ContractCoverageItem[],
	thresholds: CoverageThresholds = DEFAULT_COVERAGE_THRESHOLDS,
): CoverageVerdict {
	const total = items.length;
	if (total === 0) {
		return {
			admitted: false,
			summary: emptySummary(),
			blockingReasons: ["No contracts to assess — coverage is undefined"],
			warnings: [],
		};
	}

	let staticCount = 0;
	let humanCount = 0;
	let historicalCount = 0;
	let llmOnlyCount = 0;
	let unknownCount = 0;
	let unknownRequiredCount = 0;

	for (const item of items) {
		switch (item.evidenceClass) {
			case "static_confirmation":
				staticCount++;
				break;
			case "human_approval":
				humanCount++;
				break;
			case "historical_pattern_confirmation":
				historicalCount++;
				break;
			case "llm_only":
				llmOnlyCount++;
				break;
			case "unknown":
				unknownCount++;
				if (item.required) unknownRequiredCount++;
				break;
		}
	}

	const hardCoverage = round3((staticCount + humanCount + historicalCount) / total);
	const softCoverage = round3((staticCount + humanCount + historicalCount + llmOnlyCount * 0.5) / total);
	const llmOnlyRatio = round3(llmOnlyCount / total);

	const blockingReasons: string[] = [];
	const warnings: string[] = [];

	// Hard coverage check (blocks admission)
	const hardCoveragePassed = hardCoverage >= thresholds.hardThreshold;
	if (!hardCoveragePassed) {
		blockingReasons.push(`Hard coverage ${hardCoverage} is below threshold ${thresholds.hardThreshold}`);
	}

	// Unknown required contracts check (blocks admission)
	if (unknownRequiredCount > 0) {
		blockingReasons.push(`${unknownRequiredCount} required contract(s) have unknown evidence class`);
	}

	// Soft coverage check (warns, doesn't block)
	const softCoveragePassed = softCoverage >= thresholds.softThreshold;
	if (!softCoveragePassed && hardCoveragePassed) {
		warnings.push(`Soft coverage ${softCoverage} is below threshold ${thresholds.softThreshold}`);
	}

	// LLM-only ratio check (blocks if exceeded)
	const llmOnlyRatioExceeded = llmOnlyRatio > thresholds.maxLlmOnlyRatio;
	if (llmOnlyRatioExceeded) {
		blockingReasons.push(`LLM-only ratio ${llmOnlyRatio} exceeds maximum ${thresholds.maxLlmOnlyRatio}`);
	}

	const summary: CoverageSummary = {
		totalContracts: total,
		staticCount,
		humanCount,
		historicalCount,
		llmOnlyCount,
		unknownCount,
		hardCoverage,
		softCoverage,
		llmOnlyRatio,
		unknownRequiredCount,
		hardCoveragePassed,
		softCoveragePassed,
		llmOnlyRatioExceeded,
	};

	return {
		admitted: blockingReasons.length === 0,
		summary,
		blockingReasons,
		warnings,
	};
}

/**
 * Merge coverage results from multiple namespaces into a single summary.
 */
export function mergeCoverageSummaries(summaries: CoverageSummary[]): CoverageSummary {
	if (summaries.length === 0) return emptySummary();

	const merged: CoverageSummary = {
		totalContracts: 0,
		staticCount: 0,
		humanCount: 0,
		historicalCount: 0,
		llmOnlyCount: 0,
		unknownCount: 0,
		hardCoverage: 0,
		softCoverage: 0,
		llmOnlyRatio: 0,
		unknownRequiredCount: 0,
		hardCoveragePassed: true,
		softCoveragePassed: true,
		llmOnlyRatioExceeded: false,
	};

	for (const s of summaries) {
		merged.totalContracts += s.totalContracts;
		merged.staticCount += s.staticCount;
		merged.humanCount += s.humanCount;
		merged.historicalCount += s.historicalCount;
		merged.llmOnlyCount += s.llmOnlyCount;
		merged.unknownCount += s.unknownCount;
		merged.unknownRequiredCount += s.unknownRequiredCount;
		if (!s.hardCoveragePassed) merged.hardCoveragePassed = false;
		if (!s.softCoveragePassed) merged.softCoveragePassed = false;
		if (s.llmOnlyRatioExceeded) merged.llmOnlyRatioExceeded = true;
	}

	const total = merged.totalContracts;
	if (total > 0) {
		merged.hardCoverage = round3((merged.staticCount + merged.humanCount + merged.historicalCount) / total);
		merged.softCoverage = round3(
			(merged.staticCount + merged.humanCount + merged.historicalCount + merged.llmOnlyCount * 0.5) / total,
		);
		merged.llmOnlyRatio = round3(merged.llmOnlyCount / total);
	}

	return merged;
}

// =============================================================================
// Helpers
// =============================================================================

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function emptySummary(): CoverageSummary {
	return {
		totalContracts: 0,
		staticCount: 0,
		humanCount: 0,
		historicalCount: 0,
		llmOnlyCount: 0,
		unknownCount: 0,
		hardCoverage: 0,
		softCoverage: 0,
		llmOnlyRatio: 0,
		unknownRequiredCount: 0,
		hardCoveragePassed: false,
		softCoveragePassed: false,
		llmOnlyRatioExceeded: false,
	};
}
