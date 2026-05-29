/**
 * E2E Monitoring — Barrel Exports
 *
 * Flagship E2E test framework for plan execution monitoring.
 *
 * Modules:
 * - types:        Shared type definitions
 * - preflight:    Pre-execution health checks (git, disk, memory, LLM, DB)
 * - metrics:      Runtime metrics collector (LLM tokens, latency, tools)
 * - resources:    System resource monitor (RSS, heap, CPU, event loop)
 * - post-verifier: Post-execution correctness verification
 * - regression:   Snapshot/regression comparison across runs
 * - dashboard-health: Web server endpoint verification
 */

export type * from "./types.js";

export { runPreflightChecks } from "./preflight.js";
export type { PreflightConfig } from "./preflight.js";

export { RuntimeMetricsCollector } from "./metrics.js";

export { ResourceMonitor } from "./resources.js";
export type { ResourceMonitorConfig } from "./resources.js";

export { runPostExecutionVerification } from "./post-verifier.js";
export type { PostVerifierConfig } from "./post-verifier.js";

export { buildRegressionSnapshot, diffSnapshots } from "./regression.js";
export type { SnapshotBuilderConfig, RegressionDiff } from "./regression.js";

export { checkDashboardHealth } from "./dashboard-health.js";
export type { DashboardHealthConfig } from "./dashboard-health.js";

export { verifySchedulerCorrectness } from "./scheduler-verify.js";
export type { SchedulerVerifierConfig, SchedulerCorrectnessReport, WorkspaceTrace } from "./scheduler-verify.js";

export { extractBugEvidence, writeBugEvidenceReport } from "./bug-evidence.js";
export type { BugEvidence, BugEvidenceItem, EvidenceExtractorConfig } from "./bug-evidence.js";
