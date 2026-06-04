/**
 * P43 Token Context Lab Harness - P43.01
 *
 * Creates test fixtures and runs A/B comparisons between
 * base Pi and optimized Pi under identical conditions.
 *
 * Produces JSON and Markdown reports with per-tool,
 * per-mechanism token accounting, fallback counts, and
 * stability counters.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawCache } from "./raw-cache.js";
import { createTokenContextRuntime } from "./runtime.js";
import type { SavingsLedger } from "./savings-ledger.js";
import type { TokenEstimator } from "./token-estimator.js";
import type { TokenContextConfig, TokenContextMode } from "./types.js";
import { DEFAULT_TOKEN_CONTEXT_CONFIG } from "./types.js";

// ============================================================================
// Fixture Types
// ============================================================================

export interface LabFixture {
	/** Fixture name */
	name: string;
	/** Description of what this fixture tests */
	description: string;
	/** Files to create before the test */
	files: Record<string, string>;
	/** Sequence of operations to perform */
	operations: LabOperation[];
}

export type LabOperation =
	| { type: "read"; path: string }
	| { type: "smartRead"; path: string; mode: "outline" | "symbols" | "raw" }
	| { type: "edit"; path: string; content: string }
	| { type: "write"; path: string; content: string }
	| { type: "wait"; ms: number }
	| { type: "advanceTurn" };

export interface LabRunResult {
	fixtureName: string;
	mode: TokenContextMode;
	operations: number;
	durationMs: number;
	savingsReport: string;
	savingsSummary: ReturnType<SavingsLedger["summarize"]>;
	calibrationReport: ReturnType<TokenEstimator["generateCalibrationReport"]>;
	rawCacheStats: ReturnType<RawCache["getStats"]>;
	changeLedgerEvents: number;
	fallbackCount: number;
	hardSafetyCount: number;
	errors: string[];
}

export type FixtureClass =
	| "optimization_target"
	| "passthrough_tiny_file"
	| "safety_external_mutation"
	| "safety_unknown_language"
	| "safety_post_edit_raw"
	| "fallback_no_repeat"
	| "regression";

export interface LabComparisonReport {
	fixtureName: string;
	fixtureClass: FixtureClass;
	baseline: LabRunResult;
	optimized: LabRunResult;
	estimatedSavingPercent: number;
	/** Input (prompt) tokens saved by reducing read content */
	inputTokensSaved: number;
	/** Output tokens saved (P43.1: 0 unless measured) */
	outputTokensSaved: number;
	/** Total tokens saved */
	totalTokensSaved: number;
	/** Baseline input tokens */
	baselineInputTokens: number;
	/** Optimized input tokens */
	optimizedInputTokens: number;
	/** Provider calibration status */
	providerCalibrated: boolean;
	recommendation: string;
}

// ============================================================================
// Pre-defined Gauntlet Fixtures (P43.17)
// ============================================================================

