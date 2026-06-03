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

export interface LabComparisonReport {
	fixtureName: string;
	baseline: LabRunResult;
	optimized: LabRunResult;
	estimatedSavingPercent: number;
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
	runFixture(fixture: LabFixture, mode: TokenContextMode): LabRunResult {
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
							const intercept = runtime.beforeRead(fullPath);
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

	/**
	 * Compare fixture - compares total token cost between disabled and optimized modes.
	 */
	compareFixture(fixture: LabFixture): LabComparisonReport {
		const baseline = this.runFixture(fixture, "disabled");
		const optimized = this.runFixture(fixture, "active_safe");

		// For savings calculation, compute from the savings ledger summaries
		// The ledger captures per-read saving in active_safe mode.
		// Also compute a direct token comparison for read operations.
		const baselineTokens = this.computeTotalReadTokens(fixture, "disabled");
		const optimizedTokens = this.computeTotalReadTokens(fixture, "active_safe");

		const estimatedSavingPercent =
			baselineTokens > 0
				? Math.round(((baselineTokens - optimizedTokens) / baselineTokens) * 1000) / 10
				: optimized.savingsSummary.estimatedSavingPercent;

		let recommendation = "P43_READY";
		if (optimized.errors.length > 0) {
			recommendation = "HAS_ERRORS";
		}
		if (estimatedSavingPercent < 5) {
			recommendation += " | LOW_SAVINGS";
		}
		if (estimatedSavingPercent >= 20) {
			recommendation += " | GOOD_SAVINGS";
		}
		if (optimized.hardSafetyCount > 0) {
			recommendation += " | HARD_SAFETY_TRIGGERED";
		}

		return {
			fixtureName: fixture.name,
			baseline,
			optimized,
			estimatedSavingPercent,
			recommendation,
		};
	}

	/**
	 * Compute total token cost for all read operations in a fixture under a given mode.
	 * This runs the fixture in a temp dir and measures actual token estimates.
	 */
	private computeTotalReadTokens(fixture: LabFixture, mode: TokenContextMode): number {
		const tempDir = join(tmpdir(), `pi-p43-tokens-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });

		try {
			// Create fixture files
			for (const [relPath, content] of Object.entries(fixture.files)) {
				const fullPath = join(tempDir, relPath);
				const dir = join(fullPath, "..");
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
				writeFileSync(fullPath, content, "utf-8");
			}

			const runtimeConfig: TokenContextConfig = {
				...this.config,
				mode,
				enabled: mode !== "disabled",
			};
			const runtime = createTokenContextRuntime(runtimeConfig);
			let totalTokens = 0;

			for (const op of fixture.operations) {
				if (op.type === "read" || op.type === "smartRead") {
					const fullPath = join(tempDir, op.path);
					if (!existsSync(fullPath)) continue;
					const content = readFileSync(fullPath, "utf-8");
					const estimate = runtime.estimator.estimate(content);

					if (mode === "active_safe") {
						const intercept = runtime.beforeRead(fullPath);
						if (intercept.intercept && intercept.replacementContent) {
							// Compact read: only count the compact content
							const compactEstimate = runtime.estimator.estimate(intercept.replacementContent);
							totalTokens += compactEstimate.charEstimate;
							runtime.afterRead(fullPath, content, estimate.charEstimate);
						} else {
							totalTokens += estimate.charEstimate;
							runtime.afterRead(fullPath, content, estimate.charEstimate);
						}
					} else {
						// Disabled: count full tokens
						totalTokens += estimate.charEstimate;
					}
				} else if (op.type === "advanceTurn") {
					runtime.advanceTurn();
				} else if (op.type === "edit" || op.type === "write") {
					const fullPath = join(tempDir, op.path);
					const beforeContent = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : "";
					const afterContent = op.content;
					runtime.afterMutation(fullPath, beforeContent, afterContent);
					writeFileSync(fullPath, afterContent, "utf-8");
				}
			}

			return totalTokens;
		} finally {
			try {
				if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
			} catch {
				/* best effort */
			}
		}
	}

	/**
	 * Run all gauntlet fixtures and produce a full report.
	 */
	runGauntlet(): { comparisons: LabComparisonReport[]; summary: string } {
		const comparisons: LabComparisonReport[] = [];
		let totalSaving = 0;
		let totalFixtures = 0;

		for (const fixture of GAUNTLET_FIXTURES) {
			const comparison = this.compareFixture(fixture);
			comparisons.push(comparison);
			totalSaving += comparison.estimatedSavingPercent;
			totalFixtures++;
		}

		const avgSaving = totalFixtures > 0 ? Math.round((totalSaving / totalFixtures) * 10) / 10 : 0;

		const summary =
			`=== P43 Gauntlet Report ===\n\n` +
			`Fixtures run: ${totalFixtures}\n` +
			`Average estimated saving: ${avgSaving}%\n\n` +
			comparisons
				.map(
					(c) =>
						`${c.fixtureName}: ${c.estimatedSavingPercent}% saving, ${c.optimized.fallbackCount} fallbacks, ${c.optimized.errors.length} errors → ${c.recommendation}`,
				)
				.join("\n");

		return { comparisons, summary };
	}
}
