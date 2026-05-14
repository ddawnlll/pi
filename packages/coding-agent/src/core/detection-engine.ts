/**
 * Detection Engine - P8.D
 *
 * Core engine for bug, risk, and improvement detection. Turns
 * repository analysis data from P8.C scanner output into categorized,
 * risk-scored, evidence-backed detection findings.
 *
 * Acceptance Criteria:
 * 1. Each proposal includes risk, confidence, evidence, and requiresApproval.
 * 2. False-positive handling is tracked.
 * 3. Unsafe suggestions are flagged and cannot proceed.
 */

import type {
	ConfidenceLevel,
	DetectionCategory,
	DetectionEvidenceItem,
	DetectionOutput,
	DetectionResult,
	RiskLevel,
	UnsafeCheckResult,
} from "./detection-types.js";
import { generateDetectionId } from "./detection-types.js";
import type { FalsePositiveTracker } from "./false-positive-tracker.js";
import type { UnsafeSuggestionGuard } from "./unsafe-suggestion-guard.js";

// ---------------------------------------------------------------------------
// Scanner Input Types
// ---------------------------------------------------------------------------

/**
 * Input data from the repo scanner (P8.C) that feeds into detection analysis.
 *
 * This is the raw analysis data that the detection engine processes
 * to produce scored and categorized findings.
 */
export interface ScannerInput {
	/** Hot files (frequently modified) */
	hotFiles?: Array<{
		path: string;
		modificationCount: number;
		recentChanges: number;
	}>;
	/** Conflict-heavy files */
	conflictFiles?: Array<{
		path: string;
		conflictCount: number;
		aheadBy: number;
	}>;
	/** Test instability data */
	testInstability?: Array<{
		testFile: string;
		failCount: number;
		flakyRate: number;
	}>;
	/** Validation slowness data */
	validationSlowness?: Array<{
		command: string;
		averageDurationMs: number;
		frequency: number;
	}>;
	/** Dead code candidates */
	deadCode?: Array<{
		file: string;
		symbol: string;
		reason: string;
	}>;
	/** Duplicate logic candidates */
	duplicateLogic?: Array<{
		locations: string[];
		similarity: number;
		description: string;
	}>;
	/** Serialization bottlenecks from workspace dependencies */
	serializationBottlenecks?: Array<{
		workspaceId: string;
		dependencyChain: string[];
		bottleneckScore: number;
	}>;
	/** Worker underutilization data */
	workerUnderutilization?: Array<{
		batchIndex: number;
		usedWorkers: number;
		availableWorkers: number;
	}>;
	/** File overlap data */
	fileOverlaps?: Array<{
		files: string[];
		workspaces: string[];
	}>;
	/** Test coverage gaps */
	coverageGaps?: Array<{
		file: string;
		untestedLines: number;
		totalLines: number;
		coverage: number;
	}>;
	/** Documentation gaps */
	docGaps?: Array<{
		file: string;
		publicApiCount: number;
		documentedCount: number;
	}>;
	/** Dependency issues */
	dependencyIssues?: Array<{
		description: string;
		severity: "warning" | "error";
		workspaces: string[];
	}>;
}

// ---------------------------------------------------------------------------
// Detection Engine Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the detection engine.
 */
export interface DetectionEngineConfig {
	/** Whether to use the false-positive tracker */
	useFalsePositiveTracker?: boolean;
	/** Whether to use the unsafe suggestion guard */
	useUnsafeGuard?: boolean;
	/** Threshold for considering something a false positive (0-1) */
	falsePositiveThreshold?: number;
	/** Confidence threshold for requiring approval (0-1) */
	confidenceThreshold?: number;
}

const DEFAULT_CONFIG: DetectionEngineConfig = {
	useFalsePositiveTracker: true,
	useUnsafeGuard: true,
	falsePositiveThreshold: 0.3,
	confidenceThreshold: 0.5,
};

// ---------------------------------------------------------------------------
// Detection Engine
// ---------------------------------------------------------------------------

/**
 * Detection Engine - turns scanner inputs into risk-scored detections.
 *
 * Analyzes scanner output, applies risk and confidence scoring,
 * checks for false positives and unsafe suggestions, and produces
 * a complete DetectionOutput with all findings.
 */
