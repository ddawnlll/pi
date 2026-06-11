/**
 * P45.S11 — Realistic Fixture Suite and Spec Quality Feedback Integration
 *
 * Provides realistic fixture data for exercising the full P45 safety control plane:
 * - Sample SpecQualityLedger entries across all outcome types
 * - Representative contract coverage scenarios
 * - Semantic conflict matrices of varying severity
 * - Async readiness test data
 * - Drift event sequences
 * - Failure/retry scenarios
 * - Governor input profiles (green, yellow, red)
 * - Progressive ramp test scenarios
 *
 * Also provides integration functions that wire the feedback loop:
 * SpecQualityLedger records → HistoryStore analysis → QualityGate evaluation
 * → Governor admission decision.
 */

import { evaluateGovernor, type GovernorInput } from "./adaptive-concurrency-governor.js";
import { classifyAsyncReadiness } from "./async-readiness-classifier.js";
import { type ContractCoverageItem, calculateCoverage } from "./contract-coverage-calculator.js";
import { evaluateQualityGate } from "./predictive-spec-quality-gate.js";
import { SemanticConflictAnalyzer } from "./semantic-conflict-analyzer.js";
import { SpecQualityHistoryStore } from "./spec-quality-history.js";
import { type SpecQualityEntry, SpecQualityLedger } from "./spec-quality-ledger.js";

// =============================================================================
// Fixture Data Generators
// =============================================================================

/** Generate a diverse set of SpecQualityLedger entries. */
export function generateFixtureLedgerEntries(count: number): SpecQualityEntry[] {
	const namespaces = ["ns-core", "ns-api", "ns-ui", "ns-data", "ns-accp"];
	const contracts = namespaces.map((ns) => `${ns}/contract.ts`);
	const outcomeTypes = [
		"matched",
		"compatible_drift",
		"breaking_drift",
		"missing",
		"unused",
		"overpredicted",
	] as const;
	const evidenceClasses = [
		"static_confirmation",
		"human_approval",
		"historical_pattern_confirmation",
		"llm_only",
		"unknown",
	] as const;

	const entries: SpecQualityEntry[] = [];

	for (let i = 0; i < count; i++) {
		const predictedOutcome = outcomeTypes[i % outcomeTypes.length];
		const actualOutcome = outcomeTypes[(i + 1) % outcomeTypes.length]; // deliberate drift

		entries.push({
			id: `fixture-${i}`,
			contract: contracts[i % contracts.length],
			namespace: namespaces[i % namespaces.length],
			predictedOutcome,
			actualOutcome,
			evidenceClass: evidenceClasses[i % evidenceClasses.length],
			recordedAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
			specVersion: "v1.0.0",
		});
	}

	return entries;
}

/** Generate representative contract coverage items. */
export function generateFixtureCoverageItems(): ContractCoverageItem[] {
	return [
		{ contract: "ns-core/core.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-core/types.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-core/config.ts", evidenceClass: "human_approval", required: true },
		{ contract: "ns-api/handler.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-api/routes.ts", evidenceClass: "historical_pattern_confirmation", required: true },
		{ contract: "ns-api/middleware.ts", evidenceClass: "llm_only", required: true },
		{ contract: "ns-ui/components.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-ui/styles.ts", evidenceClass: "llm_only", required: false },
		{ contract: "ns-data/models.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-data/queries.ts", evidenceClass: "human_approval", required: true },
		{ contract: "ns-accp/compiler.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-accp/validator.ts", evidenceClass: "static_confirmation", required: true },
		{ contract: "ns-core/legacy.ts", evidenceClass: "unknown", required: false },
	];
}

/** Generate a realistic conflict matrix. */
export function generateFixtureConflicts(): SemanticConflictAnalyzer {
	const analyzer = new SemanticConflictAnalyzer();

	const conflicts = [
		{
			ns: ["ns-core", "ns-api"] as [string, string],
			kind: "type_export_dependency" as const,
			severity: "low" as const,
			source: "types.ts",
		},
		{
			ns: ["ns-core", "ns-data"] as [string, string],
			kind: "type_export_dependency" as const,
			severity: "low" as const,
			source: "models.ts",
		},
		{
			ns: ["ns-api", "ns-ui"] as [string, string],
			kind: "api_shape_dependency" as const,
			severity: "medium" as const,
			source: "routes.ts",
		},
		{
			ns: ["ns-api", "ns-data"] as [string, string],
			kind: "read_model_assumption" as const,
			severity: "medium" as const,
			source: "queries.ts",
		},
		{
			ns: ["ns-ui", "ns-accp"] as [string, string],
			kind: "barrel_file_overlap" as const,
			severity: "low" as const,
			source: "index.ts",
		},
	];

	for (let i = 0; i < conflicts.length; i++) {
		const c = conflicts[i];
		analyzer.register({
			id: `fixture-conflict-${i}`,
			namespaces: c.ns,
			kind: c.kind,
			severity: c.severity,
			source: c.source,
			description: `Fixture conflict: ${c.kind} between ${c.ns[0]} and ${c.ns[1]}`,
			staticDetection: true,
			resolved: false,
		});
	}

	return analyzer;
}

