/**
 * Report Writer — P38.1
 *
 * Generates human and machine-readable reports from gauntlet execution results.
 * Writes summary.md, scenario-results.json, failed-scenarios.json,
 * replay-commands.md, invariants.md, and monte-carlo-summary.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { aggregateInvariantResults, InvariantResult } from "./invariant-checker.js";
import type { ParallelismSummary } from "./parallelism-monitor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioResult {
	planId: string;
	name: string;
	executionMode: string;
	passed: boolean;
	durationMs: number;
	invariantResults: InvariantResult[];
	invariantSummary: ReturnType<typeof aggregateInvariantResults>;
	parallelismSummary: ParallelismSummary | null;
	workspaceStates: Array<{
		workspaceId: string;
		stage: string;
		attempts: number;
		errorMessage?: string;
	}>;
	leadDirectivesCreated: number;
	leadEscalationsCreated: number;
	errors: string[];
}

export interface GauntletReport {
	runId: string;
	timestamp: string;
	mode: string;
	seed: number;
	iterations: number;
	executionModesTested: string[];
	suites: string[];
	totalDurationMs: number;
	scenarios: ScenarioResult[];
	overallPassed: boolean;
}

// ---------------------------------------------------------------------------
// Report Writer
// ---------------------------------------------------------------------------

export class ReportWriter {
	private reportDir: string;
	private runId: string;

	constructor(reportDir: string, runId: string) {
		this.reportDir = reportDir;
		this.runId = runId;
	}

	async ensureDir(): Promise<void> {
		await fs.mkdir(this.reportDir, { recursive: true });
		await fs.mkdir(path.join(this.reportDir, "replays"), { recursive: true });
	}

	/**
	 * Write the full report suite.
	 */
	async writeReport(report: GauntletReport): Promise<void> {
		await this.ensureDir();
		await this.writeSummary(report);
		await this.writeScenarioResults(report);
		await this.writeFailedScenarios(report);
		await this.writeReplayCommands(report);
		await this.writeInvariants(report);
		await this.writeMonteCarloSummary(report);
		await this.writeParallelismSamples(report);
	}

	/**
	 * Write summary.md
	 */
	private async writeSummary(report: GauntletReport): Promise<void> {
		const lines: string[] = [];
		const passed = report.scenarios.filter((s) => s.passed).length;
		const failed = report.scenarios.filter((s) => !s.passed).length;

		lines.push("# Execution Stability Gauntlet — Summary");
		lines.push("");
		lines.push(`**Run ID:** ${report.runId}`);
		lines.push(`**Timestamp:** ${report.timestamp}`);
		lines.push(`**Mode:** ${report.mode}`);
		lines.push(`**Seed:** ${report.seed}`);
		lines.push(`**Iterations:** ${report.iterations}`);
		lines.push(`**Total Duration:** ${(report.totalDurationMs / 1000).toFixed(1)}s`);
		lines.push(`**Overall Verdict:** ${report.overallPassed ? "PASS" : "FAIL"}`);
		lines.push("");
		lines.push("---");
		lines.push("");
		lines.push("## Execution Modes Tested");
		lines.push("");
		for (const mode of report.executionModesTested) {
			lines.push(`- ${mode}`);
		}
		lines.push("");
		lines.push("## Scenario Results");
		lines.push("");
		lines.push(`| Plan ID | Name | Mode | Duration | Verdict |`);
		lines.push(`| ------- | ---- | ---- | -------- | ------- |`);
		for (const s of report.scenarios) {
			const verdict = s.passed ? "PASS" : "FAIL";
			lines.push(
				`| ${s.planId} | ${s.name} | ${s.executionMode} | ${(s.durationMs / 1000).toFixed(1)}s | **${verdict}** |`,
			);
		}
		lines.push("");
		lines.push(`**Summary:** ${passed} passed, ${failed} failed, ${report.scenarios.length} total`);
		lines.push("");

		// Top invariant failures
		const allInvariants = report.scenarios.flatMap((s) => s.invariantResults);
		const failures = allInvariants.filter((i) => !i.passed && i.severity !== "warning");

		if (failures.length > 0) {
			lines.push("## Top Invariant Failures");
			lines.push("");
			for (const f of failures) {
				lines.push(`- **${f.name}** (${f.category}): ${f.message}`);
			}
			lines.push("");
		}

		// Parallelism summary
		lines.push("## Parallelism Summary");
		lines.push("");
		for (const s of report.scenarios) {
			if (s.parallelismSummary) {
				const ps = s.parallelismSummary;
				lines.push(`### ${s.planId} — ${s.name}`);
				lines.push("");
				lines.push(`- Requested max: ${ps.requestedMaxParallelism}`);
				lines.push(`- Max observed active: ${ps.maxObservedActiveWorkers}`);
				lines.push(`- Average active: ${ps.averageActiveWorkers.toFixed(1)}`);
				if (ps.parallelismRegression) {
					lines.push(`- **Regression detected:** ${ps.serializationReason}`);
				}
				lines.push("");
			}
		}

		// Lead Agent summary
		lines.push("## Lead Agent Summary");
		lines.push("");
		for (const s of report.scenarios) {
			if (s.leadDirectivesCreated > 0 || s.leadEscalationsCreated > 0) {
				lines.push(
					`- **${s.planId}:** ${s.leadDirectivesCreated} directives, ${s.leadEscalationsCreated} escalations`,
				);
			}
		}
		lines.push("");

		// Replay instructions
		lines.push("## Replay Instructions");
		lines.push("");
		lines.push("To replay a failed scenario:");
		lines.push("");
		lines.push("```bash");
		lines.push(
			`npx tsx scripts/run-execution-stability-gauntlet.ts --replay reports/execution-stability-gauntlet/${report.runId}/replays/failed-scenario-<n>.json`,
		);
		lines.push("```");
		lines.push("");

		await fs.writeFile(path.join(this.reportDir, "summary.md"), lines.join("\n"), "utf-8");
	}

	/**
	 * Write scenario-results.json
	 */
	private async writeScenarioResults(report: GauntletReport): Promise<void> {
		await fs.writeFile(
			path.join(this.reportDir, "scenario-results.json"),
			JSON.stringify(report.scenarios, null, 2),
			"utf-8",
		);
	}

	/**
	 * Write failed-scenarios.json
	 */
	private async writeFailedScenarios(report: GauntletReport): Promise<void> {
		const failed = report.scenarios.filter((s) => !s.passed);
		await fs.writeFile(path.join(this.reportDir, "failed-scenarios.json"), JSON.stringify(failed, null, 2), "utf-8");
	}

	/**
	 * Write replay-commands.md
	 */
	private async writeReplayCommands(report: GauntletReport): Promise<void> {
		const lines: string[] = [];
		lines.push("# Replay Commands");
		lines.push("");

		const failed = report.scenarios.filter((s) => !s.passed);
		if (failed.length === 0) {
			lines.push("No failed scenarios to replay.");
		} else {
			for (let i = 0; i < failed.length; i++) {
				const s = failed[i];
				lines.push(`## ${s.planId} — ${s.name}`);
				lines.push("");
				lines.push("```bash");
				lines.push(`npx tsx scripts/run-execution-stability-gauntlet.ts \\`);
				lines.push(
					`  --replay reports/execution-stability-gauntlet/${report.runId}/replays/failed-scenario-${i + 1}.json`,
				);
				lines.push("```");
				lines.push("");
			}
		}

		await fs.writeFile(path.join(this.reportDir, "replay-commands.md"), lines.join("\n"), "utf-8");
	}

	/**
	 * Write invariants.md
	 */
	private async writeInvariants(report: GauntletReport): Promise<void> {
		const lines: string[] = [];
		lines.push("# Invariant Check Results");
		lines.push("");

		for (const s of report.scenarios) {
			lines.push(`## ${s.planId} — ${s.name}`);
			lines.push("");
			const summary = s.invariantSummary;
			lines.push(`- Passed: ${summary.passed}`);
			lines.push(`- Failed: ${summary.failed}`);
			lines.push(`- Warnings: ${summary.warnings}`);
			lines.push("");

			lines.push("| Invariant | Category | Passed | Message |");
			lines.push("| --------- | -------- | ------ | ------- |");
			for (const inv of s.invariantResults) {
				const status = inv.passed ? "PASS" : inv.severity === "warning" ? "WARN" : "FAIL";
				lines.push(`| ${inv.name} | ${inv.category} | **${status}** | ${inv.message.replace(/\|/g, "\\|")} |`);
			}
			lines.push("");
		}

		await fs.writeFile(path.join(this.reportDir, "invariants.md"), lines.join("\n"), "utf-8");
	}

	/**
	 * Write monte-carlo-summary.md
	 */
	private async writeMonteCarloSummary(report: GauntletReport): Promise<void> {
		const lines: string[] = [];
		lines.push("# Monte Carlo Summary");
		lines.push("");
		lines.push(`**Seed:** ${report.seed}`);
		lines.push(`**Iterations:** ${report.iterations}`);
		lines.push(`**Total Duration:** ${(report.totalDurationMs / 1000).toFixed(1)}s`);
		lines.push("");

		const passed = report.scenarios.filter((s) => s.passed).length;
		const failed = report.scenarios.filter((s) => !s.passed).length;

		lines.push("| Plan ID | Name | Passed | Duration |");
		lines.push("| ------- | ---- | ------ | -------- |");
		for (const s of report.scenarios) {
			lines.push(
				`| ${s.planId} | ${s.name} | ${s.passed ? "PASS" : "FAIL"} | ${(s.durationMs / 1000).toFixed(1)}s |`,
			);
		}
		lines.push("");
		lines.push(`**Total:** ${passed} passed, ${failed} failed`);
		lines.push("");

		await fs.writeFile(path.join(this.reportDir, "monte-carlo-summary.md"), lines.join("\n"), "utf-8");
	}

	/**
	 * Write parallelism-samples.ndjson
	 */
	private async writeParallelismSamples(report: GauntletReport): Promise<void> {
		const samplesPath = path.join(this.reportDir, "parallelism-samples.ndjson");
		const fd = await fs.open(samplesPath, "w");

		for (const s of report.scenarios) {
			if (s.parallelismSummary && s.parallelismSummary.samples.length > 0) {
				for (const sample of s.parallelismSummary.samples) {
					await fd.appendFile(
						`${JSON.stringify({
							planId: s.planId,
							...sample,
						})}\n`,
					);
				}
			}
		}

		await fd.close();
	}

	/**
	 * Get the replay file path for a failed scenario.
	 */
	replayPath(scenarioIndex: number): string {
		return path.join(this.reportDir, "replays", `failed-scenario-${scenarioIndex}.json`);
	}

	/**
	 * Write a replay file for a single failed scenario.
	 */
	async writeReplayFile(scenarioIndex: number, data: Record<string, unknown>): Promise<string> {
		await this.ensureDir();
		const filePath = this.replayPath(scenarioIndex);
		await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
		return filePath;
	}

	/**
	 * Write tui-snapshot.txt
	 */
	async writeTuiSnapshot(content: string): Promise<void> {
		await this.ensureDir();
		await fs.writeFile(path.join(this.reportDir, "tui-snapshot.txt"), content, "utf-8");
	}
}