export class DetectionEngine {
	private config: DetectionEngineConfig;
	private falsePositiveTracker?: FalsePositiveTracker;
	private unsafeGuard?: UnsafeSuggestionGuard;

	constructor(
		config?: DetectionEngineConfig,
		falsePositiveTracker?: FalsePositiveTracker,
		unsafeGuard?: UnsafeSuggestionGuard,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.falsePositiveTracker = falsePositiveTracker;
		this.unsafeGuard = unsafeGuard;
	}

	/**
	 * Set the false-positive tracker instance.
	 */
	setFalsePositiveTracker(tracker: FalsePositiveTracker): void {
		this.falsePositiveTracker = tracker;
	}

	/**
	 * Set the unsafe suggestion guard instance.
	 */
	setUnsafeGuard(guard: UnsafeSuggestionGuard): void {
		this.unsafeGuard = guard;
	}

	/**
	 * Analyze scanner input and produce detection findings.
	 *
	 * This is the main entry point for the detection engine. It:
	 * 1. Processes each scanner input category into detection findings
	 * 2. Assigns risk, confidence, evidence, and requiresApproval
	 * 3. Checks against known false positives
	 * 4. Flags unsafe suggestions
	 * 5. Returns a complete DetectionOutput
	 *
	 * @param scannerInput - Scanner analysis data
	 * @param source - Source identifier (e.g., "repo-scanner")
	 * @returns Complete detection output with all findings
	 */
	async analyze(scannerInput: ScannerInput, source: string = "detection-engine"): Promise<DetectionOutput> {
		const startTime = Date.now();
		const detections: DetectionResult[] = [];

		// Initialize false-positive tracker if needed
		if (this.config.useFalsePositiveTracker && this.falsePositiveTracker) {
			await this.falsePositiveTracker.initialize();
		}

		// Process each scanner input category
		if (scannerInput.hotFiles && scannerInput.hotFiles.length > 0) {
			detections.push(...this.detectHotFileIssues(scannerInput.hotFiles, source));
		}

		if (scannerInput.conflictFiles && scannerInput.conflictFiles.length > 0) {
			detections.push(...this.detectConflictHotspots(scannerInput.conflictFiles, source));
		}

		if (scannerInput.testInstability && scannerInput.testInstability.length > 0) {
			detections.push(...this.detectTestInstability(scannerInput.testInstability, source));
		}

		if (scannerInput.validationSlowness && scannerInput.validationSlowness.length > 0) {
			detections.push(...this.detectValidationBottlenecks(scannerInput.validationSlowness, source));
		}

		if (scannerInput.deadCode && scannerInput.deadCode.length > 0) {
			detections.push(...this.detectDeadCode(scannerInput.deadCode, source));
		}

		if (scannerInput.duplicateLogic && scannerInput.duplicateLogic.length > 0) {
			detections.push(...this.detectDuplicateLogic(scannerInput.duplicateLogic, source));
		}

		if (scannerInput.serializationBottlenecks && scannerInput.serializationBottlenecks.length > 0) {
			detections.push(...this.detectSerializationBottlenecks(scannerInput.serializationBottlenecks, source));
		}

		if (scannerInput.workerUnderutilization && scannerInput.workerUnderutilization.length > 0) {
			detections.push(...this.detectWorkerUnderutilization(scannerInput.workerUnderutilization, source));
		}

		if (scannerInput.fileOverlaps && scannerInput.fileOverlaps.length > 0) {
			detections.push(...this.detectFileOverlapIssues(scannerInput.fileOverlaps, source));
		}

		if (scannerInput.coverageGaps && scannerInput.coverageGaps.length > 0) {
			detections.push(...this.detectCoverageGaps(scannerInput.coverageGaps, source));
		}

		if (scannerInput.docGaps && scannerInput.docGaps.length > 0) {
			detections.push(...this.detectDocGaps(scannerInput.docGaps, source));
		}

		if (scannerInput.dependencyIssues && scannerInput.dependencyIssues.length > 0) {
			detections.push(...this.detectDependencyIssues(scannerInput.dependencyIssues, source));
		}

		// Apply false-positive checks
		const detectionsAfterFP = await this.applyFalsePositiveChecks(detections);

		// Apply unsafe suggestion checks
		const { safe, unsafe, blocked, checkResults } = await this.applyUnsafeChecks(detectionsAfterFP);

		// Compute false-positive summary
		let falsePositiveSummary = {
			totalDetections: 0,
			falsePositiveCount: 0,
			falsePositiveRate: 0,
			byCategory: {} as Record<string, { total: number; falsePositives: number; rate: number }>,
			suppressedPatterns: [] as string[],
		};

		if (this.falsePositiveTracker && this.config.useFalsePositiveTracker) {
			falsePositiveSummary = await this.falsePositiveTracker.computeSummary(detectionsAfterFP);
		} else {
			falsePositiveSummary = {
				totalDetections: detectionsAfterFP.length,
				falsePositiveCount: detectionsAfterFP.filter((d) => d.isFalsePositive).length,
				falsePositiveRate:
					detectionsAfterFP.length > 0
						? detectionsAfterFP.filter((d) => d.isFalsePositive).length / detectionsAfterFP.length
						: 0,
				byCategory: {} as DetectionOutput["falsePositiveSummary"]["byCategory"],
				suppressedPatterns: [],
			};
		}

		// Merge safe, unsafe, and blocked detections back into a single list
		// preserving the isUnsafe flag updates from unsafe checks
		const allDetections = this.mergeDetectionResults(safe, unsafe, blocked);

		const durationMs = Date.now() - startTime;

		const summary = this.buildSummary(detectionsAfterFP, safe, unsafe, blocked, startTime, durationMs);

		return {
			success: true,
			detections: allDetections,
			falsePositiveSummary,
			unsafeCheckResults: checkResults,
			blockedDetections: blocked,
			summary,
			analyzedAt: startTime,
			durationMs,
		};
	}

