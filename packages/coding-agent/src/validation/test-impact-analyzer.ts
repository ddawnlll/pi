/**
 * Test Impact Analyzer - P6.G (Test Impact Analysis v1)
 *
 * Analyzes changed files and maps them to the repo areas/components they
 * affect, then returns targeted test and build commands. Low-confidence
 * mappings (ambiguous or unmatched files) trigger broader validation.
 *
 * The analyzer is used by the validation planner to produce smarter,
 * file-aware validation plans.
 *
 * ## Confidence Model
 *
 * - **High** (0.9): File matches a direct, unambiguous area pattern
 *   (e.g., `packages/coding-agent/src/core/*.ts` -> coding-agent-core)
 * - **Medium** (0.6): File matches a broader area but not a specific
 *   sub-area (e.g., `packages/coding-agent/README.md` -> coding-agent)
 * - **Low** (0.3): File does not match any known area (unrecognized path)
 *
 * When overall confidence < 0.7, or any file is unmatched, broader
 * validation is used instead of targeted commands.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Describes a known repo area/component.
 *
 * Each area has a set of path patterns for matching changed files,
 * a default test path for running tests in that area, and optional
 * build commands.
 */
export interface AreaMapping {
	/** Human-readable area name (e.g., "dashboard", "coding-agent-core") */
	name: string;
	/**
	 * Regex patterns that match file paths belonging to this area.
	 * Patterns are tested against paths relative to the repo root.
	 */
	pathPatterns: RegExp[];
	/**
	 * Default test directory or test file glob for this area.
	 * Used to construct vitest commands.
	 */
	testPath: string;
	/**
	 * Build / typecheck commands to run for this area.
	 * These are shell commands that can be passed to bash.
	 */
	buildCommands: string[];
	/**
	 * Base path for the area (used to derive test file names from
	 * source file names). If empty, the area's testPath is used as-is.
	 */
	basePath?: string;
}

/**
 * Impact analysis for a single affected component/area.
 */
export interface ComponentImpact {
	/** Area name */
	name: string;
	/** Changed file paths assigned to this component */
	changedFiles: string[];
	/** Targeted test commands derived for this component */
	testCommands: string[];
	/** Build/typecheck commands for this component */
	buildCommands: string[];
	/** Confidence that this mapping is correct (0.0 - 1.0) */
	confidence: number;
}

/**
 * Full result of a test impact analysis.
 */
export interface TestImpactResult {
	/** Per-component impact details */
	components: ComponentImpact[];
	/** Aggregate confidence across all components (0.0 - 1.0) */
	overallConfidence: number;
	/** Flat list of targeted test commands */
	testCommands: string[];
	/** Flat list of build commands */
	buildCommands: string[];
	/** True when confidence is low enough to require broader validation */
	useBroaderValidation: boolean;
	/** Human-readable summary of the analysis */
	summary: string;
}

/**
 * Format options for impact result summary.
 */
export interface FormatOptions {
	/** Whether to include file-level detail in the summary (default: true) */
	includeFileDetail?: boolean;
}

// ---------------------------------------------------------------------------
// Area Mappings
// ---------------------------------------------------------------------------

/**
 * Default set of area mappings for the pi-mono repository.
 *
 * Each entry maps file path patterns to a repo area with known test and
 * build commands. These are the "known areas" of the monorepo.
 *
 * Extend this registry when adding new packages or components.
 */
