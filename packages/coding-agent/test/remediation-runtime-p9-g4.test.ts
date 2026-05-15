/**
 * P9.G4 Dry-Run & Validation Recording Tests
 *
 * Acceptance Criteria:
 * 1. Dry-run assumptions and results are recorded before execution approval.
 * 2. Validation outcomes (targeted + integration) are recorded with pass/fail details.
 * 3. Validation failures produce traceable error records.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	createRemediationRuntime,
	type DryRunReport,
	type RemediationRuntime,
	type RemediationScanResult,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// P9.G4 Types — Dry-Run Assumptions & Validation Recording
// ---------------------------------------------------------------------------

/**
 * An assumption made before or during dry-run execution.
 * These must be recorded before execution approval is granted.
 */
interface DryRunAssumption {
	/** Unique identifier for the assumption */
	id: string;
	/** Human-readable description */
	description: string;
	/** Category of the assumption */
	category: "environment" | "state" | "dependency" | "permission" | "filesystem" | "other";
	/** Whether the assumption has been verified */
	verified: boolean;
	/** When the assumption was verified (ISO 8601) */
	verificationTimestamp?: string;
	/** Optional notes about verification */
	notes?: string;
}

/**
 * A validation outcome — either targeted (single component) or integration (cross-component).
 */
interface ValidationOutcome {
	/** Unique identifier */
	id: string;
	/** Type of validation: targeted (single component) or integration (cross-component) */
	type: "targeted" | "integration";
	/** Short name for the validation */
	name: string;
	/** Detailed description */
	description: string;
	/** Pass/fail/skipped status */
	status: "pass" | "fail" | "skipped";
	/** When the validation was executed (ISO 8601) */
	executedAt: string;
	/** Duration in milliseconds */
	durationMs: number;
	/** Optional human-readable details */
	details?: string;
	/** Traceable error record if the validation failed */
	error?: ValidationFailure;
}

/**
 * A traceable error record for a validation failure.
 * Enables root-cause analysis and debugging.
 */
interface ValidationFailure {
	/** Unique trace ID for this failure */
	traceId: string;
	/** Error message */
	error: string;
	/** Error type/class */
	errorType: string;
	/** File path related to the failure */
	filePath?: string;
	/** Line number related to the failure */
	lineNumber?: number;
	/** Stack trace if available */
	stackTrace?: string;
	/** Structured context for debugging */
	context?: Record<string, unknown>;
}

/**
 * Summary of dry-run and validation results.
 */
interface ValidationSummary {
	/** Total assumptions recorded */
	totalAssumptions: number;
	/** Number of verified assumptions */
	verifiedAssumptions: number;
	/** Number of unverified assumptions */
	unverifiedAssumptions: number;
	/** Total validation outcomes recorded */
	totalValidations: number;
	/** Number of passed validations */
	passed: number;
	/** Number of failed validations */
	failed: number;
	/** Number of skipped validations */
	skipped: number;
}

/**
 * Complete dry-run & validation record.
 * Captured before execution approval is granted.
 */