	/**
	 * Generate a simple analysis without scanner input.
	 *
	 * Useful for testing or when direct detection findings are provided.
	 *
	 * @param detections - Detection findings to process through checks
	 * @param source - Source identifier
	 * @returns Detection output
	 */
	async processDetections(detections: DetectionResult[], _source: string = "manual"): Promise<DetectionOutput> {
		const startTime = Date.now();

		// Apply false-positive checks
		const detectionsAfterFP = await this.applyFalsePositiveChecks(detections);

		// Apply unsafe checks
		const { safe, unsafe, blocked, checkResults } = await this.applyUnsafeChecks(detectionsAfterFP);

		let falsePositiveSummary = {
			totalDetections: 0,
			falsePositiveCount: 0,
			falsePositiveRate: 0,
			byCategory: {} as Record<string, { total: number; falsePositives: number; rate: number }>,
			suppressedPatterns: [] as string[],
		};
		if (this.falsePositiveTracker && this.config.useFalsePositiveTracker) {
			falsePositiveSummary = await this.falsePositiveTracker.computeSummary(detectionsAfterFP);
		} else {
			falsePositiveSummary = {
				totalDetections: detectionsAfterFP.length,
				falsePositiveCount: detectionsAfterFP.filter((d) => d.isFalsePositive).length,
				falsePositiveRate:
					detectionsAfterFP.length > 0
						? detectionsAfterFP.filter((d) => d.isFalsePositive).length / detectionsAfterFP.length
						: 0,
				byCategory: {} as DetectionOutput["falsePositiveSummary"]["byCategory"],
				suppressedPatterns: [],
			};
		}

		// Merge safe, unsafe, and blocked detections back into a single list
		const allDetections = this.mergeDetectionResults(safe, unsafe, blocked);

		const durationMs = Date.now() - startTime;
		const summary = this.buildSummary(detectionsAfterFP, safe, unsafe, blocked, startTime, durationMs);

		return {
			success: true,
			detections: allDetections,
			falsePositiveSummary,
			unsafeCheckResults: checkResults,
			blockedDetections: blocked,
			summary,
			analyzedAt: startTime,
			durationMs,
		};
	}

	// =========================================================================
	// Detection Methods (private)
	// =========================================================================