export const DEFAULT_AREA_MAPPINGS: AreaMapping[] = [
	// --- Dashboard (packages/web-ui/dashboard) ---
	{
		name: "dashboard",
		pathPatterns: [/^packages\/web-ui\/dashboard\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/web-ui run build"],
	},

	// --- Web UI core (not dashboard) ---
	{
		name: "web-ui-core",
		pathPatterns: [/^packages\/web-ui\/(src|example)\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/web-ui run build"],
	},

	// --- Coding Agent core ---
	{
		name: "coding-agent-core",
		pathPatterns: [/^packages\/coding-agent\/src\/core\//],
		testPath: "packages/coding-agent/test/",
		buildCommands: ["npm --prefix packages/coding-agent run typecheck"],
		basePath: "packages/coding-agent/src/core/",
	},

	// --- Coding Agent validation ---
	{
		name: "coding-agent-validation",
		pathPatterns: [/^packages\/coding-agent\/src\/validation\//],
		testPath: "packages/coding-agent/test/",
		buildCommands: ["npm --prefix packages/coding-agent run typecheck"],
		basePath: "packages/coding-agent/src/validation/",
	},

	// --- Coding Agent CLI ---
	{
		name: "coding-agent-cli",
		pathPatterns: [/^packages\/coding-agent\/src\/cli\//],
		testPath: "packages/coding-agent/test/",
		buildCommands: ["npm --prefix packages/coding-agent run typecheck"],
		basePath: "packages/coding-agent/src/cli/",
	},

	// --- Coding Agent general (misc files not under src/) ---
	{
		name: "coding-agent-general",
		pathPatterns: [/^packages\/coding-agent\/(src|docs)\//],
		testPath: "packages/coding-agent/test/",
		buildCommands: ["npm --prefix packages/coding-agent run typecheck"],
	},

	// --- Coding Agent tests (changed test files) ---
	{
		name: "coding-agent-tests",
		pathPatterns: [/^packages\/coding-agent\/test\//],
		testPath: "packages/coding-agent/test/%file%",
		buildCommands: [],
	},

	// --- AI package ---
	{
		name: "ai-core",
		pathPatterns: [/^packages\/ai\//],
		testPath: "packages/ai/test/",
		buildCommands: ["npm --prefix packages/ai run typecheck"],
		basePath: "packages/ai/src/",
	},

	// --- TUI package ---
	{
		name: "tui",
		pathPatterns: [/^packages\/tui\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/tui run build"],
	},

	// --- Agent package ---
	{
		name: "agent-core",
		pathPatterns: [/^packages\/agent\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/agent run typecheck"],
	},

	// --- DB package ---
	{
		name: "db",
		pathPatterns: [/^packages\/db\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/db run typecheck"],
	},

	// --- Web Server ---
	{
		name: "web-server",
		pathPatterns: [/^packages\/web-server\//],
		testPath: "",
		buildCommands: ["npm --prefix packages/web-server run typecheck"],
	},
];

/**
 * Confidence threshold below which broader validation is used.
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Confidence for a direct area pattern match.
 */
const HIGH_CONFIDENCE = 0.9;

/**
 * Confidence for an unmatched file.
 */
const LOW_CONFIDENCE = 0.3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a vitest command from a test path and a changed file.
 *
 * For known source patterns, attempts to derive the corresponding test
 * file. Falls back to running all tests in the area's test directory.
 */
function deriveTestCommand(area: AreaMapping, changedFile: string): string | null {
	// If the test path is empty, the area has no automated tests
	if (!area.testPath) {
		return null;
	}

	// If the changed file is already a test file, run it directly
	if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(changedFile)) {
		return `vitest --run ${changedFile}`;
	}

	// If we have a basePath, try to derive the test file name
	if (area.basePath) {
		const basePath = area.basePath;
		if (changedFile.startsWith(basePath)) {
			// Strip base path and extension, append .test.ts
			const relativeFile = changedFile.slice(basePath.length);
			const nameWithoutExt = relativeFile.replace(/\.(ts|tsx|js|jsx)$/, "");
			const derivedTestPath = `${area.testPath}${nameWithoutExt}.test.ts`;
			return `vitest --run ${derivedTestPath}`;
		}
	}

	// Fall back to running all tests in the area's test directory
	if (area.testPath && !area.testPath.includes("%file%")) {
		return `vitest --run ${area.testPath}`;
	}

	return null;
}

/**
 * Build a human-readable summary of the analysis result.
 */
function buildSummary(
	components: ComponentImpact[],
	overallConfidence: number,
	useBroaderValidation: boolean,
	options?: FormatOptions,
): string {
	const includeFileDetail = options?.includeFileDetail ?? true;
	const lines: string[] = [];

	if (useBroaderValidation) {
		lines.push("Test Impact Analysis: Low confidence - broader validation required");
	} else {
		lines.push("Test Impact Analysis: Targeted validation available");
	}

	lines.push(`Overall confidence: ${(overallConfidence * 100).toFixed(0)}%`);
	lines.push(`Affected components: ${components.map((c) => c.name).join(", ")}`);

	if (includeFileDetail) {
		for (const ci of components) {
			lines.push(`  ${ci.name}: ${ci.changedFiles.length} file(s) changed`);
			for (const f of ci.changedFiles) {
				lines.push(`    - ${f}`);
			}
			if (ci.testCommands.length > 0) {
				lines.push(`    Tests: ${ci.testCommands.join(", ")}`);
			}
			if (ci.buildCommands.length > 0) {
				lines.push(`    Build: ${ci.buildCommands.join(", ")}`);
			}
			lines.push(`    Confidence: ${(ci.confidence * 100).toFixed(0)}%`);
		}
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/**
 * Analyze a set of changed files and return a test impact result.
 *
 * Each file is matched against the area mappings. Files are grouped by
 * area, and test/build commands are derived for each group. Aggregate
 * confidence is computed, and if it falls below the threshold (or if
 * any file is unmatched), broader validation is recommended.
 *
 * @param changedFiles - Array of file paths changed (relative to repo root)
 * @param areaMappings - Area mappings (defaults to DEFAULT_AREA_MAPPINGS)
 * @param formatOptions - Options for the summary formatting
 * @returns A structured analysis result
 */
export function analyzeTestImpact(
	changedFiles: string[],
	areaMappings: AreaMapping[] = DEFAULT_AREA_MAPPINGS,
	formatOptions?: FormatOptions,
): TestImpactResult {
	const componentMap = new Map<string, ComponentImpact>();
	let hasUnmatchedFile = false;

	// Process each changed file
	for (const file of changedFiles) {
		let matched = false;

		for (const area of areaMappings) {
			if (area.pathPatterns.some((pattern) => pattern.test(file))) {
				let ci = componentMap.get(area.name);
				if (!ci) {
					ci = {
						name: area.name,
						changedFiles: [],
						testCommands: [],
						buildCommands: [],
						confidence: HIGH_CONFIDENCE,
					};
					componentMap.set(area.name, ci);
				}
				ci.changedFiles.push(file);
				ci.confidence = HIGH_CONFIDENCE;

				// Derive test command for this file
				const testCmd = deriveTestCommand(area, file);
				if (testCmd && !ci.testCommands.includes(testCmd)) {
					ci.testCommands.push(testCmd);
				}

				// Add build commands (deduplicated)
				for (const bc of area.buildCommands) {
					if (!ci.buildCommands.includes(bc)) {
						ci.buildCommands.push(bc);
					}
				}

				matched = true;
				break; // Assign file to first matching area
			}
		}

		if (!matched) {
			hasUnmatchedFile = true;
			// Group as "other" with low confidence
			let ci = componentMap.get("unknown");
			if (!ci) {
				ci = {
					name: "unknown",
					changedFiles: [],
					testCommands: [],
					buildCommands: [],
					confidence: LOW_CONFIDENCE,
				};
				componentMap.set("unknown", ci);
			}
			ci.changedFiles.push(file);
		}
	}

	// If no changes, return a "clean" result
	if (changedFiles.length === 0) {
		return {
			components: [],
			overallConfidence: 1.0,
			testCommands: [],
			buildCommands: [],
			useBroaderValidation: false,
			summary: "No files changed — no validation needed",
		};
	}

	// Compute overall confidence as weighted average
	const components = [...componentMap.values()];
	let totalWeight = 0;
	let weightedConfidence = 0;
	for (const ci of components) {
		const weight = ci.changedFiles.length;
		totalWeight += weight;
		weightedConfidence += weight * ci.confidence;
	}
	const overallConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 1.0;

	// Determine whether broader validation is needed
	const useBroaderValidation = overallConfidence < CONFIDENCE_THRESHOLD || hasUnmatchedFile;

	// Build the flat command lists
	const testCommands: string[] = [];
	const buildCommands: string[] = [];

	if (useBroaderValidation) {
		// Broader validation: run full suite
		testCommands.push("npm test");
		buildCommands.push("npm run typecheck");
	} else {
		for (const ci of components) {
			for (const tc of ci.testCommands) {
				if (!testCommands.includes(tc)) {
					testCommands.push(tc);
				}
			}
			for (const bc of ci.buildCommands) {
				if (!buildCommands.includes(bc)) {
					buildCommands.push(bc);
				}
			}
		}
	}

	const summary = buildSummary(components, overallConfidence, useBroaderValidation, formatOptions);

	return {
		components,
		overallConfidence,
		testCommands,
		buildCommands,
		useBroaderValidation,
		summary,
	};
}

/**
 * Format a test impact result as a human-readable string suitable for
 * logging to console or file.
 *
 * @param result - The analysis result to format
 * @param options - Formatting options
 * @returns Formatted string
 */
export function formatImpactResult(result: TestImpactResult, options?: FormatOptions): string {
	return buildSummary(result.components, result.overallConfidence, result.useBroaderValidation, options);
}

/**
 * Log a test impact result to the console.
 *
 * Uses clear section headers and indentation for readability in both
 * terminal and log-file contexts.
 *
 * @param result - The analysis result to log
 */
export function logImpactResult(result: TestImpactResult): void {
	const header = "=".repeat(60);
	const subheader = "-".repeat(40);

	console.log(`\n${header}`);
	console.log("TEST IMPACT ANALYSIS");
	console.log(`${header}\n`);

	if (result.components.length === 0) {
		console.log("No files changed -- no validation needed.");
		console.log(`${header}\n`);
		return;
	}

	console.log(`Components affected: ${result.components.length}`);
	console.log(`Overall confidence:  ${(result.overallConfidence * 100).toFixed(0)}%`);
	console.log(`Broader validation:  ${result.useBroaderValidation ? "YES (low confidence)" : "no"}`);
	console.log();

	for (const ci of result.components) {
		console.log(`${subheader}`);
		console.log(`Component: ${ci.name}`);
		console.log(`Confidence: ${(ci.confidence * 100).toFixed(0)}%`);
		console.log(`Files (${ci.changedFiles.length}):`);
		for (const f of ci.changedFiles) {
			console.log(`  - ${f}`);
		}
		if (ci.testCommands.length > 0) {
			console.log(`Tests:`);
			for (const tc of ci.testCommands) {
				console.log(`  > ${tc}`);
			}
		}
		if (ci.buildCommands.length > 0) {
			console.log(`Build:`);
			for (const bc of ci.buildCommands) {
				console.log(`  > ${bc}`);
			}
		}
	}

	console.log();
	if (result.useBroaderValidation) {
		console.log("Validation plan: BROAD (targeted commands not reliable)");
	} else {
		console.log("Validation plan: TARGETED");
	}
	if (result.testCommands.length > 0) {
		console.log("Test commands:");
		for (const tc of result.testCommands) {
			console.log(`  > ${tc}`);
		}
	}
	if (result.buildCommands.length > 0) {
		console.log("Build commands:");
		for (const bc of result.buildCommands) {
			console.log(`  > ${bc}`);
		}
	}
	console.log(result.summary);
	console.log(`${header}\n`);
}

/**
 * Aggregate multiple test impact results into one.
 *
 * Useful when multiple workspaces each produce their own analysis
 * and you need a combined view.
 *
 * @param results - Array of test impact results to merge
 * @returns A single merged result
 */
export function aggregateResults(results: TestImpactResult[]): TestImpactResult {
	if (results.length === 0) {
		return {
			components: [],
			overallConfidence: 1.0,
			testCommands: [],
			buildCommands: [],
			useBroaderValidation: false,
			summary: "No results to aggregate",
		};
	}

	if (results.length === 1) {
		return results[0];
	}

	// Collect all unique changed files
	const allFiles = new Set<string>();
	const componentMap = new Map<string, ComponentImpact>();
	let anyLowConfidence = false;

	for (const result of results) {
		if (result.useBroaderValidation) {
			anyLowConfidence = true;
		}

		for (const ci of result.components) {
			for (const f of ci.changedFiles) {
				allFiles.add(f);
			}

			const existing = componentMap.get(ci.name);
			if (existing) {
				// Merge
				for (const f of ci.changedFiles) {
					if (!existing.changedFiles.includes(f)) {
						existing.changedFiles.push(f);
					}
				}
				for (const tc of ci.testCommands) {
					if (!existing.testCommands.includes(tc)) {
						existing.testCommands.push(tc);
					}
				}
				for (const bc of ci.buildCommands) {
					if (!existing.buildCommands.includes(bc)) {
						existing.buildCommands.push(bc);
					}
				}
				existing.confidence = Math.min(existing.confidence, ci.confidence);
			} else {
				componentMap.set(ci.name, { ...ci, changedFiles: [...ci.changedFiles] });
			}
		}
	}

	const components = [...componentMap.values()];

	// Recalculate overall confidence
	const totalWeight = allFiles.size;
	let weightedConfidence = 0;
	for (const ci of components) {
		weightedConfidence += ci.changedFiles.length * ci.confidence;
	}
	const overallConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 1.0;

	const useBroaderValidation = anyLowConfidence || overallConfidence < CONFIDENCE_THRESHOLD;

	const testCommands: string[] = [];
	const buildCommands: string[] = [];

	if (useBroaderValidation) {
		testCommands.push("npm test");
		buildCommands.push("npm run typecheck");
	} else {
		for (const ci of components) {
			for (const tc of ci.testCommands) {
				if (!testCommands.includes(tc)) {
					testCommands.push(tc);
				}
			}
			for (const bc of ci.buildCommands) {
				if (!buildCommands.includes(bc)) {
					buildCommands.push(bc);
				}
			}
		}
	}

	const summaryLines: string[] = [
		`Aggregated analysis of ${results.length} workspace(s)`,
		`Overall confidence: ${(overallConfidence * 100).toFixed(0)}%`,
		`Total unique changed files: ${allFiles.size}`,
	];

	return {
		components,
		overallConfidence,
		testCommands,
		buildCommands,
		useBroaderValidation,
		summary: summaryLines.join("\n"),
	};
}