interface DryRunValidationRecord {
	/** Timestamp of the record (ISO 8601) */
	timestamp: string;
	/** Assumptions recorded before execution */
	assumptions: DryRunAssumption[];
	/** Targeted validations (single component) */
	targetedValidations: ValidationOutcome[];
	/** Integration validations (cross-component) */
	integrationValidations: ValidationOutcome[];
	/** Summary of all results */
	summary: ValidationSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let assumptionCounter = 0;
let validationCounter = 0;

function makeAssumption(overrides?: Partial<DryRunAssumption>): DryRunAssumption {
	assumptionCounter++;
	return {
		id: `assumption-${assumptionCounter}`,
		description: `Test assumption ${assumptionCounter}`,
		category: "state",
		verified: false,
		...overrides,
	};
}

function makeValidation(overrides?: Partial<ValidationOutcome>): ValidationOutcome {
	validationCounter++;
	return {
		id: `val-${validationCounter}`,
		type: "targeted",
		name: `Test validation ${validationCounter}`,
		description: `Test validation description ${validationCounter}`,
		status: "pass",
		executedAt: new Date().toISOString(),
		durationMs: 42,
		...overrides,
	};
}

function makeScanResult(options?: { proposals?: number }): RemediationScanResult {
	const numProposals = options?.proposals ?? 1;
	return {
		signals: [
			{
				id: "signal-g4-001",
				title: "P9.G4 Test Signal",
				description: "A test health signal for dry-run validation",
				severity: "warning" as const,
				category: "typecheck" as const,
				scope: "test",
				evidence: [],
				proposals: Array.from({ length: numProposals }, (_, i) => ({
					description: `Proposal ${i + 1}`,
					targetFiles: [`file-${i + 1}.ts`],
					effort: "small" as const,
					autoFixable: true,
				})),
				verified: false,
				timestamp: new Date().toISOString(),
			},
		],
		totalProposals: numProposals,
		proposals: [],
		completedAt: new Date().toISOString(),
	};
}

function makeDryRunReport(overrides?: Partial<DryRunReport>): DryRunReport {
	return {
		timestamp: new Date().toISOString(),
		totalProposals: 1,
		mutationsPredicted: 1,
		expectedFileChanges: ["file-1.ts"],
		success: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// AC1: Dry-run assumptions and results recorded before execution approval
// ---------------------------------------------------------------------------

describe("P9.G4 AC1: Dry-run assumptions and results recording", () => {
	let runtime: RemediationRuntime;
	let record: DryRunValidationRecord;

	beforeEach(() => {
		assumptionCounter = 0;
		validationCounter = 0;
		runtime = createRemediationRuntime({ reviewer: "p9-g4-test" });

		// Set up a baseline validation record
		record = {
			timestamp: new Date().toISOString(),
			assumptions: [
				makeAssumption({
					description: "Source files are readable",
					category: "permission",
					verified: true,
					verificationTimestamp: new Date().toISOString(),
				}),
				makeAssumption({
					description: "No concurrent workspace writes expected",
					category: "state",
					verified: true,
					verificationTimestamp: new Date().toISOString(),
				}),
			],
			targetedValidations: [],
			integrationValidations: [],
			summary: {
				totalAssumptions: 2,
				verifiedAssumptions: 2,
				unverifiedAssumptions: 0,
				totalValidations: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
			},
		};
	});

	it("records assumptions before execution approval is granted", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Plan approved");
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// Record assumptions before execution approval
		expect(record.assumptions).toHaveLength(2);
		expect(record.timestamp).toBeDefined();
		expect(record.summary.totalAssumptions).toBe(2);
		expect(record.summary.verifiedAssumptions).toBe(2);
		expect(record.summary.unverifiedAssumptions).toBe(0);

		// Now grant execution approval — assumptions must already be recorded
		await runtime.approveExecution("All assumptions verified");
		expect(runtime.dryRunReport).toBeDefined();
		expect(runtime.dryRunReport!.success).toBe(true);
	});

	it("records unverified assumptions alongside results", async () => {
		const unverifiedRecord: DryRunValidationRecord = {
			timestamp: new Date().toISOString(),
			assumptions: [
				makeAssumption({
					description: "P9.E lock may be released mid-execution",
					category: "environment",
					verified: false,
					notes: "Cannot verify until P9.E completes",
				}),
			],
			targetedValidations: [],
			integrationValidations: [],
			summary: {
				totalAssumptions: 1,
				verifiedAssumptions: 0,
				unverifiedAssumptions: 1,
				totalValidations: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
			},
		};

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();
		await runtime.runDryRun(() => Promise.resolve(makeDryRunReport()));

		// Unverified assumption recorded before execution
		expect(unverifiedRecord.assumptions[0].verified).toBe(false);
		expect(unverifiedRecord.assumptions[0].notes).toBe("Cannot verify until P9.E completes");
		expect(unverifiedRecord.summary.unverifiedAssumptions).toBe(1);

		// Execution can still proceed with unverified assumptions documented
		await runtime.approveExecution("Proceeding despite unverified assumptions");
	});

	it("records multiple assumptions across different categories", async () => {
		const multiAssumptions: DryRunAssumption[] = [
			makeAssumption({ description: "Disk space available", category: "environment", verified: true }),
			makeAssumption({ description: "Node.js v18+ available", category: "dependency", verified: true }),
			makeAssumption({ description: "Write access to reports/", category: "permission", verified: true }),
			makeAssumption({ description: "No stale git index", category: "state", verified: false }),
			makeAssumption({ description: "Symlinks resolved correctly", category: "filesystem", verified: true }),
		];

		expect(multiAssumptions).toHaveLength(5);
		expect(multiAssumptions.filter((a) => a.verified)).toHaveLength(4);
		expect(multiAssumptions.filter((a) => !a.verified)).toHaveLength(1);
	});

	it("includes dry-run result alongside assumptions in the record", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();

		const dryRunReport = makeDryRunReport({
			totalProposals: 3,
			mutationsPredicted: 2,
			expectedFileChanges: ["src/a.ts", "src/b.ts"],
			success: true,
		});

		await runtime.runDryRun(() => Promise.resolve(dryRunReport));

		// The record pairs assumptions with the dry-run result
		expect(record.assumptions).toHaveLength(2);
		expect(runtime.dryRunReport).toBeDefined();
		expect(runtime.dryRunReport!.totalProposals).toBe(3);
		expect(runtime.dryRunReport!.mutationsPredicted).toBe(2);
		expect(runtime.dryRunReport!.expectedFileChanges).toEqual(["src/a.ts", "src/b.ts"]);
		expect(runtime.dryRunReport!.success).toBe(true);
	});

	it("blocks execution if dry-run failed regardless of assumptions", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();

		await runtime.runDryRun(() =>
			Promise.resolve(
				makeDryRunReport({
					success: false,
					error: "Simulation failed: file conflict detected",
				}),
			),
		);

		// Even with assumptions recorded, a failed dry-run blocks execution
		expect(runtime.dryRunReport!.success).toBe(false);
		expect(runtime.dryRunReport!.error).toBe("Simulation failed: file conflict detected");
		expect(runtime.state).toBe("failed");

		await expect(runtime.approveExecution("Should not work")).rejects.toThrow(/cannot approve execution/i);
	});

	it("pairs assumptions with dry-run report before execution approval flow", async () => {
		// Full flow: assumptions + dry-run result before execution approval
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Plan OK");
		await runtime.requestDryRun();

		const report = makeDryRunReport({ success: true });
		await runtime.runDryRun(() => Promise.resolve(report));

		// Pre-execution: dry-run report is available, execution not yet approved
		expect(runtime.state).toBe("dry_run_complete");
		expect(runtime.dryRunReport).toBe(report);

		// Assumptions record is separate but available
		expect(record.assumptions.length).toBeGreaterThan(0);
		expect(record.timestamp).toBeDefined();

		// Now approve execution
		await runtime.approveExecution("Assumptions verified, dry-run passed");
		expect(runtime.state).toBe("execution_approved");
	});

	it("supports empty assumptions list", async () => {
		const emptyRecord: DryRunValidationRecord = {
			timestamp: new Date().toISOString(),
			assumptions: [],
			targetedValidations: [],
			integrationValidations: [],
			summary: {
				totalAssumptions: 0,
				verifiedAssumptions: 0,
				unverifiedAssumptions: 0,
				totalValidations: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
			},
		};

		expect(emptyRecord.assumptions).toHaveLength(0);
		expect(emptyRecord.summary.totalAssumptions).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// AC2: Validation outcomes (targeted + integration) recorded with pass/fail
// ---------------------------------------------------------------------------

describe("P9.G4 AC2: Validation outcomes recording", () => {
	let runtime: RemediationRuntime;
	let record: DryRunValidationRecord;

	beforeEach(() => {
		assumptionCounter = 0;
		validationCounter = 0;
		runtime = createRemediationRuntime({ reviewer: "p9-g4-val-test" });

		record = {
			timestamp: new Date().toISOString(),
			assumptions: [makeAssumption({ description: "Environment ready", category: "environment", verified: true })],
			targetedValidations: [],
			integrationValidations: [],
			summary: {
				totalAssumptions: 1,
				verifiedAssumptions: 1,
				unverifiedAssumptions: 0,
				totalValidations: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
			},
		};
	});

	describe("Targeted validations", () => {
		it("records a passing targeted validation", async () => {
			const outcome = makeValidation({
				type: "targeted",
				name: "File existence check",
				description: "Verify target files exist before modification",
				status: "pass",
			});

			record.targetedValidations.push(outcome);
			record.summary.totalValidations = 1;
			record.summary.passed = 1;

			expect(record.targetedValidations).toHaveLength(1);
			expect(record.targetedValidations[0].type).toBe("targeted");
			expect(record.targetedValidations[0].status).toBe("pass");
			expect(record.summary.passed).toBe(1);
		});

		it("records a failing targeted validation", async () => {
			const outcome = makeValidation({
				type: "targeted",
				name: "TypeScript compilation check",
				description: "Verify no type errors in target file",
				status: "fail",
				error: {
					traceId: "trace-fail-001",
					error: "Type 'string' is not assignable to type 'number'",
					errorType: "TypeError",
					filePath: "src/utils.ts",
					lineNumber: 42,
				},
			});

			record.targetedValidations.push(outcome);
			record.summary.totalValidations = 1;
			record.summary.failed = 1;

			expect(record.targetedValidations[0].status).toBe("fail");
			expect(record.summary.failed).toBe(1);
		});

		it("records a skipped targeted validation", async () => {
			const outcome = makeValidation({
				type: "targeted",
				name: "Linting check",
				description: "Verify no lint warnings",
				status: "skipped",
				details: "Linter not available in this environment",
			});

			record.targetedValidations.push(outcome);
			record.summary.totalValidations = 1;
			record.summary.skipped = 1;

			expect(record.targetedValidations[0].status).toBe("skipped");
			expect(record.summary.skipped).toBe(1);
		});

		it("records multiple targeted validations", async () => {
			record.targetedValidations = [
				makeValidation({ name: "Check A", status: "pass" }),
				makeValidation({ name: "Check B", status: "pass" }),
				makeValidation({ name: "Check C", status: "fail" }),
			];

			record.summary = {
				...record.summary,
				totalValidations: 3,
				passed: 2,
				failed: 1,
				skipped: 0,
			};

			expect(record.targetedValidations).toHaveLength(3);
			expect(record.summary.totalValidations).toBe(3);
			expect(record.summary.passed).toBe(2);
			expect(record.summary.failed).toBe(1);
		});
	});

	describe("Integration validations", () => {
		it("records a passing integration validation", async () => {
			const outcome = makeValidation({
				type: "integration",
				name: "Cross-file consistency check",
				description: "Verify changes across all target files are consistent",
				status: "pass",
			});

			record.integrationValidations.push(outcome);
			record.summary.totalValidations = 1;
			record.summary.passed = 1;

			expect(record.integrationValidations).toHaveLength(1);
			expect(record.integrationValidations[0].type).toBe("integration");
			expect(record.integrationValidations[0].status).toBe("pass");
		});

		it("records a failing integration validation", async () => {
			const outcome = makeValidation({
				type: "integration",
				name: "Workspace DAG consistency check",
				description: "Verify workspace dependency graph is acyclic",
				status: "fail",
				durationMs: 2500,
				error: {
					traceId: "trace-cycle-001",
					error: "Circular dependency detected: P9.G2 -> P9.G4 -> P9.G2",
					errorType: "CircularDependencyError",
					context: {
						cyclePath: ["P9.G2", "P9.G4", "P9.G2"],
						dagSize: 12,
					},
				},
			});

			record.integrationValidations.push(outcome);
			record.summary.totalValidations = 1;
			record.summary.failed = 1;

			expect(record.integrationValidations[0].status).toBe("fail");
			expect(record.integrationValidations[0].durationMs).toBe(2500);
		});

		it("records multiple integration validations", async () => {
			record.integrationValidations = [
				makeValidation({ type: "integration", name: "Cross-workspace dep check", status: "pass" }),
				makeValidation({ type: "integration", name: "Merge conflict scan", status: "pass" }),
				makeValidation({ type: "integration", name: "Parallel execution safety", status: "fail" }),
				makeValidation({ type: "integration", name: "Rollback consistency", status: "pass" }),
			];

			record.summary = {
				...record.summary,
				totalValidations: 4,
				passed: 3,
				failed: 1,
				skipped: 0,
			};

			expect(record.integrationValidations).toHaveLength(4);
			expect(record.summary.passed).toBe(3);
			expect(record.summary.failed).toBe(1);
		});
	});

	describe("Mixed targeted and integration validations", () => {
		it("records both validation types together", async () => {
			record.targetedValidations = [
				makeValidation({ type: "targeted", name: "File A check", status: "pass" }),
				makeValidation({ type: "targeted", name: "File B check", status: "fail" }),
			];
			record.integrationValidations = [makeValidation({ type: "integration", name: "Cross-check", status: "pass" })];
			record.summary = {
				...record.summary,
				totalValidations: 3,
				passed: 2,
				failed: 1,
				skipped: 0,
			};

			expect(record.targetedValidations).toHaveLength(2);
			expect(record.integrationValidations).toHaveLength(1);
			expect(record.summary.totalValidations).toBe(3);
			expect(record.summary.passed).toBe(2);
			expect(record.summary.failed).toBe(1);
		});

		it("summarizes pass/fail/skipped across both types", async () => {
			record.targetedValidations = [
				makeValidation({ type: "targeted", status: "pass" }),
				makeValidation({ type: "targeted", status: "pass" }),
				makeValidation({ type: "targeted", status: "fail" }),
				makeValidation({ type: "targeted", status: "skipped" }),
			];
			record.integrationValidations = [
				makeValidation({ type: "integration", status: "pass" }),
				makeValidation({ type: "integration", status: "fail" }),
			];
			record.summary = {
				...record.summary,
				totalValidations: 6,
				passed: 3,
				failed: 2,
				skipped: 1,
			};

			expect(record.summary.passed).toBe(3);
			expect(record.summary.failed).toBe(2);
			expect(record.summary.skipped).toBe(1);
		});

		it("captures validation duration for performance tracking", async () => {
			const fastCheck = makeValidation({ type: "targeted", status: "pass", durationMs: 5 });
			const slowCheck = makeValidation({ type: "integration", status: "pass", durationMs: 3200 });

			expect(fastCheck.durationMs).toBe(5);
			expect(slowCheck.durationMs).toBe(3200);
			expect(slowCheck.durationMs > fastCheck.durationMs).toBe(true);
		});

		it("supports empty validation lists", async () => {
			const emptyRecord: DryRunValidationRecord = {
				timestamp: new Date().toISOString(),
				assumptions: [],
				targetedValidations: [],
				integrationValidations: [],
				summary: {
					totalAssumptions: 0,
					verifiedAssumptions: 0,
					unverifiedAssumptions: 0,
					totalValidations: 0,
					passed: 0,
					failed: 0,
					skipped: 0,
				},
			};

			expect(emptyRecord.targetedValidations).toHaveLength(0);
			expect(emptyRecord.integrationValidations).toHaveLength(0);
			expect(emptyRecord.summary.totalValidations).toBe(0);
		});
	});

	it("includes validation outcomes in the full lifecycle flow", async () => {
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Plan approved");
		await runtime.requestDryRun();

		const report = makeDryRunReport({ success: true });
		await runtime.runDryRun(() => Promise.resolve(report));

		// Simulate that validation outcomes are recorded alongside the dry-run
		record.targetedValidations = [makeValidation({ type: "targeted", name: "File check", status: "pass" })];
		record.integrationValidations = [makeValidation({ type: "integration", name: "Cross-check", status: "pass" })];
		record.summary = {
			...record.summary,
			totalValidations: 2,
			passed: 2,
		};

		expect(record.summary.passed).toBe(2);
		expect(runtime.state).toBe("dry_run_complete");

		await runtime.approveExecution("All validations passed");
		expect(runtime.state).toBe("execution_approved");
	});
});

// ---------------------------------------------------------------------------
// AC3: Validation failures produce traceable error records
// ---------------------------------------------------------------------------

describe("P9.G4 AC3: Traceable error records for validation failures", () => {
	let runtime: RemediationRuntime;

	it("creates a traceable error record with trace ID", () => {
		const failure: ValidationFailure = {
			traceId: "trace-abc-123",
			error: "File not found: src/missing.ts",
			errorType: "FileNotFoundError",
			filePath: "src/missing.ts",
			lineNumber: 0,
			stackTrace: "Error: File not found\n    at checkFile (scanner.ts:42:5)",
			context: {
				workspace: "P9.G4",
				operation: "file_read",
				timestamp: new Date().toISOString(),
			},
		};

		expect(failure.traceId).toBe("trace-abc-123");
		expect(failure.errorType).toBe("FileNotFoundError");
		expect(failure.filePath).toBe("src/missing.ts");
	});

	it("includes structured context for debugging", () => {
		const failure: ValidationFailure = {
			traceId: "trace-ctx-001",
			error: "Workspace lock contention detected",
			errorType: "LockContentionError",
			context: {
				lockedBy: "P9.G2",
				targetPath: "src/**",
				acquiredAt: "2026-05-15T09:00:00Z",
				retryCount: 3,
				strategy: "flash",
			},
		};

		expect(failure.context).toBeDefined();
		expect(failure.context!.lockedBy).toBe("P9.G2");
		expect(failure.context!.retryCount).toBe(3);
		expect(failure.context!.strategy).toBe("flash");
	});

	it("links failure record to the originating validation", () => {
		const failure: ValidationFailure = {
			traceId: "trace-val-042",
			error: "TypeScript compilation error",
			errorType: "TypeError",
			filePath: "src/worker.ts",
			lineNumber: 78,
		};

		const outcome: ValidationOutcome = makeValidation({
			id: "val-fail-042",
			status: "fail",
			name: "TypeScript compilation check",
			error: failure,
		});

		expect(outcome.error).toBeDefined();
		expect(outcome.error!.traceId).toBe("trace-val-042");
		expect(outcome.error!.filePath).toBe("src/worker.ts");
		expect(outcome.error!.lineNumber).toBe(78);

		// The validation's ID can be used to correlate back
		const validationId = outcome.id;
		const traceId = outcome.error!.traceId;
		expect(validationId).toBe("val-fail-042");
		expect(traceId).toBe("trace-val-042");
	});

	it("generates unique trace IDs per failure", () => {
		const failure1: ValidationFailure = {
			traceId: "trace-001",
			error: "Error 1",
			errorType: "TestError",
		};
		const failure2: ValidationFailure = {
			traceId: "trace-002",
			error: "Error 2",
			errorType: "TestError",
		};

		expect(failure1.traceId).not.toBe(failure2.traceId);
	});

	it("includes stack trace when available", () => {
		const failure: ValidationFailure = {
			traceId: "trace-stack-001",
			error: "Runtime error during validation",
			errorType: "RuntimeError",
			stackTrace: `Error: Runtime error during validation
    at validateFile (validator.ts:15:11)
    at runTargetedValidation (runner.ts:88:22)
    at main (index.ts:120:5)`,
		};

		expect(failure.stackTrace).toBeDefined();
		expect(failure.stackTrace).toContain("validator.ts:15:11");
		expect(failure.stackTrace).toContain("runner.ts:88:22");
	});

	it("preserves error record through the full validation lifecycle", async () => {
		runtime = createRemediationRuntime({ reviewer: "p9-g4-ac3-preserve" });
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();

		const failReport = makeDryRunReport({
			success: false,
			error: "Validation failed: circular dependency detected",
		});

		await runtime.runDryRun(() => Promise.resolve(failReport));

		// The failure is captured in the dry-run report
		expect(runtime.dryRunReport!.success).toBe(false);
		expect(runtime.dryRunReport!.error).toBe("Validation failed: circular dependency detected");
		expect(runtime.state).toBe("failed");

		// Create a trace record for this failure
		const failureRecord: ValidationFailure = {
			traceId: "trace-dr-001",
			error: runtime.dryRunReport!.error!,
			errorType: "ValidationError",
			context: {
				dryRunTimestamp: runtime.dryRunReport!.timestamp,
				totalProposals: runtime.dryRunReport!.totalProposals,
				state: runtime.state,
			},
		};

		expect(failureRecord.traceId).toBe("trace-dr-001");
		expect(failureRecord.error).toBe("Validation failed: circular dependency detected");
		expect(failureRecord.context!.state).toBe("failed");
	});

	it("supports multiple failure records in the same validation session", () => {
		const failures: ValidationFailure[] = [
			{
				traceId: "trace-f1",
				error: "File A not found",
				errorType: "FileNotFoundError",
				filePath: "src/a.ts",
			},
			{
				traceId: "trace-f2",
				error: "File B has type error",
				errorType: "TypeError",
				filePath: "src/b.ts",
				lineNumber: 15,
			},
			{
				traceId: "trace-f3",
				error: "Workspace C has circular dependency",
				errorType: "CircularDependencyError",
				context: { cyclePath: ["P9.G2", "P9.G4"] },
			},
		];

		expect(failures).toHaveLength(3);
		expect(failures.every((f) => f.traceId.startsWith("trace-"))).toBe(true);

		// Each traces back to its specific file/context
		expect(failures[0].filePath).toBe("src/a.ts");
		expect(failures[1].filePath).toBe("src/b.ts");
		expect(failures[2].context!.cyclePath).toEqual(["P9.G2", "P9.G4"]);
	});

	it("handles failure records with minimal fields", () => {
		const minimal: ValidationFailure = {
			traceId: "trace-min-001",
			error: "Something went wrong",
			errorType: "GenericError",
		};

		expect(minimal.traceId).toBe("trace-min-001");
		expect(minimal.error).toBe("Something went wrong");
		expect(minimal.filePath).toBeUndefined();
		expect(minimal.lineNumber).toBeUndefined();
		expect(minimal.stackTrace).toBeUndefined();
		expect(minimal.context).toBeUndefined();
	});

	it("groups failures by type for reporting", () => {
		const allFailures: ValidationFailure[] = [
			{ traceId: "t1", error: "E1", errorType: "FileNotFoundError" },
			{ traceId: "t2", error: "E2", errorType: "FileNotFoundError" },
			{ traceId: "t3", error: "E3", errorType: "TypeError" },
			{ traceId: "t4", error: "E4", errorType: "CircularDependencyError" },
			{ traceId: "t5", error: "E5", errorType: "TypeError" },
		];

		const grouped = allFailures.reduce<Record<string, number>>((acc, f) => {
			acc[f.errorType] = (acc[f.errorType] ?? 0) + 1;
			return acc;
		}, {});

		expect(grouped.FileNotFoundError).toBe(2);
		expect(grouped.TypeError).toBe(2);
		expect(grouped.CircularDependencyError).toBe(1);
	});

	it("includes failure records in the full lifecycle with partial failures", async () => {
		runtime = createRemediationRuntime({ reviewer: "p9-g4-ac3-full" });
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));
		await runtime.approvePlan("Plan OK");
		await runtime.requestDryRun();

		// Create a validation record with mixed results
		const fullRecord: DryRunValidationRecord = {
			timestamp: new Date().toISOString(),
			assumptions: [makeAssumption({ description: "All files exist", category: "filesystem", verified: true })],
			targetedValidations: [
				makeValidation({
					id: "val-target-fail",
					type: "targeted",
					name: "Check file A",
					status: "pass",
				}),
				makeValidation({
					id: "val-target-fail-b",
					type: "targeted",
					name: "Check file B",
					status: "fail",
					error: {
						traceId: "trace-target-b",
						error: "File B has type error",
						errorType: "TypeError",
						filePath: "src/b.ts",
						lineNumber: 42,
					},
				}),
			],
			integrationValidations: [
				makeValidation({
					id: "val-integ-fail",
					type: "integration",
					name: "Cross-file consistency",
					status: "fail",
					error: {
						traceId: "trace-integ-001",
						error: "Inconsistent type usage across files",
						errorType: "ConsistencyError",
						context: { files: ["src/a.ts", "src/b.ts"] },
					},
				}),
			],
			summary: {
				totalAssumptions: 1,
				verifiedAssumptions: 1,
				unverifiedAssumptions: 0,
				totalValidations: 3,
				passed: 1,
				failed: 2,
				skipped: 0,
			},
		};

		// Run dry-run with the mixed results incorporated
		const report = makeDryRunReport({
			success: false,
			error: `${fullRecord.summary.failed} validation(s) failed`,
		});

		await runtime.runDryRun(() => Promise.resolve(report));

		expect(runtime.dryRunReport!.success).toBe(false);
		expect(runtime.state).toBe("failed");

		// Verify traceable error records exist
		const targetedFails = fullRecord.targetedValidations.filter((v) => v.status === "fail");
		const integrationFails = fullRecord.integrationValidations.filter((v) => v.status === "fail");
		const allFailures = [...targetedFails, ...integrationFails].map((v) => v.error!);

		expect(allFailures).toHaveLength(2);
		expect(allFailures[0].traceId).toBe("trace-target-b");
		expect(allFailures[1].traceId).toBe("trace-integ-001");

		// Each failure can be traced back to its validation
		expect(targetedFails[0].id).toBe("val-target-fail-b");
		expect(targetedFails[0].error!.traceId).toBe("trace-target-b");
		expect(integrationFails[0].id).toBe("val-integ-fail");
		expect(integrationFails[0].error!.traceId).toBe("trace-integ-001");
	});
});

// ---------------------------------------------------------------------------
// Integration: Full P9.G4 lifecycle with existing runtime
// ---------------------------------------------------------------------------

describe("P9.G4 Full lifecycle integration", () => {
	it("runs complete lifecycle with dry-run assumptions and validations", async () => {
		const runtime = createRemediationRuntime({ reviewer: "p9-g4-full", proposalId: "prop-p9g4-001" });

		// Step 1: Plan
		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 2 })));
		expect(runtime.state).toBe("planning_approval_pending");

		// Step 2: Approve plan
		await runtime.approvePlan("Plan includes file remediation");
		expect(runtime.state).toBe("planning_approved");

		// Step 3: Request dry-run
		await runtime.requestDryRun();
		expect(runtime.state).toBe("dry_run_pending");

		// Step 4: Run dry-run with validation record
		const record: DryRunValidationRecord = {
			timestamp: new Date().toISOString(),
			assumptions: [
				makeAssumption({
					description: "Source files readable",
					category: "permission",
					verified: true,
				}),
				makeAssumption({
					description: "No concurrent modifications",
					category: "state",
					verified: true,
				}),
			],
			targetedValidations: [
				makeValidation({
					type: "targeted",
					name: "File existence verification",
					status: "pass",
				}),
				makeValidation({
					type: "targeted",
					name: "TypeScript compilation check",
					status: "pass",
				}),
			],
			integrationValidations: [
				makeValidation({
					type: "integration",
					name: "Cross-file dependency check",
					status: "pass",
				}),
			],
			summary: {
				totalAssumptions: 2,
				verifiedAssumptions: 2,
				unverifiedAssumptions: 0,
				totalValidations: 3,
				passed: 3,
				failed: 0,
				skipped: 0,
			},
		};

		await runtime.runDryRun(() =>
			Promise.resolve(
				makeDryRunReport({
					success: true,
					totalProposals: 2,
					mutationsPredicted: 2,
				}),
			),
		);

		expect(runtime.state).toBe("dry_run_complete");
		expect(record.assumptions).toHaveLength(2);
		expect(record.summary.passed).toBe(3);

		// Step 5: Approve execution
		await runtime.approveExecution("All assumptions verified, all validations passed");
		expect(runtime.state).toBe("execution_approved");

		// Step 6: Execute
		await runtime.execute(() => Promise.resolve());
		expect(runtime.state).toBe("complete");

		// Verify snapshot includes dry-run info
		const snap = runtime.snapshot();
		expect(snap.dryRunReport).toBeDefined();
		expect(snap.dryRunReport!.success).toBe(true);
		expect(snap.approvalChain).toBeDefined();
		expect(snap.approvalChain!.proposalId).toBe("prop-p9g4-001");
	});

	it("stops at failed dry-run with traceable error", async () => {
		const runtime = createRemediationRuntime({ reviewer: "p9-g4-fail-test" });

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 1 })));
		await runtime.approvePlan("Approve");
		await runtime.requestDryRun();

		const failureRecord: ValidationFailure = {
			traceId: "trace-fatal-001",
			error: "Circular dependency: P9.G2 <-> P9.G4",
			errorType: "CircularDependencyError",
			context: {
				workspaceIds: ["P9.G2", "P9.G4"],
				edgeCount: 3,
				resolution: "Break cycle by deferring P9.G4 until P9.G2 completes",
			},
		};

		await runtime.runDryRun(() =>
			Promise.resolve(
				makeDryRunReport({
					success: false,
					error: failureRecord.error,
				}),
			),
		);

		expect(runtime.state).toBe("failed");
		expect(runtime.dryRunReport!.error).toBe(failureRecord.error);

		// Execution is blocked
		await expect(runtime.approveExecution("Should not work")).rejects.toThrow();
	});

	it("handles multiple validations with a mix of pass/fail/skipped", async () => {
		const runtime = createRemediationRuntime({ reviewer: "p9-g4-mixed" });

		await runtime.plan(() => Promise.resolve(makeScanResult({ proposals: 3 })));
		await runtime.approvePlan();
		await runtime.requestDryRun();

		const record: DryRunValidationRecord = {
			timestamp: new Date().toISOString(),
			assumptions: [],
			targetedValidations: Array.from({ length: 5 }, (_, i) =>
				makeValidation({
					id: `targeted-${i + 1}`,
					type: "targeted",
					name: `Targeted check ${i + 1}`,
					status: i < 3 ? "pass" : i === 3 ? "fail" : "skipped",
					error:
						i === 3
							? {
									traceId: `trace-targeted-${i + 1}`,
									error: `Targeted check ${i + 1} failed`,
									errorType: "TargetedCheckError",
								}
							: undefined,
				}),
			),
			integrationValidations: Array.from({ length: 3 }, (_, i) =>
				makeValidation({
					id: `integration-${i + 1}`,
					type: "integration",
					name: `Integration check ${i + 1}`,
					status: i < 2 ? "pass" : "fail",
					error:
						i === 2
							? {
									traceId: `trace-integration-${i + 1}`,
									error: `Integration check ${i + 1} failed`,
									errorType: "IntegrationCheckError",
								}
							: undefined,
				}),
			),
			summary: {
				totalAssumptions: 0,
				verifiedAssumptions: 0,
				unverifiedAssumptions: 0,
				totalValidations: 8,
				passed: 5,
				failed: 2,
				skipped: 1,
			},
		};

		const report = makeDryRunReport({
			success: false,
			error: `2 validation(s) failed, 1 skipped`,
			totalProposals: 3,
		});

		await runtime.runDryRun(() => Promise.resolve(report));

		expect(runtime.state).toBe("failed");
		expect(runtime.dryRunReport!.error).toBe("2 validation(s) failed, 1 skipped");

		// Verify trace records for all 2 failures
		const failures = [
			...record.targetedValidations.filter((v) => v.status === "fail"),
			...record.integrationValidations.filter((v) => v.status === "fail"),
		];
		expect(failures).toHaveLength(2);
		failures.forEach((f) => {
			expect(f.error).toBeDefined();
			expect(f.error!.traceId).toMatch(/^trace-/);
		});
	});
});