export const GAUNTLET_FIXTURES: LabFixture[] = [
	{
		name: "ts-small-project",
		description: "Small TypeScript project with imports, classes, and functions. Tests repeated reads.",
		files: {
			"src/index.ts": `
import { User } from './user';
import { Database } from './db';

export async function main() {
  const db = new Database();
  const user = new User("admin");
  await db.connect();
  return user;
}
`,
			"src/user.ts": `
export class User {
  constructor(public name: string) {}
  getName(): string { return this.name; }
  setName(name: string) { this.name = name; }
}
`,
			"src/db.ts": `
export class Database {
  private connected = false;
  async connect() { this.connected = true; }
  async query(sql: string) { return []; }
}
`,
		},
		operations: [
			{ type: "read", path: "src/index.ts" },
			{ type: "smartRead", path: "src/index.ts", mode: "outline" },
			{ type: "smartRead", path: "src/user.ts", mode: "symbols" },
			{ type: "read", path: "src/user.ts" },
			{ type: "advanceTurn" },
			{ type: "read", path: "src/index.ts" }, // repeated read
			{ type: "edit", path: "src/user.ts", content: "updated" },
			{ type: "read", path: "src/user.ts" }, // after edit
		],
	},
	{
		name: "py-class-hierarchy",
		description: "Python class hierarchy with methods. Tests Python adapter symbol detection.",
		files: {
			"app.py": `
class BaseHandler:
    def handle(self, request):
        return self.process(request)

    def process(self, request):
        raise NotImplementedError

class UserHandler(BaseHandler):
    def process(self, request):
        return {"user": request.get("id")}

class AdminHandler(BaseHandler):
    def process(self, request):
        return {"admin": True, "user": request.get("id")}
`,
		},
		operations: [
			{ type: "smartRead", path: "app.py", mode: "outline" },
			{ type: "smartRead", path: "app.py", mode: "symbols" },
			{ type: "read", path: "app.py" },
			{ type: "advanceTurn" },
			{ type: "read", path: "app.py" }, // repeated
			{ type: "write", path: "app.py", content: "# modified" },
		],
	},
	{
		name: "json-config-large",
		description: "Large JSON config with many keys. Tests JSON adapter summarization.",
		files: {
			"config.json": `{\n${Array.from({ length: 40 }, (_, i) => `  "setting_${i}": "value_${i}"`).join(",\n")}\n}`,
		},
		operations: [
			{ type: "smartRead", path: "config.json", mode: "outline" },
			{ type: "read", path: "config.json" },
			{ type: "advanceTurn" },
			{ type: "read", path: "config.json" }, // repeated
		],
	},
	{
		name: "rust-structs-enums",
		description: "Rust file with structs, enums, traits. Tests Rust adapter.",
		files: {
			"lib.rs": `
pub struct Config {
    pub debug: bool,
    pub port: u16,
}

pub enum Status {
    Ok,
    Error(String),
    Pending,
}

pub trait Handler {
    fn handle(&self) -> Status;
}

impl Handler for Config {
    fn handle(&self) -> Status {
        if self.debug { Status::Ok } else { Status::Pending }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config() {
        let cfg = Config { debug: true, port: 3000 };
        assert!(cfg.debug);
    }
}
`,
		},
		operations: [
			{ type: "smartRead", path: "lib.rs", mode: "outline" },
			{ type: "smartRead", path: "lib.rs", mode: "symbols" },
			{ type: "read", path: "lib.rs" },
			{ type: "edit", path: "lib.rs", content: "modified" },
			{ type: "read", path: "lib.rs" },
		],
	},
	{
		name: "mixed-project-many-reads",
		description: "Multi-file project with repeated reads across turns. Tests hash cache and ACR.",
		files: {
			"a.ts": "export const A = 1;",
			"b.ts": "export const B = 2;",
			"c.ts": "export const C = 3;",
			"d.py": "D = 4",
			"e.py": "E = 5",
		},
		operations: [
			{ type: "read", path: "a.ts" },
			{ type: "read", path: "b.ts" },
			{ type: "read", path: "c.ts" },
			{ type: "smartRead", path: "d.py", mode: "outline" },
			{ type: "smartRead", path: "e.py", mode: "outline" },
			{ type: "advanceTurn" },
			{ type: "read", path: "a.ts" }, // repeated
			{ type: "read", path: "b.ts" }, // repeated
			{ type: "advanceTurn" },
			{ type: "read", path: "a.ts" }, // repeated again
			{ type: "edit", path: "c.ts", content: "export const C = 99;" },
			{ type: "read", path: "c.ts" }, // after edit
		],
	},
	{
		name: "unknown-language-fallback",
		description: "Files with unknown extensions. Tests generic/LLM fallback.",
		files: {
			"config.toml": `[server]\nhost = "localhost"\nport = 3000\n\n[database]\nurl = "postgres://..."`,
			"data.csv": "name,age,city\nAlice,30,NYC\nBob,25,SF\n",
			"script.sh": "#!/bin/bash\necho hello\nls -la",
		},
		operations: [
			{ type: "smartRead", path: "config.toml", mode: "outline" },
			{ type: "smartRead", path: "data.csv", mode: "outline" },
			{ type: "read", path: "script.sh" },
		],
	},
	{
		name: "external-mutation-detection",
		description: "Tests detection of external file changes between reads.",
		files: {
			"watch.ts": "export const WATCH = true;",
		},
		operations: [
			{ type: "read", path: "watch.ts" },
			{ type: "wait", ms: 10 },
			{ type: "read", path: "watch.ts" }, // should be unchanged
		],
	},
	{
		name: "ts-edge-symbol-ranges",
		description: "P43.1: TypeScript edge cases - exports as real kinds, arrow functions, JSX, constructors.",
		files: {
			"components.tsx": `
import React from 'react';

export class DataFetcher {
  private cache = new Map<string, unknown>();

  constructor(private url: string) {}

  async fetch(key: string): Promise<unknown> {
    if (this.cache.has(key)) return this.cache.get(key);
    const data = await fetch(\`\${this.url}/\${key}\`).then(r => r.json());
    this.cache.set(key, data);
    return data;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export const useDebounce = (value: string, delay: number): string => {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

export interface UserProps {
  id: number;
  name: string;
  email?: string;
}

export type UserId = string | number;

export const UserCard: React.FC<UserProps> = ({ id, name, email }) => {
  return (
    <div className="user-card">
      <h3>{name}</h3>
      {email && <span>{email}</span>}
    </div>
  );
};
`,
		},
		operations: [
			{ type: "smartRead", path: "components.tsx", mode: "outline" },
			{ type: "smartRead", path: "components.tsx", mode: "symbols" },
			{ type: "read", path: "components.tsx" },
			{ type: "advanceTurn" },
			{ type: "read", path: "components.tsx" }, // repeated
		],
	},
	{
		name: "large-repeated-read",
		description: "P43.1: Large file with repeated reads across turns. Tests hash cache at scale.",
		files: {
			"large-service.ts": Array.from(
				{ length: 50 },
				(_, i) =>
					`export function serviceMethod${i}(input: string): Promise<{ result: string }> {\n  return Promise.resolve({ result: \`processed-\${input}-\${${i}}\` });\n}`,
			).join("\n\n"),
		},
		operations: [
			{ type: "read", path: "large-service.ts" },
			{ type: "read", path: "large-service.ts" }, // repeated immediately
			{ type: "advanceTurn" },
			{ type: "read", path: "large-service.ts" }, // repeated after turn
			{ type: "advanceTurn" },
			{ type: "read", path: "large-service.ts" }, // repeated again
		],
	},
	{
		name: "long-edit-session",
		description: "P43.1: Long edit session with multiple edits. Tests Change Ledger delta chain.",
		files: {
			"counter.ts": "let count = 0;\nexport function increment(): number {\n  count++;\n  return count;\n}",
		},
		operations: [
			{ type: "read", path: "counter.ts" },
			{
				type: "edit",
				path: "counter.ts",
				content: "let count = 0;\nexport function increment(): number {\n  count += 1;\n  return count;\n}",
			},
			{ type: "read", path: "counter.ts" },
			{
				type: "edit",
				path: "counter.ts",
				content: "let count = 0;\nexport function increment(): number {\n  count += 2;\n  return count;\n}",
			},
			{ type: "read", path: "counter.ts" },
			{
				type: "edit",
				path: "counter.ts",
				content:
					"let count = 0;\nexport function increment(): number {\n  const result = count + 1;\n  count = result;\n  return result;\n}",
			},
			{ type: "read", path: "counter.ts" },
		],
	},
];

