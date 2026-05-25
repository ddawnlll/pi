/**
 * Fix Strategist Worker — Test Plan Generator — 25.J
 *
 * Generates test plans from patch strategies to verify that fixes
 * resolve the identified issues without regressions.
 *
 * Key design:
 * - Test plans are derived from patch strategy actions and root causes.
 * - Plans include verification steps, test cases, and edge cases.
 * - Test coverage analysis identifies gaps in the test plan.
 * - Evidence-backed — each test case links to evidence/root causes.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import type { PatchAction, PatchStrategy, FixRootCauseFinding } from "./patch-strategy.js";

// ---------------------------------------------------------------------------
// Test Case
// ---------------------------------------------------------------------------

/**
 * Type of test case in a test plan.
 */
export type TestCaseType =
	| "unit" // Unit test
	| "integration" // Integration test
	| "e2e" // End-to-end test
	| "regression" // Regression test
	| "manual"; // Manual verification step

/**
 * All valid TestCaseType values for runtime validation.
 */
export const ALL_TEST_CASE_TYPES: readonly TestCaseType[] = [
	"unit",
	"integration",
	"e2e",
	"regression",
	"manual",
] as const;

/**
 * Expected result of a test case.
 */
export type TestExpectedResult =
	| "pass" // Should pass (verifying fix)
	| "fail" // Should fail (verifying detection)
	| "error" // Should error (verifying error handling)
	| "compile"; // Should compile (type checking)

/**
 * A single test case within a test plan.
 */
export interface TestCase {
	/** Unique test case identifier */
	id: string;

	/** Test case type */
	type: TestCaseType;

	/** Test name / title */
	name: string;

	/** Detailed description of what this test verifies */
	description: string;

	/** The file path where this test should be added */
	targetFile?: string;

	/** Test code / steps */
	steps: string;

	/** Expected outcome */
	expectedResult: TestExpectedResult;

	/** Root cause finding IDs that this test addresses */
	rootCauseRefs: string[];

	/** Patch action IDs that this test verifies */
	actionRefs: string[];

	/** Priority within the plan (1 = highest) */
	priority: number;

	/** Whether this test is required for fix verification */
	isRequired: boolean;
}

// ---------------------------------------------------------------------------
// Test Plan
// ---------------------------------------------------------------------------

/**
 * A complete test plan for verifying a fix strategy.
 *
 * Contains test cases, coverage analysis, and verification instructions.
 */
export interface TestPlan {
	/** Unique test plan identifier */
	id: string;

	/** ISO 8601 timestamp of plan creation */
	createdAt: string;

	/** Strategy ID this plan was generated from */
	strategyId: string;

	/** Human-readable title */
	title: string;

	/** Detailed description of what this plan covers */
	description: string;

	/** Test cases in this plan */
	testCases: TestCase[];

	/** Root cause finding IDs covered by this plan */
	coveredRootCauses: string[];

	/** Root cause finding IDs NOT covered by this plan */
	uncoveredRootCauses: string[];

	/** Patch action IDs covered by this plan */
	coveredActions: string[];

	/** Patch action IDs NOT covered by this plan */
	uncoveredActions: string[];

	/** Coverage percentage (0-100) */
	coveragePercent: number;

	/** Whether the plan has sufficient coverage to proceed */
	isSufficient: boolean;

	/** Verification instructions (steps to run) */
	verificationInstructions: string[];

	/** Diagnostics generated during plan generation */
	diagnostics: string[];

	/** Whether the plan generation was successful */
	isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Test Plan Generator Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the TestPlanGenerator.
 */
export interface TestPlanGeneratorConfig {
	/**
	 * Maximum test cases per plan. Default: 30.
	 */
	maxTestCases: number;

	/**
	 * Minimum coverage percentage required for sufficiency. Default: 70.
	 */
	minCoveragePercent: number;

	/**
	 * Whether to auto-generate edge case tests. Default: true.
	 */
	autoGenerateEdgeCases: boolean;

	/**
	 * Whether to auto-generate regression tests. Default: true.
	 */
	autoGenerateRegressionTests: boolean;