/** Generate governor input profiles. */
export function generateGovernorProfile(profile: "green" | "yellow" | "red"): GovernorInput {
	const base: GovernorInput = {
		resources: { cpuUsage: 0, memoryUsage: 0, cpuPressure: false, memoryPressure: false },
		rateLimit: { tokensRemaining: 1000, limited: false, provider: "openai" },
		queues: {
			eventJournalDepth: 0,
			accpCompilerDepth: 0,
			artifactAcceptanceDepth: 0,
			assemblerDepth: 0,
			maxDepth: 100,
		},
		failureRate: { failureRate: 0, failures: 0, total: 1, throttleThreshold: 0.25 },
		signalStale: false,
		activeWorkers: 2,
		maxWorkersAtTier: 6,
		operatorVisibilityRemaining: 100,
		lastSampleAt: new Date().toISOString(),
	};

	switch (profile) {
		case "green":
			return base;
		case "yellow":
			return {
				...base,
				resources: { cpuUsage: 0.65, memoryUsage: 0.72, cpuPressure: false, memoryPressure: false },
				rateLimit: { tokensRemaining: 5, limited: true, provider: "openai" },
			};
		case "red":
			return {
				...base,
				resources: { cpuUsage: 0.85, memoryUsage: 0.9, cpuPressure: true, memoryPressure: true },
				rateLimit: { tokensRemaining: 0, limited: true, provider: "openai" },
				failureRate: { failureRate: 0.3, failures: 3, total: 10, throttleThreshold: 0.25 },
			};
	}
}

// =============================================================================
// Integration Feedback Loop
// =============================================================================

export interface FeedbackLoopInput {
	ledgerEntries: SpecQualityEntry[];
	coverageItems: ContractCoverageItem[];
	namespaces: string[];
	governorInput: GovernorInput;
	ledgerReliable: boolean;
}

export interface FeedbackLoopResult {
	/** Coverage verdict. */
	coverage: ReturnType<typeof calculateCoverage>;
	/** Quality gate verdict. */
	qualityGate: ReturnType<typeof evaluateQualityGate>;
	/** Conflict matrix. */
	conflictMatrix: ReturnType<SemanticConflictAnalyzer["buildMatrix"]>;
	/** Async readiness result. */
	asyncReadiness: ReturnType<typeof classifyAsyncReadiness>;
	/** Governor verdict. */
	governor: ReturnType<typeof evaluateGovernor>;
	/** Overall: can P45 proceed? */
	canProceed: boolean;
	/** Blocking reasons across all gates. */
	blockingReasons: string[];
}

/**
 * Run the full P45 safety control plane integration feedback loop.
 *
 * This is the function that ties everything together:
 * 1. Load ledger entries into history store
 * 2. Calculate contract coverage
 * 3. Evaluate quality gate
 * 4. Build conflict matrix from analyzer
 * 5. Classify async readiness
 * 6. Evaluate governor
 * 7. Return combined verdict
 */
export function runFeedbackLoop(input: FeedbackLoopInput): FeedbackLoopResult {
	const blockingReasons: string[] = [];

	// 1. Load ledger
	const ledger = new SpecQualityLedger();
	ledger.recordBatch(input.ledgerEntries);

	// 2. Coverage
	const coverage = calculateCoverage(input.coverageItems);
	if (!coverage.admitted) {
		blockingReasons.push(...coverage.blockingReasons);
	}

	// 3. Quality gate
	const historyStore = new SpecQualityHistoryStore(ledger);
	const trend = historyStore.analyzeTrend(new Date().toISOString());
	const qualityGate = evaluateQualityGate({
		coverage,
		trend,
		ledgerReliable: input.ledgerReliable,
	});
	if (!qualityGate.freezePermitted) {
		blockingReasons.push(...qualityGate.blockingReasons);
	}

	// 4. Conflict matrix (use fixture)
	const analyzer = generateFixtureConflicts();
	const conflictMatrix = analyzer.buildMatrix();

	// 5. Async readiness
	const asyncReadiness = classifyAsyncReadiness(input.namespaces, conflictMatrix);
	if (!asyncReadiness.asyncAllowed) {
		blockingReasons.push(...asyncReadiness.blockingReasons);
	}

	// 6. Governor
	const governor = evaluateGovernor(input.governorInput);
	if (!governor.canAdmit) {
		blockingReasons.push(...governor.blockingReasons);
	}

	return {
		coverage,
		qualityGate,
		conflictMatrix,
		asyncReadiness,
		governor,
		canProceed: blockingReasons.length === 0,
		blockingReasons,
	};
}