	/**
	 * Detect issues related to frequently modified "hot files".
	 */
	private detectHotFileIssues(hotFiles: NonNullable<ScannerInput["hotFiles"]>, source: string): DetectionResult[] {
		return hotFiles
			.filter((f) => f.modificationCount >= 5 || f.recentChanges >= 3)
			.map((f) => {
				const risk: RiskLevel = f.modificationCount >= 10 ? "high" : "medium";
				const confidence: ConfidenceLevel = f.modificationCount >= 10 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `File has been modified ${f.modificationCount} times total, ${f.recentChanges} recently`,
						filePath: f.path,
						data: JSON.stringify({ modificationCount: f.modificationCount, recentChanges: f.recentChanges }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "code_quality",
					title: `Hot file: ${f.path}`,
					description: `File "${f.path}" has been modified ${f.modificationCount} times (${f.recentChanges} recent). Frequently modified files may indicate instability, poor design, or changing requirements.`,
					risk,
					confidence,
					evidence,
					affectedPaths: [f.path],
					source,
				});
			});
	}

	/**
	 * Detect conflict hotspots from integration queue data.
	 */
	private detectConflictHotspots(
		conflictFiles: NonNullable<ScannerInput["conflictFiles"]>,
		source: string,
	): DetectionResult[] {
		return conflictFiles
			.filter((f) => f.conflictCount >= 2)
			.map((f) => {
				const risk: RiskLevel = f.conflictCount >= 5 ? "high" : "medium";
				const confidence: ConfidenceLevel = f.conflictCount >= 3 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `File has been involved in ${f.conflictCount} merge conflicts`,
						filePath: f.path,
						data: JSON.stringify({ conflictCount: f.conflictCount, aheadBy: f.aheadBy }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "conflict_hotspot",
					title: `Conflict hotspot: ${f.path}`,
					description: `File "${f.path}" has been involved in ${f.conflictCount} merge conflicts. Conflict-prone files increase merge resolution time and risk of integration errors.`,
					risk,
					confidence,
					evidence,
					affectedPaths: [f.path],
					source,
				});
			});
	}

	/**
	 * Detect test instability.
	 */
	private detectTestInstability(
		testInstability: NonNullable<ScannerInput["testInstability"]>,
		source: string,
	): DetectionResult[] {
		return testInstability
			.filter((t) => t.failCount >= 2 || t.flakyRate >= 0.1)
			.map((t) => {
				const risk: RiskLevel = t.failCount >= 5 || t.flakyRate >= 0.3 ? "high" : "medium";
				const confidence: ConfidenceLevel = t.failCount >= 3 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "test_result",
						description: `Test has failed ${t.failCount} times with flaky rate of ${(t.flakyRate * 100).toFixed(1)}%`,
						filePath: t.testFile,
						data: JSON.stringify({ failCount: t.failCount, flakyRate: t.flakyRate }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "test_coverage_gap",
					title: `Unstable test: ${t.testFile}`,
					description: `Test "${t.testFile}" has failed ${t.failCount} times with a flaky rate of ${(t.flakyRate * 100).toFixed(1)}%. Unstable tests reduce confidence in test results and may indicate test design issues or race conditions.`,
					risk,
					confidence,
					evidence,
					affectedPaths: [t.testFile],
					estimatedEffort: t.flakyRate >= 0.5 ? "~2h" : "~30min",
					source,
				});
			});
	}

	/**
	 * Detect validation bottlenecks.
	 */
	private detectValidationBottlenecks(
		validationSlowness: NonNullable<ScannerInput["validationSlowness"]>,
		source: string,
	): DetectionResult[] {
		return validationSlowness
			.filter((v) => v.averageDurationMs >= 30000 || (v.averageDurationMs >= 10000 && v.frequency >= 5))
			.map((v) => {
				const risk: RiskLevel = v.averageDurationMs >= 60000 ? "high" : "medium";
				const confidence: ConfidenceLevel = v.frequency >= 10 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `Command "${v.command}" averages ${v.averageDurationMs}ms and runs ${v.frequency} times`,
						data: JSON.stringify({ averageDurationMs: v.averageDurationMs, frequency: v.frequency }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "validation_bottleneck",
					title: `Slow validation: ${v.command}`,
					description: `Validation command "${v.command}" averages ${(v.averageDurationMs / 1000).toFixed(1)}s and runs ${v.frequency} times. Slow validation increases feedback cycles and slows development.`,
					risk,
					confidence,
					evidence,
					estimatedEffort: v.averageDurationMs >= 120000 ? "~4h" : "~1h",
					source,
				});
			});
	}

	/**
	 * Detect dead code candidates.
	 */
	private detectDeadCode(deadCode: NonNullable<ScannerInput["deadCode"]>, source: string): DetectionResult[] {
		return deadCode.map((d) => {
			const evidence: DetectionEvidenceItem[] = [
				{
					type: "static_analysis",
					description: d.reason,
					filePath: d.file,
					data: d.reason,
					capturedAt: Date.now(),
				},
			];

			return this.createDetection({
				category: "refactor_opportunity",
				title: `Dead code: ${d.symbol} in ${d.file}`,
				description: `Symbol "${d.symbol}" in "${d.file}" appears to be unused. ${d.reason}`,
				risk: "low",
				confidence: "medium",
				evidence,
				affectedPaths: [d.file],
				suggestedFix: `Consider removing "${d.symbol}" if it is no longer needed.`,
				estimatedEffort: "~15min",
				source,
			});
		});
	}

	/**
	 * Detect duplicate logic.
	 */
	private detectDuplicateLogic(
		duplicateLogic: NonNullable<ScannerInput["duplicateLogic"]>,
		source: string,
	): DetectionResult[] {
		return duplicateLogic
			.filter((d) => d.similarity >= 0.7)
			.map((d) => {
				const risk: RiskLevel = d.similarity >= 0.9 ? "medium" : "low";
				const confidence: ConfidenceLevel = d.similarity >= 0.85 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "static_analysis",
						description: `Found ${(d.similarity * 100).toFixed(0)}% similar code in ${d.locations.length} locations`,
						data: JSON.stringify({ locations: d.locations, similarity: d.similarity }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "refactor_opportunity",
					title: `Duplicate logic (${(d.similarity * 100).toFixed(0)}% similar)`,
					description: `${d.description} Found in ${d.locations.length} locations with ${(d.similarity * 100).toFixed(0)}% similarity.`,
					risk,
					confidence,
					evidence,
					affectedPaths: d.locations,
					suggestedFix: "Extract shared logic into a common utility function or module.",
					estimatedEffort: d.locations.length >= 3 ? "~1h" : "~30min",
					source,
				});
			});
	}

	/**
	 * Detect serialization bottlenecks in workspace dependencies.
	 */
	private detectSerializationBottlenecks(
		bottlenecks: NonNullable<ScannerInput["serializationBottlenecks"]>,
		source: string,
	): DetectionResult[] {
		return bottlenecks
			.filter((b) => b.bottleneckScore >= 0.4)
			.map((b) => {
				const risk: RiskLevel = b.bottleneckScore >= 0.7 ? "high" : "medium";
				const confidence: ConfidenceLevel = b.bottleneckScore >= 0.6 ? "high" : "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "dependency_graph",
						description: `Workspace "${b.workspaceId}" has a ${b.dependencyChain.length}-step dependency chain with bottleneck score ${b.bottleneckScore.toFixed(2)}`,
						data: JSON.stringify({ dependencyChain: b.dependencyChain, bottleneckScore: b.bottleneckScore }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "queue_inefficiency",
					title: `Serialization bottleneck: ${b.workspaceId}`,
					description: `Workspace "${b.workspaceId}" has a dependency chain of ${b.dependencyChain.length} steps (bottleneck score: ${b.bottleneckScore.toFixed(2)}). Long dependency chains serialize execution and increase total execution time.`,
					risk,
					confidence,
					evidence,
					affectedWorkspaceIds: [b.workspaceId, ...b.dependencyChain],
					source,
				});
			});
	}

	/**
	 * Detect worker underutilization.
	 */
	private detectWorkerUnderutilization(
		underutilization: NonNullable<ScannerInput["workerUnderutilization"]>,
		source: string,
	): DetectionResult[] {
		return underutilization
			.filter((u) => u.usedWorkers <= u.availableWorkers * 0.5 && u.availableWorkers > 1)
			.map((u) => {
				const utilizationPercent = (u.usedWorkers / u.availableWorkers) * 100;
				const risk: RiskLevel = utilizationPercent <= 25 ? "medium" : "low";
				const confidence: ConfidenceLevel = "medium";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `Batch ${u.batchIndex} uses only ${u.usedWorkers}/${u.availableWorkers} workers (${utilizationPercent.toFixed(0)}% utilization)`,
						data: JSON.stringify({
							batchIndex: u.batchIndex,
							usedWorkers: u.usedWorkers,
							availableWorkers: u.availableWorkers,
						}),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "queue_inefficiency",
					title: `Worker underutilization in batch ${u.batchIndex}`,
					description: `Batch ${u.batchIndex} uses only ${u.usedWorkers}/${u.availableWorkers} workers (${utilizationPercent.toFixed(0)}% utilization). Unused worker capacity extends total execution time.`,
					risk,
					confidence,
					evidence,
					source,
				});
			});
	}

	/**
	 * Detect file overlap issues that prevent parallel execution.
	 */
	private detectFileOverlapIssues(
		overlaps: NonNullable<ScannerInput["fileOverlaps"]>,
		source: string,
	): DetectionResult[] {
		return overlaps.map((o) => {
			const evidence: DetectionEvidenceItem[] = [
				{
					type: "static_analysis",
					description: `File overlap detected: files [${o.files.join(", ")}] are accessed by multiple workspaces`,
					data: JSON.stringify({ files: o.files, workspaces: o.workspaces }),
					capturedAt: Date.now(),
				},
			];

			return this.createDetection({
				category: "queue_inefficiency",
				title: `File overlap: ${o.files.length > 2 ? `${o.files[0]} and ${o.files.length - 1} more` : o.files.join(", ")}`,
				description: `File overlap detected in ${o.files.length} file(s) across ${o.workspaces.length} workspace(s). Overlapping file access prevents parallel execution and can cause merge conflicts.`,
				risk: "medium",
				confidence: "high",
				evidence,
				affectedPaths: o.files,
				affectedWorkspaceIds: o.workspaces,
				source,
			});
		});
	}

	/**
	 * Detect test coverage gaps.
	 */
	private detectCoverageGaps(
		coverageGaps: NonNullable<ScannerInput["coverageGaps"]>,
		source: string,
	): DetectionResult[] {
		return coverageGaps
			.filter((c) => c.coverage < 0.5)
			.map((c) => {
				const untestedPercent = ((c.untestedLines / c.totalLines) * 100).toFixed(0);
				const risk: RiskLevel = c.coverage < 0.2 ? "high" : "medium";
				const confidence: ConfidenceLevel = "high";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `File "${c.file}" has ${untestedPercent}% untested lines (${c.untestedLines}/${c.totalLines})`,
						filePath: c.file,
						data: JSON.stringify({
							untestedLines: c.untestedLines,
							totalLines: c.totalLines,
							coverage: c.coverage,
						}),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "test_coverage_gap",
					title: `Coverage gap: ${c.file}`,
					description: `File "${c.file}" has ${untestedPercent}% untested lines (${c.untestedLines}/${c.totalLines}). Low test coverage increases risk of undetected bugs.`,
					risk,
					confidence,
					evidence,
					affectedPaths: [c.file],
					suggestedFix: `Add tests for the ${c.untestedLines} untested lines in "${c.file}".`,
					estimatedEffort: `~${Math.ceil(c.untestedLines / 10)}min`,
					source,
				});
			});
	}

	/**
	 * Detect documentation gaps in public APIs.
	 */
	private detectDocGaps(docGaps: NonNullable<ScannerInput["docGaps"]>, source: string): DetectionResult[] {
		return docGaps
			.filter((d) => d.publicApiCount > 0 && d.documentedCount / d.publicApiCount < 0.8)
			.map((d) => {
				const docPercent = ((d.documentedCount / d.publicApiCount) * 100).toFixed(0);
				const risk: RiskLevel = "low";
				const confidence: ConfidenceLevel = "high";

				const evidence: DetectionEvidenceItem[] = [
					{
						type: "metric",
						description: `Only ${docPercent}% of public API in "${d.file}" is documented (${d.documentedCount}/${d.publicApiCount})`,
						filePath: d.file,
						data: JSON.stringify({ publicApiCount: d.publicApiCount, documentedCount: d.documentedCount }),
						capturedAt: Date.now(),
					},
				];

				return this.createDetection({
					category: "documentation_gap",
					title: `Documentation gap: ${d.file}`,
					description: `Only ${docPercent}% of public API surface in "${d.file}" has documentation (${d.documentedCount}/${d.publicApiCount}). Undocumented APIs reduce maintainability and onboarding efficiency.`,
					risk,
					confidence,
					evidence,
					affectedPaths: [d.file],
					suggestedFix: `Add documentation for the ${d.publicApiCount - d.documentedCount} undocumented public APIs in "${d.file}".`,
					estimatedEffort: `~${(d.publicApiCount - d.documentedCount) * 5}min`,
					source,
				});
			});
	}

	/**
	 * Detect dependency issues.
	 */
	private detectDependencyIssues(
		issues: NonNullable<ScannerInput["dependencyIssues"]>,
		source: string,
	): DetectionResult[] {
		return issues.map((issue) => {
			const risk: RiskLevel = issue.severity === "error" ? "high" : "medium";
			const confidence: ConfidenceLevel = "high";

			const evidence: DetectionEvidenceItem[] = [
				{
					type: "dependency_graph",
					description: issue.description,
					data: JSON.stringify({ severity: issue.severity, workspaces: issue.workspaces }),
					capturedAt: Date.now(),
				},
			];

			return this.createDetection({
				category: "dependency_issue",
				title: `Dependency issue: ${issue.severity}`,
				description: issue.description,
				risk,
				confidence,
				evidence,
				affectedWorkspaceIds: issue.workspaces,
				source,
			});
		});
	}

	// =========================================================================
	// Helpers
	// =========================================================================

	/**
	 * Create a detection result with consistent defaults.
	 */
	private createDetection(params: {
		category: DetectionCategory;
		title: string;
		description: string;
		risk: RiskLevel;
		confidence: ConfidenceLevel;
		evidence: DetectionEvidenceItem[];
		affectedPaths?: string[];
		affectedWorkspaceIds?: string[];
		estimatedEffort?: string;
		suggestedFix?: string;
		source: string;
	}): DetectionResult {
		return {
			id: generateDetectionId(),
			category: params.category,
			title: params.title,
			description: params.description,
			risk: params.risk,
			confidence: params.confidence,
			evidence: params.evidence,
			requiresApproval: true,
			isUnsafe: false,
			affectedPaths: params.affectedPaths,
			affectedWorkspaceIds: params.affectedWorkspaceIds,
			estimatedEffort: params.estimatedEffort,
			suggestedFix: params.suggestedFix,
			detectedAt: Date.now(),
			source: params.source,
		};
	}

	/**
	 * Apply false-positive checks to a set of detections.
	 *
	 * Checks each detection against the false-positive tracker and
	 * marks matches.
	 */
	private async applyFalsePositiveChecks(detections: DetectionResult[]): Promise<DetectionResult[]> {
		if (!this.falsePositiveTracker || !this.config.useFalsePositiveTracker) {
			return detections;
		}

		await this.falsePositiveTracker.initialize();

		const results: DetectionResult[] = [];

		for (const detection of detections) {
			const fpInfo = await this.falsePositiveTracker.isKnownFalsePositive(detection);
			if (fpInfo) {
				results.push({
					...detection,
					isFalsePositive: true,
					falsePositiveInfo: fpInfo,
				});
			} else {
				results.push(detection);
			}
		}

		return results;
	}

	/**
	 * Apply unsafe suggestion checks to a set of detections.
	 */
	private async applyUnsafeChecks(detections: DetectionResult[]): Promise<{
		safe: DetectionResult[];
		unsafe: DetectionResult[];
		blocked: DetectionResult[];
		checkResults: Record<string, UnsafeCheckResult>;
	}> {
		if (!this.unsafeGuard || !this.config.useUnsafeGuard) {
			const safe = detections.map((d) => ({ ...d, isUnsafe: false }));
			return {
				safe,
				unsafe: [],
				blocked: [],
				checkResults: {},
			};
		}

		const { safe, unsafe, blocked, checkResults } = this.unsafeGuard.filter(detections);

		// Mark unsafe detections
		const updatedSafe = safe.map((d) => ({ ...d, isUnsafe: false }));

		// Mark unsafe but not blocked detections
		const unblockedUnsafe = unsafe.filter((d) => !blocked.find((b) => b.id === d.id));
		const updatedUnsafe = unblockedUnsafe.map((d) => {
			const result = checkResults[d.id];
			return {
				...d,
				isUnsafe: true,
				unsafeReason: result?.explanation,
				requiresApproval: true,
			};
		});

		// Mark blocked detections
		const updatedBlocked = blocked.map((d) => {
			const result = checkResults[d.id];
			return {
				...d,
				isUnsafe: true,
				unsafeReason: result?.explanation || "Blocked by unsafe suggestion guard",
				requiresApproval: true,
			};
		});

		// Update the check results to reflect the latest state
		const updatedCheckResults: Record<string, UnsafeCheckResult> = {};
		for (const d of [...updatedSafe, ...updatedUnsafe, ...updatedBlocked]) {
			const result = checkResults[d.id];
			if (result) {
				updatedCheckResults[d.id] = result;
			}
		}

		return {
			safe: updatedSafe,
			unsafe: updatedUnsafe,
			blocked: updatedBlocked,
			checkResults: updatedCheckResults,
		};
	}

	/**
	 * Merge safe, unsafe, and blocked detection results back into a single list.
	 *
	 * The unsafe checks produce modified copies with isUnsafe and unsafeReason
	 * set. This method reassembles them into a single array preserving the order
	 * of safe, then unsafe (unblocked), then blocked.
	 */
	private mergeDetectionResults(
		safe: DetectionResult[],
		unsafe: DetectionResult[],
		blocked: DetectionResult[],
	): DetectionResult[] {
		// Blocked detections are already included in unsafe, so we deduplicate
		const blockedIds = new Set(blocked.map((d) => d.id));
		const unblockedUnsafe = unsafe.filter((d) => !blockedIds.has(d.id));
		return [...safe, ...unblockedUnsafe, ...blocked];
	}

	/**
	 * Build a human-readable summary of the detection results.
	 */
	private buildSummary(
		detections: DetectionResult[],
		safe: DetectionResult[],
		unsafe: DetectionResult[],
		blocked: DetectionResult[],
		analyzedAt: number,
		durationMs: number,
	): string {
		const lines: string[] = [];
		const categories = new Map<DetectionCategory, number>();

		for (const d of detections) {
			categories.set(d.category, (categories.get(d.category) ?? 0) + 1);
		}

		lines.push(`Detection Analysis (${new Date(analyzedAt).toISOString()})`);
		lines.push(`Duration: ${durationMs}ms`);
		lines.push("");
		lines.push(`Total findings: ${detections.length}`);
		lines.push(`Safe to proceed: ${safe.length}`);
		lines.push(`Unsafe (needs review): ${unsafe.length}`);
		lines.push(`Blocked: ${blocked.length}`);
		lines.push("");

		if (categories.size > 0) {
			lines.push("By category:");
			for (const [category, count] of categories) {
				lines.push(`  ${category}: ${count}`);
			}
			lines.push("");
		}

		const falsePositiveCount = detections.filter((d) => d.isFalsePositive).length;
		if (falsePositiveCount > 0) {
			lines.push(`False positives identified: ${falsePositiveCount}`);
			lines.push("");
		}

		if (blocked.length > 0) {
			lines.push("Blocked suggestions (cannot proceed):");
			for (const b of blocked) {
				lines.push(`  - ${b.title}: ${b.unsafeReason ?? "Unsafe"}`);
			}
			lines.push("");
		}

		if (unsafe.length > 0) {
			lines.push("Unsafe suggestions (require enhanced approval):");
			for (const u of unsafe) {
				lines.push(`  - ${u.title}: ${u.unsafeReason ?? "Requires enhanced approval"}`);
			}
			lines.push("");
		}

		lines.push(
			`${detections.length > 0 ? "All findings require explicit approval before execution." : "No issues detected."}`,
		);

		return lines.join("\n");
	}
}

/**
 * Create a detection engine instance.
 *
 * @param config - Optional configuration
 * @param falsePositiveTracker - Optional false-positive tracker
 * @param unsafeGuard - Optional unsafe suggestion guard
 * @returns Detection engine instance
 */
export function createDetectionEngine(
	config?: DetectionEngineConfig,
	falsePositiveTracker?: FalsePositiveTracker,
	unsafeGuard?: UnsafeSuggestionGuard,
): DetectionEngine {
	return new DetectionEngine(config, falsePositiveTracker, unsafeGuard);
}