	/**
	 * Preferred test type for generated tests. Default: "unit".
	 */
	preferredTestType: TestCaseType;
}

/**
 * Default configuration for the TestPlanGenerator.
 */
export const DEFAULT_TEST_PLAN_GENERATOR_CONFIG: TestPlanGeneratorConfig = {
	maxTestCases: 30,
	minCoveragePercent: 70,
	autoGenerateEdgeCases: true,
	autoGenerateRegressionTests: true,
	preferredTestType: "unit",
};

// ---------------------------------------------------------------------------
// Test Plan Generator
// ---------------------------------------------------------------------------

/**
 * Generates test plans from patch strategies.
 *
 * Analyzes strategy actions and root causes to produce comprehensive
 * test plans with coverage analysis and verification instructions.
 */
export class TestPlanGenerator {
	private config: TestPlanGeneratorConfig;
	private plans: Map<string, TestPlan>;

	constructor(config?: Partial<TestPlanGeneratorConfig>) {
		this.config = {
			maxTestCases: config?.maxTestCases ?? DEFAULT_TEST_PLAN_GENERATOR_CONFIG.maxTestCases,
			minCoveragePercent: config?.minCoveragePercent ?? DEFAULT_TEST_PLAN_GENERATOR_CONFIG.minCoveragePercent,
			autoGenerateEdgeCases:
				config?.autoGenerateEdgeCases ?? DEFAULT_TEST_PLAN_GENERATOR_CONFIG.autoGenerateEdgeCases,
			autoGenerateRegressionTests:
				config?.autoGenerateRegressionTests ?? DEFAULT_TEST_PLAN_GENERATOR_CONFIG.autoGenerateRegressionTests,
			preferredTestType: config?.preferredTestType ?? DEFAULT_TEST_PLAN_GENERATOR_CONFIG.preferredTestType,
		};
		this.plans = new Map();
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the generator configuration.
	 */
	setConfig(config: Partial<TestPlanGeneratorConfig>): void {
		if (config.maxTestCases !== undefined) this.config.maxTestCases = config.maxTestCases;
		if (config.minCoveragePercent !== undefined) this.config.minCoveragePercent = config.minCoveragePercent;
		if (config.autoGenerateEdgeCases !== undefined) this.config.autoGenerateEdgeCases = config.autoGenerateEdgeCases;
		if (config.autoGenerateRegressionTests !== undefined)
			this.config.autoGenerateRegressionTests = config.autoGenerateRegressionTests;
		if (config.preferredTestType !== undefined) this.config.preferredTestType = config.preferredTestType;
	}

	/**
	 * Get the current configuration.
	 */
	getConfig(): TestPlanGeneratorConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Test Case Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate test cases for a specific action.
	 *
	 * Creates a test case targeting the file and change described by
	 * the action, linked to the relevant root cause findings.
	 *
	 * @param action - The patch action to generate tests for.
	 * @param rootCauses - Root cause findings linked to this action.
	 * @returns An array of generated test cases.
	 */
	generateTestCasesForAction(action: PatchAction, rootCauses: FixRootCauseFinding[]): TestCase[] {
		const testCases: TestCase[] = [];
		const rootCauseRefs = rootCauses.map((r) => r.id);

		// Primary test case for the action
		testCases.push({
			id: randomUUID(),
			type: this.config.preferredTestType,
			name: `Verify ${action.type} of ${this.shortenPath(action.filePath)}`,
			description: `Verifies that the ${action.type} operation on ${action.filePath} produces the expected result: ${action.description}`,
			targetFile: this.inferTestFilePath(action.filePath),
			steps: this.inferTestSteps(action),
			expectedResult: "pass",
			rootCauseRefs,
			actionRefs: [action.id],
			priority: 1,
			isRequired: true,
		});

		// Add edge case tests if enabled
		if (this.config.autoGenerateEdgeCases && action.type === "modify") {
			testCases.push({
				id: randomUUID(),
				type: this.config.preferredTestType,
				name: `Edge case: ${this.shortenPath(action.filePath)} handles unexpected input`,
				description: `Tests that the modified ${action.filePath} handles edge cases gracefully (null, undefined, empty, boundary values)`,
				targetFile: this.inferTestFilePath(action.filePath),
				steps: `// Edge case test for ${action.filePath}\n// Test with null, undefined, empty, and boundary inputs\n// Ensure no regressions on valid inputs`,
				expectedResult: "pass",
				rootCauseRefs,
				actionRefs: [action.id],
				priority: 2,
				isRequired: false,
			});
		}

		return testCases;
	}

	/**
	 * Generate test cases for a root cause finding.
	 *
	 * Creates a regression test that reproduces the condition described
	 * by the root cause and verifies it no longer occurs after the fix.
	 *
	 * @param finding - The root cause finding.
	 * @returns A test case, or null if no test can be generated.
	 */
	generateTestCaseForRootCause(finding: FixRootCauseFinding): TestCase | null {
		const targetFile = finding.affectedFiles.length > 0 ? finding.affectedFiles[0]! : "src/unknown.ts";
		const testFile = this.inferTestFilePath(targetFile);

		return {
			id: randomUUID(),
			type: "regression",
			name: `Regression: ${finding.description.slice(0, 60)}`,
			description: `Regression test for root cause: ${finding.description}`,
			targetFile: testFile,
			steps: `// Regression test for: ${finding.description}\n// Category: ${finding.category}\n// Reproduce the failure condition and verify it is resolved\n// See evidence refs: ${finding.evidenceRefs.join(", ")}`,
			expectedResult: "pass",
			rootCauseRefs: [finding.id],
			actionRefs: [],
			priority: 1,
			isRequired: true,
		};
	}

	/**
	 * Generate edge case tests for a root cause category.
	 *
	 * Creates tests targeting the edge cases most relevant to the
	 * root cause category (e.g., null checks for null_reference).
	 *
	 * @param finding - The root cause finding.
	 * @returns An array of generated edge case tests.
	 */
	generateEdgeCasesForRootCause(finding: FixRootCauseFinding): TestCase[] {
		if (!this.config.autoGenerateEdgeCases) return [];

		const targetFile = finding.affectedFiles.length > 0 ? finding.affectedFiles[0]! : "src/unknown.ts";
		const testFile = this.inferTestFilePath(targetFile);
		const tests: TestCase[] = [];

		switch (finding.category) {
			case "null_reference":
				tests.push({
					id: randomUUID(),
					type: "unit",
					name: `Null guard: ${this.shortenPath(targetFile)}`,
					description: `Verifies null/undefined guards work correctly in ${targetFile}`,
					targetFile: testFile,
					steps: `// Test null guard in ${targetFile}\n// 1. Call with null input\n// 2. Call with undefined input\n// 3. Call with valid input (no regression)`,
					expectedResult: "pass",
					rootCauseRefs: [finding.id],
					actionRefs: [],
					priority: 2,
					isRequired: false,
				});
				break;

			case "type_error":
				tests.push({
					id: randomUUID(),
					type: "unit",
					name: `Type check: ${this.shortenPath(targetFile)}`,
					description: `Verifies type checking in ${targetFile} rejects invalid types`,
					targetFile: testFile,
					steps: `// Test type checking in ${targetFile}\n// 1. Call with wrong type\n// 2. Call with partial type\n// 3. Call with correct type (no regression)`,
					expectedResult: "pass",
					rootCauseRefs: [finding.id],
					actionRefs: [],
					priority: 2,
					isRequired: false,
				});
				break;

			case "missing_edge_case":
				tests.push({
					id: randomUUID(),
					type: "unit",
					name: `Boundary: ${this.shortenPath(targetFile)}`,
					description: `Verifies boundary condition handling in ${targetFile}`,
					targetFile: testFile,
					steps: `// Test boundary conditions in ${targetFile}\n// 1. Test min boundary\n// 2. Test max boundary\n// 3. Test empty state\n// 4. Test overflow`,
					expectedResult: "pass",
					rootCauseRefs: [finding.id],
					actionRefs: [],
					priority: 3,
					isRequired: false,
				});
				break;

			default:
				break;
		}

		return tests;
	}

	// -----------------------------------------------------------------------
	// Plan Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate a complete TestPlan from a PatchStrategy.
	 *
	 * Analyzes all actions and root causes to create a comprehensive
	 * test plan with coverage analysis and verification steps.
	 *
	 * @param strategy - The patch strategy to generate a plan for.
	 * @returns The generated TestPlan.
	 */
	generatePlan(strategy: PatchStrategy): TestPlan {
		const planId = randomUUID();
		const now = new Date().toISOString();
		const testCases: TestCase[] = [];
		const diagnostics: string[] = [];
		const verificationSteps: string[] = [];

		// Track coverage
		const coveredRootCauseIds = new Set<string>();
		const coveredActionIds = new Set<string>();

		// 1. Generate test cases for each action
		for (const action of strategy.actions) {
			const relevantCauses = strategy.rootCauses.filter((rc) =>
				rc.affectedFiles.some((f) => action.filePath.includes(f) || f.includes(action.filePath)),
			);

			const actionTests = this.generateTestCasesForAction(action, relevantCauses);
			for (const test of actionTests) {
				if (testCases.length < this.config.maxTestCases) {
					testCases.push(test);
					coveredActionIds.add(action.id);
					for (const ref of test.rootCauseRefs) coveredRootCauseIds.add(ref);
				}
			}
		}

		// 2. Generate regression tests for uncovered root causes
		for (const finding of strategy.rootCauses) {
			if (testCases.length >= this.config.maxTestCases) break;

			if (!coveredRootCauseIds.has(finding.id)) {
				const regressionTest = this.generateTestCaseForRootCause(finding);
				if (regressionTest) {
					testCases.push(regressionTest);
					coveredRootCauseIds.add(finding.id);
				}
			}
		}

		// 3. Generate edge case tests
		if (this.config.autoGenerateEdgeCases) {
			for (const finding of strategy.rootCauses) {
				if (testCases.length >= this.config.maxTestCases) break;
				const edgeTests = this.generateEdgeCasesForRootCause(finding);
				for (const test of edgeTests) {
					if (testCases.length < this.config.maxTestCases) {
						testCases.push(test);
					}
				}
			}
		}

		// 4. Determine coverage
		const uncoveredRootCauses = strategy.rootCauses.filter((r) => !coveredRootCauseIds.has(r.id)).map((r) => r.id);

		const uncoveredActions = strategy.actions.filter((a) => !coveredActionIds.has(a.id)).map((a) => a.id);

		const totalCoverageItems = strategy.rootCauses.length + strategy.actions.length;
		const coveredItems = coveredRootCauseIds.size + coveredActionIds.size;
		const coveragePercent = totalCoverageItems > 0 ? Math.round((coveredItems / totalCoverageItems) * 100) : 0;

		const isSufficient = coveragePercent >= this.config.minCoveragePercent;

		// 5. Generate verification instructions
		if (testCases.length > 0) {
			const requiredTests = testCases.filter((t) => t.isRequired);
			const optionalTests = testCases.filter((t) => !t.isRequired);

			verificationSteps.push(`Run ${requiredTests.length} required test(s) to verify the fix`);
			if (optionalTests.length > 0) {
				verificationSteps.push(`Run ${optionalTests.length} optional test(s) for additional coverage`);
			}

			// Group by test type
			const types = [...new Set(testCases.map((t) => t.type))];
			for (const type of types) {
				const count = testCases.filter((t) => t.type === type).length;
				verificationSteps.push(`${type}: ${count} test(s)`);
			}
		} else {
			diagnostics.push("No test cases were generated — verify fix manually");
			verificationSteps.push("No automated tests available; perform manual verification");
		}

		if (!isSufficient) {
			diagnostics.push(
				`Coverage (${coveragePercent}%) is below minimum threshold (${this.config.minCoveragePercent}%)`,
			);
		}

		if (uncoveredRootCauses.length > 0) {
			diagnostics.push(`${uncoveredRootCauses.length} root cause(s) are not covered by tests`);
		}

		if (uncoveredActions.length > 0) {
			diagnostics.push(`${uncoveredActions.length} action(s) are not covered by tests`);
		}

		// Determine plan completeness
		const isComplete = testCases.length > 0 || strategy.actions.length === 0;

		const plan: TestPlan = {
			id: planId,
			createdAt: now,
			strategyId: strategy.id,
			title: `Test Plan: ${strategy.title}`,
			description: `Test plan for verifying the fix strategy "${strategy.title}". ${testCases.length} test case(s) covering ${coveragePercent}% of actions and root causes.`,
			testCases,
			coveredRootCauses: [...coveredRootCauseIds],
			uncoveredRootCauses,
			coveredActions: [...coveredActionIds],
			uncoveredActions,
			coveragePercent,
			isSufficient,
			verificationInstructions: verificationSteps,
			diagnostics,
			isComplete,
		};

		this.plans.set(planId, plan);
		return plan;
	}

	// -----------------------------------------------------------------------
	// Plan Management
	// -----------------------------------------------------------------------

	/**
	 * Get a generated plan by ID.
	 */
	getPlan(id: string): TestPlan | undefined {
		return this.plans.get(id);
	}

	/**
	 * Get all generated plans.
	 */
	getAllPlans(): TestPlan[] {
		return Array.from(this.plans.values());
	}

	/**
	 * Clear all generated plans.
	 */
	clearPlans(): void {
		this.plans.clear();
	}

	/**
	 * Get the count of generated plans.
	 */
	get planCount(): number {
		return this.plans.size;
	}

	// -----------------------------------------------------------------------
	// Serialization
	// -----------------------------------------------------------------------

	/**
	 * Serialize a plan to JSON.
	 */
	serializePlan(planId: string): string | null {
		const plan = this.plans.get(planId);
		if (!plan) return null;
		return JSON.stringify(plan, null, 2);
	}

	/**
	 * Serialize all plans to JSON.
	 */
	serializeAll(): string {
		return JSON.stringify(this.getAllPlans(), null, 2);
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	/**
	 * Infer the test file path for a source file.
	 */
	private inferTestFilePath(sourcePath: string): string {
		// If it's already a test file, return as-is
		if (sourcePath.includes(".test.") || sourcePath.includes(".spec.")) return sourcePath;

		// Convert src/foo.ts -> test/foo.test.ts
		// Convert packages/*/src/ -> packages/*/test/
		const parts = sourcePath.split("/");
		const fileName = parts[parts.length - 1] ?? "";
		const fileNameParts = fileName.split(".");
		const ext = fileNameParts.length > 1 ? fileNameParts[fileNameParts.length - 1]! : "ts";
		const baseName = fileNameParts.slice(0, -1).join(".") || fileNameParts[0]!;

		if (sourcePath.startsWith("src/")) {
			const subPath = sourcePath.slice(4);
			const lastSlash = subPath.lastIndexOf("/");
			if (lastSlash >= 0) {
				const dir = subPath.slice(0, lastSlash);
				return `test/${dir}/${baseName}.test.${ext}`;
			}
			return `test/${baseName}.test.${ext}`;
		}

		if (sourcePath.startsWith("packages/")) {
			const afterPackages = sourcePath.slice("packages/".length);
			const firstSlash = afterPackages.indexOf("/");
			if (firstSlash >= 0) {
				const pkgName = afterPackages.slice(0, firstSlash);
				const rest = afterPackages.slice(firstSlash + 1);
				if (rest.startsWith("src/")) {
					const subPath = rest.slice(4);
					const lastSlash = subPath.lastIndexOf("/");
					if (lastSlash >= 0) {
						const dir = subPath.slice(0, lastSlash);
						return `packages/${pkgName}/test/${dir}/${baseName}.test.${ext}`;
					}
					return `packages/${pkgName}/test/${baseName}.test.${ext}`;
				}
				const lastSlash = rest.lastIndexOf("/");
				if (lastSlash >= 0) {
					const dir = rest.slice(0, lastSlash);
					return `packages/${pkgName}/test/${dir}/${baseName}.test.${ext}`;
				}
				return `packages/${pkgName}/test/${baseName}.test.${ext}`;
			}
		}

		return sourcePath.replace(/\.([a-z]+)$/, ".test.$1");
	}

	/**
	 * Shorten a file path for display.
	 */
	private shortenPath(path: string): string {
		const parts = path.split("/");
		if (parts.length <= 3) return path;
		return `${parts[0]}/.../${parts[parts.length - 1]}`;
	}

	/**
	 * Infer test steps for a patch action.
	 */
	private inferTestSteps(action: PatchAction): string {
		switch (action.type) {
			case "create":
				return `// Verify that ${action.filePath} was created correctly\n// 1. Import the new module\n// 2. Call its public API\n// 3. Verify output matches expected values`;
			case "delete":
				return `// Verify that ${action.filePath} was removed without breaking consumers\n// 1. Ensure imports of deleted file are updated\n// 2. Verify no references remain\n// 3. Run consuming module tests`;
			case "rename":
				return `// Verify that ${action.filePath} was renamed to ${action.newFilePath}\n// 1. Verify old file no longer exists\n// 2. Verify new file is importable\n// 3. Verify imports are updated`;
			default:
				return `// Verify the changes to ${action.filePath}\n// 1. Import the modified module\n// 2. Exercise the changed code path\n// 3. Verify output matches expected behavior`;
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TestPlanGenerator with default configuration.
 *
 * @param config - Optional partial configuration overrides.
 * @returns A new TestPlanGenerator instance.
 */
export function createTestPlanGenerator(config?: Partial<TestPlanGeneratorConfig>): TestPlanGenerator {
	return new TestPlanGenerator(config);
}
