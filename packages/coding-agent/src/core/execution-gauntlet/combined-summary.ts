/**
 * Combined JSON Summary — P38.1.HOTFIX
 *
 * Unified machine-readable JSON report format for every `make test` run.
 * Combines deterministic tests, synthetic gauntlet, smoke-real Python results,
 * stable_3 results, patch_transaction results, parallelism, invariants, etc.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ScenarioResult } from "./report-writer.js";

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export interface CombinedStageResult {
	id: string;
	verdict: "PASS" | "FAIL" | "SKIPPED";
	durationMs: number;
	testsRun?: number;
	failures: string[];
	executionModes?: string[];
	scenarioCount?: number;
	plans?: CombinedPlanResult[];
}

export interface CombinedPlanResult {
	id: string;
	verdict: "PASS" | "FAIL";
	workspaces: CombinedWorkspaceResult[];
}

export interface CombinedWorkspaceResult {
	workspaceId: string;
	stage: string;
	attempts: number;
	errorMessage?: string;
}

export interface CombinedExecutionModeResult {
	tested: boolean;
	verdict: "PASS" | "FAIL" | "PARTIAL";
	maxObservedActiveWorkers: number;
	averageActiveWorkers: number;
	parallelismRegression: boolean;
	plans: Array<{ id: string; verdict: string }>;
	patchTransactionFidelity?: "simulated" | "adapter" | "real";
	patchApplyLanesObserved?: number;
	directWorkerMutations?: number;
	dirtyRepoLeaks?: number;
}

export interface PythonWebAppSummary {
	tested: boolean;
	repoPath: string;
	plans: CombinedPlanResult[];
	validation: {
		command: string;
		exitCode: number;
		passed: boolean;
		outputArtifact: string;
	};
}

export interface CombinedSummary {
	runId: string;
	timestamp: string;
	mode: string;
	seed: number;
	durationMs: number;
	overallVerdict: "PASS" | "FAIL" | "PARTIAL";
	commands: Record<string, string>;
	stages: CombinedStageResult[];
	executionModes: Record<string, CombinedExecutionModeResult>;
	pythonWebApp: PythonWebAppSummary | null;
	invariants: {
		passed: number;
		failed: number;
		failures: Array<{ name: string; category: string; message: string }>;
	};
	leadAgent: {
		directivesCreated: number;
		escalationsCreated: number;
		classifications: string[];
	};
	completionGate: {
		blocks: Array<{ workspaceId: string; reasons: string[] }>;
		commandHistoryRecorded: boolean;
		noTestsFoundFailures: number;
	};
	stopContinue: {
		staleCompletionsIgnored: number;
		illegalTransitionsAttempted: number;
	};
	parallelism: {
		samplesPath: string;
		maxObservedActiveWorkers: number;
		timelineSummary: Array<{ timestampMs: number; active: number }>;
	};
	artifacts: Record<string, string>;
	replay: {
		available: boolean;
		commands: string[];
	};
	limitations: string[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class CombinedSummaryBuilder {
	private summary: Partial<CombinedSummary> = {
		stages: [],
		executionModes: {},
		pythonWebApp: null,
		invariants: { passed: 0, failed: 0, failures: [] },
		leadAgent: { directivesCreated: 0, escalationsCreated: 0, classifications: [] },
		completionGate: { blocks: [], commandHistoryRecorded: false, noTestsFoundFailures: 0 },
		stopContinue: { staleCompletionsIgnored: 0, illegalTransitionsAttempted: 0 },
		parallelism: { samplesPath: "", maxObservedActiveWorkers: 0, timelineSummary: [] },
		artifacts: {},
		replay: { available: false, commands: [] },
		limitations: [],
	};
	private reportDir: string;

	constructor(reportDir: string) {
		this.reportDir = reportDir;
	}

	setMeta(opts: { runId: string; timestamp: string; mode: string; seed: number }): this {
		this.summary.runId = opts.runId;
		this.summary.timestamp = opts.timestamp;
		this.summary.mode = opts.mode;
		this.summary.seed = opts.seed;
		return this;
	}

	addStage(stage: CombinedStageResult): this {
		this.summary.stages!.push(stage);
		return this;
	}

	setExecutionMode(mode: string, data: CombinedExecutionModeResult): this {
		this.summary.executionModes![mode] = data;
		return this;
	}

	setPythonWebApp(data: PythonWebAppSummary): this {
		this.summary.pythonWebApp = data;
		return this;
	}

	addInvariantFailures(failures: CombinedSummary["invariants"]["failures"]): this {
		this.summary.invariants!.failures.push(...failures);
		return this;
	}

	addCompletionGateBlock(block: { workspaceId: string; reasons: string[] }): this {
		this.summary.completionGate!.blocks.push(block);
		return this;
	}

	setCompletionGate(data: Partial<CombinedSummary["completionGate"]>): this {
		if (data.blocks) this.summary.completionGate!.blocks = data.blocks;
		if (data.commandHistoryRecorded !== undefined)
			this.summary.completionGate!.commandHistoryRecorded = data.commandHistoryRecorded;
		if (data.noTestsFoundFailures !== undefined)
			this.summary.completionGate!.noTestsFoundFailures = data.noTestsFoundFailures;
		return this;
	}

	addLimitation(limitation: string): this {
		this.summary.limitations!.push(limitation);
		return this;
	}

	setLeadAgent(data: CombinedSummary["leadAgent"]): this {
		this.summary.leadAgent = data;
		return this;
	}

	setStopContinue(data: CombinedSummary["stopContinue"]): this {
		this.summary.stopContinue = data;
		return this;
	}

	setParallelism(data: CombinedSummary["parallelism"]): this {
		this.summary.parallelism = data;
		return this;
	}

	setArtifact(key: string, filePath: string): this {
		this.summary.artifacts![key] = filePath;
		return this;
	}

	setReplay(commands: string[]): this {
		this.summary.replay = { available: commands.length > 0, commands };
		return this;
	}

	build(overallVerdict: "PASS" | "FAIL" | "PARTIAL", durationMs: number): CombinedSummary {
		const inv = this.summary.invariants!;
		inv.passed = inv.failures.filter((f) => f.category !== "general").length === 0 ? 1 : 0;
		inv.failed = inv.failures.length;

		return {
			runId: this.summary.runId ?? "unknown",
			timestamp: this.summary.timestamp ?? new Date().toISOString(),
			mode: this.summary.mode ?? "unknown",
			seed: this.summary.seed ?? 0,
			durationMs,
			overallVerdict,
			commands: this.summary.commands ?? {},
			stages: this.summary.stages ?? [],
			executionModes: this.summary.executionModes ?? {},
			pythonWebApp: this.summary.pythonWebApp ?? null,
			invariants: inv,
			leadAgent: this.summary.leadAgent ?? { directivesCreated: 0, escalationsCreated: 0, classifications: [] },
			completionGate: this.summary.completionGate ?? {
				blocks: [],
				commandHistoryRecorded: false,
				noTestsFoundFailures: 0,
			},
			stopContinue: this.summary.stopContinue ?? { staleCompletionsIgnored: 0, illegalTransitionsAttempted: 0 },
			parallelism: this.summary.parallelism ?? { samplesPath: "", maxObservedActiveWorkers: 0, timelineSummary: [] },
			artifacts: this.summary.artifacts ?? {},
			replay: this.summary.replay ?? { available: false, commands: [] },
			limitations: this.summary.limitations ?? [],
		};
	}

	/**
	 * Write the combined-summary.json to the report directory.
	 * Merges with existing file if present (additive stages, execution modes).
	 */
	async write(): Promise<string> {
		const filePath = path.join(this.reportDir, "combined-summary.json");

		// Read existing and merge
		let existing: Record<string, unknown> = {};
		try {
			const raw = await fs.readFile(filePath, "utf-8");
			existing = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			// No existing file — start fresh
		}

		// Merge stages: keep existing stages, add new ones (dedupe by id)
		const existingStages = (existing.stages as Array<Record<string, unknown>>) ?? [];
		const newStages = (this.summary.stages ?? []) as Array<Record<string, unknown>>;
		const mergedStages = [...existingStages];
		for (const ns of newStages) {
			const idx = mergedStages.findIndex((s) => s.id === ns.id);
			if (idx >= 0) {
				mergedStages[idx] = ns; // Replace with newer
			} else {
				mergedStages.push(ns);
			}
		}
		this.summary.stages = mergedStages;

		// Merge execution modes (take newer if exists)
		const existingModes = (existing.executionModes as Record<string, Record<string, unknown>>) ?? {};
		const newModes = (this.summary.executionModes ?? {}) as Record<string, Record<string, unknown>>;
		for (const [key, val] of Object.entries(newModes)) {
			existingModes[key] = val;
		}
		this.summary.executionModes = existingModes;

		// Merge leadAgent (additive)
		if (existing.leadAgent) {
			const ela = existing.leadAgent as Record<string, unknown>;
			const nla = this.summary.leadAgent ?? {};
			this.summary.leadAgent = {
				directivesCreated: (Number(ela.directivesCreated) || 0) + (Number(nla.directivesCreated) || 0),
				escalationsCreated: (Number(ela.escalationsCreated) || 0) + (Number(nla.escalationsCreated) || 0),
				classifications: [
					...new Set([...((ela.classifications as string[]) ?? []), ...((nla.classifications as string[]) ?? [])]),
				],
			};
		}

		// Merge completionGate blocks (additive)
		if (existing.completionGate) {
			const ecg = existing.completionGate as Record<string, unknown>;
			const ncg = this.summary.completionGate ?? {};
			const existingBlocks = (ecg.blocks as Array<Record<string, unknown>>) ?? [];
			const newBlocks = (ncg.blocks as Array<Record<string, unknown>>) ?? [];
			this.summary.completionGate = {
				blocks: [...existingBlocks, ...newBlocks],
				commandHistoryRecorded: ecg.commandHistoryRecorded === true || ncg.commandHistoryRecorded === true,
				noTestsFoundFailures: (Number(ecg.noTestsFoundFailures) || 0) + (Number(ncg.noTestsFoundFailures) || 0),
			};
		}

		// Merge replay commands (additive, dedupe)
		if (existing.replay) {
			const erp = existing.replay as Record<string, unknown>;
			const nrp = this.summary.replay ?? {};
			const existingCmds = (erp.commands as string[]) ?? [];
			const newCmds = (nrp.commands as string[]) ?? [];
			this.summary.replay = {
				available: existingCmds.length + newCmds.length > 0,
				commands: [...new Set([...existingCmds, ...newCmds])],
			};
		}

		// Take max parallelism
		if (existing.parallelism) {
			const epar = existing.parallelism as Record<string, unknown>;
			const npar = this.summary.parallelism ?? {};
			this.summary.parallelism = {
				...npar,
				maxObservedActiveWorkers: Math.max(
					Number(epar.maxObservedActiveWorkers) || 0,
					Number(npar.maxObservedActiveWorkers) || 0,
				),
			};
		}

		const json = JSON.stringify(this.summary, null, 2);

		// Validate it parses
		JSON.parse(json);

		await fs.mkdir(this.reportDir, { recursive: true });
		await fs.writeFile(filePath, json, "utf-8");
		return filePath;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makePlanResult(scenario: ScenarioResult): CombinedPlanResult {
	return {
		id: scenario.planId,
		verdict: scenario.passed ? "PASS" : "FAIL",
		workspaces: scenario.workspaceStates.map((ws) => ({
			workspaceId: ws.workspaceId,
			stage: ws.stage,
			attempts: ws.attempts,
			errorMessage: ws.errorMessage,
		})),
	};
}

export function makeExecutionModeResultFromScenarios(
	scenarios: ScenarioResult[],
	mode: string,
	isPatchTransaction: boolean,
): CombinedExecutionModeResult {
	const modeScenarios = scenarios.filter((s) => s.executionMode === mode);
	const allPassed = modeScenarios.every((s) => s.passed);
	const maxParallelism = Math.max(0, ...modeScenarios.map((s) => s.parallelismSummary?.maxObservedActiveWorkers ?? 0));
	const avgParallelism =
		modeScenarios.length > 0
			? modeScenarios.reduce((sum, s) => sum + (s.parallelismSummary?.averageActiveWorkers ?? 0), 0) /
				modeScenarios.length
			: 0;

	const result: CombinedExecutionModeResult = {
		tested: modeScenarios.length > 0,
		verdict: modeScenarios.length === 0 ? "PARTIAL" : allPassed ? "PASS" : "FAIL",
		maxObservedActiveWorkers: maxParallelism,
		averageActiveWorkers: avgParallelism,
		parallelismRegression: modeScenarios.some((s) => s.parallelismSummary?.parallelismRegression === true),
		plans: modeScenarios.map((s) => ({ id: s.planId, verdict: s.passed ? "PASS" : "FAIL" })),
	};

	if (isPatchTransaction) {
		result.patchTransactionFidelity = "simulated";
		result.patchApplyLanesObserved = 1;
		result.directWorkerMutations = 0;
		result.dirtyRepoLeaks = 0;
	}

	return result;
}
