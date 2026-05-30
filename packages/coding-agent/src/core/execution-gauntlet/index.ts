/**
 * Execution Gauntlet — P38.1
 *
 * Central multi-mode synthetic E2E execution gauntlet.
 * Replaces one-off dogfood prompts with a cheap, reproducible,
 * multi-plan E2E execution suite.
 */

// Re-export LeadAgent from lead-agent module for gauntlet use
export { LeadAgent } from "../lead-agent/lead-agent.js";
export type {
	CombinedExecutionModeResult,
	CombinedPlanResult,
	CombinedStageResult,
	CombinedSummary,
	PythonWebAppSummary,
} from "./combined-summary.js";
// P38.1.HOTFIX — Combined JSON summary
export { CombinedSummaryBuilder, makeExecutionModeResultFromScenarios, makePlanResult } from "./combined-summary.js";
export type { DeterministicRunConfig } from "./deterministic-runner.js";
export { runDeterministicScenario } from "./deterministic-runner.js";
export type { ExecutionModeContext, GauntletExecutionMode } from "./execution-mode-adapter.js";
export {
	assertStable3Profile,
	createExecutionModeContext,
	isBehaviorValidForMode,
	isDirectMutationAllowed,
	STABLE_3_PROFILE,
} from "./execution-mode-adapter.js";
export type {
	InvariantCategory,
	InvariantResult,
	InvariantSeverity,
	ScenarioInvariantContext,
} from "./invariant-checker.js";
export { aggregateInvariantResults, checkInvariants } from "./invariant-checker.js";
export type { LiveMonitorEvent, LiveMonitorState } from "./live-monitor.js";
export { LiveMonitor } from "./live-monitor.js";
export type { MarkdownTaskSpec, TaskFileSpec, TaskWorkerResult } from "./markdown-task-worker.js";
// P38.1.HOTFIX — Markdown task worker
export { executeMarkdownTask, loadMarkdownTasks, runPythonWebAppValidation } from "./markdown-task-worker.js";
export type { MonteCarloConfig, MonteCarloResult } from "./monte-carlo-runner.js";
export { runMonteCarlo } from "./monte-carlo-runner.js";
export type { ParallelismSample, ParallelismSummary } from "./parallelism-monitor.js";
export { ParallelismMonitor } from "./parallelism-monitor.js";
export type { PythonCommandResult, PythonServerProcess, PythonValidationResult } from "./python-smoke-runner.js";
// P38.1.HOTFIX — Python smoke runner
export {
	healthCheck,
	killAllTrackedProcesses,
	runPythonCommand,
	runPythonValidation,
	startPythonServer,
	stopServer,
	waitForServer,
} from "./python-smoke-runner.js";
export type { ReplayFile } from "./replay.js";
export { loadReplay, saveReplay, validateReplay } from "./replay.js";
export type { GauntletReport, ScenarioResult } from "./report-writer.js";
export { ReportWriter } from "./report-writer.js";
export type { GauntletScenario } from "./scenario-registry.js";
export { getScenarioRegistry, ScenarioRegistry } from "./scenario-registry.js";
export type { RealSmokeFailureMode, RealSmokeMCConfig, RealSmokeMCResult } from "./smoke-real-mc-runner.js";
// P38.1.HOTFIX-2 — Smoke-real Monte Carlo runner
export { runRealSmokeMonteCarlo } from "./smoke-real-mc-runner.js";
export type { SmokeRealPythonConfig, SmokeRealPythonResult } from "./smoke-real-python-runner.js";
// P38.1.HOTFIX — Smoke-real Python web app runner
export { runSmokeRealPythonWebApp } from "./smoke-real-python-runner.js";
export type { GauntletPlan } from "./synthetic-plan-builder.js";
export {
	ALL_PLANS,
	buildG1HelloSuccess,
	buildG2ThreeParallelHello,
	buildG3PatchNonOverlapping,
	buildG4PatchWriteSetViolation,
	buildG5CompletionGateMissingCommand,
	buildG6NoTestsFoundExitZero,
	buildG7RepeatedRetryLoop,
	buildG8HalfDoneWorker,
	buildG9StopContinueStaleCompletion,
	buildG10SucceededToRunningRetry,
	buildG11FinalValidationRepair,
	buildG12DashboardVisibility,
	buildPlanQueue,
	getPlansByCategory,
	getPlansByExecutionMode,
} from "./synthetic-plan-builder.js";
export type { SyntheticRepo } from "./synthetic-repo.js";
export { createSyntheticRepo, ensureWorkspaceDir, fileExists, listFiles } from "./synthetic-repo.js";
export type { SyntheticCommandResult, SyntheticRunResult, SyntheticWorkerBehavior } from "./synthetic-worker.js";
export { createRng, createSyntheticWorker } from "./synthetic-worker.js";
export type { TuiState } from "./tui.js";
export { TuiConsole } from "./tui.js";