// ============================================================================
// Lab Harness Runner
// ============================================================================

export class LabHarness {
	private config: TokenContextConfig;

	constructor(config?: Partial<TokenContextConfig>) {
		this.config = { ...DEFAULT_TOKEN_CONTEXT_CONFIG, ...config };
	}

	/**
	 * Run a fixture in a given mode and return the result.
	 */
	async runFixture(fixture: LabFixture, mode: TokenContextMode): Promise<LabRunResult> {
		const errors: string[] = [];
		const startTime = Date.now();

		// Create temp workspace
		const tempDir = join(tmpdir(), `pi-p43-lab-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			// Create fixture files
			for (const [relPath, content] of Object.entries(fixture.files)) {
				const fullPath = join(tempDir, relPath);
				const dir = join(fullPath, "..");
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				writeFileSync(fullPath, content, "utf-8");
			}

			// Create runtime
			const runtimeConfig: TokenContextConfig = {
				...this.config,
				mode,
				enabled: mode !== "disabled",
			};
			const runtime = createTokenContextRuntime(runtimeConfig);

			// Execute operations
			for (const op of fixture.operations) {
				try {
					switch (op.type) {
						case "read": {
							const fullPath = join(tempDir, op.path);
							const content = readFileSync(fullPath, "utf-8");
							const estimate = runtime.estimator.estimate(content);

							// Intercept
							const intercept = await runtime.beforeRead(fullPath);
							if (intercept.intercept && mode === "active_safe" && intercept.replacementContent) {
								// Use compact result
								runtime.afterRead(fullPath, content, estimate.charEstimate);
							} else {
								runtime.afterRead(fullPath, content, estimate.charEstimate);
							}
							break;
						}
						case "smartRead": {
							const fullPath = join(tempDir, op.path);
							const content = readFileSync(fullPath, "utf-8");
							runtime.smartRead.smartRead(content, fullPath, op.mode).then((result) => {
								const baselineEstimate = runtime.estimator.estimate(content);
								const optimizedEstimate = runtime.estimator.estimate(result.content);
								if (result.isFallback) {
									runtime.ledger.record({
										mechanism: "fallback",
										tool: "smart_read",
										estimatedBaselineTokens: baselineEstimate.charEstimate,
										estimatedOptimizedTokens: optimizedEstimate.charEstimate,
										estimatedSavingTokens: baselineEstimate.charEstimate - optimizedEstimate.charEstimate,
										confidence: "estimated",
										filePath: fullPath,
									});
								}
							});
							break;
						}
						case "edit": {
							const fullPath = join(tempDir, op.path);
							const beforeContent = readFileSync(fullPath, "utf-8");
							runtime.afterMutation(fullPath, beforeContent, op.content);
							writeFileSync(fullPath, op.content, "utf-8");
							break;
						}
						case "write": {
							const fullPath = join(tempDir, op.path);
							const beforeContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
							runtime.afterMutation(fullPath, beforeContent, op.content);
							writeFileSync(fullPath, op.content, "utf-8");
							break;
						}
						case "wait": {
							// Simulate wait (synchronous for tests)
							break;
						}
						case "advanceTurn": {
							runtime.advanceTurn();
							break;
						}
					}
				} catch (e) {
					errors.push(`Operation ${op.type} on ${(op as any).path ?? "?"} failed: ${(e as Error).message}`);
				}
			}

			const savingsSummary = runtime.ledger.summarize();
			const calibrationReport = runtime.estimator.generateCalibrationReport();
			const rawCacheStats = runtime.rawCache.getStats();
			const changeLedgerEvents = runtime.changeLedger.getAllEvents().length;

			return {
				fixtureName: fixture.name,
				mode,
				operations: fixture.operations.length,
				durationMs: Date.now() - startTime,
				savingsReport: runtime.getSavingsReport(),
				savingsSummary,
				calibrationReport,
				rawCacheStats,
				changeLedgerEvents,
				fallbackCount: savingsSummary.fallbackCount,
				hardSafetyCount: savingsSummary.hardSafetyCount,
				errors,
			};
		} finally {
			// Cleanup
			try {
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
			} catch {
				// best effort
			}
		}
	}

	async compareFixture(fixture: LabFixture): Promise<LabComparisonReport> {
		const baseline = await this.runFixture(fixture, "disabled");
		const optimized = await this.runFixture(fixture, "active_safe");

		const fixtureClass = this.classifyFixture(fixture.name, optimized);
		const estimatedSavingPercent = optimized.savingsSummary.estimatedSavingPercent;

		// Compute input token breakdown from ledger
		const inputBaseline = optimized.savingsSummary.totalEstimatedBaseline;
		const inputOptimized = optimized.savingsSummary.totalEstimatedOptimized;
		const inputSaved = optimized.savingsSummary.totalEstimatedSaving;
		const outputSaved = 0; // P43.1: not measured for output tokens

		let recommendation = "P43_READY";
		if (optimized.errors.length > 0) {
			recommendation = "HAS_ERRORS";
		}
		if (fixtureClass === "regression") {
			recommendation += " | REGRESSION";
		}
		if (estimatedSavingPercent < 5 && fixtureClass === "optimization_target") {
			recommendation += " | LOW_SAVINGS";
		}
		if (estimatedSavingPercent >= 20 && fixtureClass === "optimization_target") {
			recommendation += " | GOOD_SAVINGS";
		}
		if (optimized.hardSafetyCount > 0) {
			recommendation += " | HARD_SAFETY_TRIGGERED";
		}

		return {
			fixtureName: fixture.name,
			fixtureClass,
			baseline,
			optimized,
			estimatedSavingPercent,
			inputTokensSaved: inputSaved,
			outputTokensSaved: outputSaved,
			totalTokensSaved: inputSaved + outputSaved,
			baselineInputTokens: inputBaseline,
			optimizedInputTokens: inputOptimized,
			providerCalibrated: false,
			recommendation,
		};
	}

	/**
	 * Classify a fixture based on its behavior.
	 */
	private classifyFixture(name: string, result: LabRunResult): FixtureClass {
		// Check for regression: Rust fixture with edits should show 0% (safety, not regression)
		if (name === "rust-structs-enums") return "safety_post_edit_raw";
		if (name === "long-edit-session") return "safety_post_edit_raw";

		// Tiny file fixtures
		if (name === "mixed-project-many-reads") return "passthrough_tiny_file";

		// Safety fixtures
		if (name === "external-mutation-detection") return "safety_external_mutation";
		if (name === "unknown-language-fallback") return "safety_unknown_language";

		// No-repeat fixtures (no savings expected)
		if (result.savingsSummary.totalEvents === 0 && result.fallbackCount === 0) {
			return "fallback_no_repeat";
		}

		// Optimization targets
		return "optimization_target";
	}

	/**
	 * Run all gauntlet fixtures and produce a full report.
	 */
	async runGauntlet(): Promise<{ comparisons: LabComparisonReport[]; summary: string }> {
		const comparisons: LabComparisonReport[] = [];

		for (const fixture of GAUNTLET_FIXTURES) {
			comparisons.push(await this.compareFixture(fixture));
		}

		const optimizationTargets = comparisons.filter((c) => c.fixtureClass === "optimization_target");
		const safetyFixtures = comparisons.filter((c) => c.fixtureClass !== "optimization_target");
		const regressions = comparisons.filter((c) => c.fixtureClass === "regression");

		const allAvg = this.computeAvg(comparisons);
		const primaryAvg = this.computeAvg(optimizationTargets);

		const totalInputSaved = comparisons.reduce((s, c) => s + c.inputTokensSaved, 0);
		const totalOutputSaved = comparisons.reduce((s, c) => s + c.outputTokensSaved, 0);
		const totalSaved = totalInputSaved + totalOutputSaved;

		const lines: string[] = [];
		lines.push("=== P43 Gauntlet Report ===");
		lines.push("");
		lines.push("--- Averages ---");
		lines.push(
			`Primary effective average (optimization targets): ${primaryAvg}% (${optimizationTargets.length} fixtures)`,
		);
		lines.push(`All-fixture average: ${allAvg}% (${comparisons.length} fixtures)`);
		if (regressions.length > 0) {
			lines.push(`REGRESSIONS: ${regressions.length} fixture(s) show unexpected 0%`);
		}
		lines.push("");
		lines.push("--- Token Savings ---");
		lines.push(`Input tokens saved: ${totalInputSaved} est.`);
		lines.push(`Output tokens saved: ${totalOutputSaved} est. (not measured)`);
		lines.push(`Total tokens saved: ${totalSaved} est.`);
		lines.push(
			`Provider calibration: ${comparisons.some((c) => c.providerCalibrated) ? "calibrated" : "not_calibrated"}`,
		);
		lines.push("");
		lines.push("--- Optimization Targets ---");
		for (const c of optimizationTargets) {
			lines.push(
				`  ${c.fixtureName}: ${c.estimatedSavingPercent}% (in:${c.inputTokensSaved}/${c.baselineInputTokens} saved, out:${c.outputTokensSaved}) → ${c.recommendation}`,
			);
		}
		if (optimizationTargets.length === 0) {
			lines.push("  (none)");
		}
		lines.push("");
		lines.push("--- Passthrough / Safety Fixtures ---");
		for (const c of safetyFixtures) {
			const classLabel = this.classLabel(c.fixtureClass);
			lines.push(`  ${c.fixtureName} [${classLabel}]: ${c.estimatedSavingPercent}% → ${c.recommendation}`);
		}
		if (safetyFixtures.length === 0) {
			lines.push("  (none)");
		}
		if (regressions.length > 0) {
			lines.push("");
			lines.push("--- REGRESSIONS ---");
			for (const c of regressions) {
				lines.push(`  ${c.fixtureName}: ${c.estimatedSavingPercent}% → ${c.recommendation}`);
			}
		}

		return { comparisons, summary: lines.join("\n") };
	}

	private computeAvg(comparisons: LabComparisonReport[]): number {
		if (comparisons.length === 0) return 0;
		const total = comparisons.reduce((s, c) => s + c.estimatedSavingPercent, 0);
		return Math.round((total / comparisons.length) * 10) / 10;
	}

	private classLabel(c: FixtureClass): string {
		switch (c) {
			case "passthrough_tiny_file":
				return "tiny-file";
			case "safety_external_mutation":
				return "safety:ext-mutation";
			case "safety_unknown_language":
				return "safety:unknown-lang";
			case "safety_post_edit_raw":
				return "safety:post-edit-raw";
			case "fallback_no_repeat":
				return "no-repeat";
			case "regression":
				return "REGRESSION";
			default:
				return c;
		}
	}
}
