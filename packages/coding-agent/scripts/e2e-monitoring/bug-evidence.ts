/**
 * E2E Bug Evidence Extractor
 *
 * Produces structured, evidence-backed bug reports from E2E run results.
 * Every finding includes: what failed, why, where in the code, reproduction
 * steps, and linked artifacts. Designed for CI integration and automated
 * issue filing.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
	E2ERunResult,
	PreflightCheck,
	PostExecutionCheck,
	RuntimeMetricsSnapshot,
	ResourceSample,
	WorkspaceMetrics,
} from "./types.js";
import type { SchedulerViolation } from "./scheduler-verify.js";

// ---------------------------------------------------------------------------
// Evidence artifact types
// ---------------------------------------------------------------------------

export interface BugEvidence {
	/** Unique evidence ID (hash of key data) */
	id: string;
	/** Severity: critical (blocks execution), high (wrong results), medium (degraded), low (cosmetic) */
	severity: "critical" | "high" | "medium" | "low";
	/** Category of the bug */
	category: "scheduler" | "llm" | "state" | "worktree" | "git" | "resource" | "validation" | "completion" | "parallelism" | "logs" | "abort" | "other";
	/** One-line summary */
	title: string;
	/** Detailed description with evidence */
	description: string;
	/** What the system did */
	observed: string;
	/** What it should have done */
	expected: string;
	/** Affected workspace IDs, if any */
	workspaceIds: string[];
	/** File paths in the codebase related to this bug */
	relatedFiles: string[];
	/** Specific lines / values that prove the bug */
	evidence: BugEvidenceItem[];
	/** How to reproduce */
	reproduction: string;
	/** Timestamp when detected */
	detectedAt: number;
	/** Run ID this bug was found in */
	runId: string;
}

export interface BugEvidenceItem {
	type: "violation" | "metric" | "check_failure" | "state_diff" | "log_excerpt" | "trace";
	label: string;
	value: string | number | Record<string, unknown>;
	source: string; // artifact file path
}

// ---------------------------------------------------------------------------
// Evidence extractor
// ---------------------------------------------------------------------------

export interface EvidenceExtractorConfig {
	runResult: E2ERunResult;
	artifactsDir: string;
	schedulerViolations?: SchedulerViolation[];
}

export function extractBugEvidence(config: EvidenceExtractorConfig): BugEvidence[] {
	const { runResult, artifactsDir, schedulerViolations = [] } = config;
	const bugs: BugEvidence[] = [];

	// 1. Preflight failures → bugs
	for (const check of runResult.preflight.checks) {
		if (check.status === "fail") {
			bugs.push(preflightFailureToBug(check, runResult.runId, artifactsDir));
		}
	}

	// 2. Scheduler violations → bugs
	for (const violation of schedulerViolations) {
		bugs.push(schedulerViolationToBug(violation, runResult, artifactsDir));
	}

	// 3. Post-execution check failures → bugs
	for (const check of runResult.postExecution.checks) {
		if (check.status === "fail") {
			bugs.push(postCheckFailureToBug(check, runResult, artifactsDir));
		}
	}

	// 4. Workspace failures with errors → bugs
	for (const [wsId, metrics] of runResult.workspaceMetrics) {
		if (metrics.verdict === "FAILED" && metrics.error) {
			bugs.push(workspaceFailureToBug(wsId, metrics, runResult, artifactsDir));
		}
	}

	// 5. Completion verification failure → bugs
	if (!runResult.success && runResult.errors.some((e) => e.includes("COMPLETION_VERIFICATION_FAILED"))) {
		bugs.push(completionVerificationBug(runResult, artifactsDir));
	}

	// 6. Parallelism regression → bugs
	const maxObserved = runResult.regression?.observedParallelism ?? 0;
	const expected = runResult.regression?.maxParallelism ?? 3;
	if (maxObserved > 0 && maxObserved < expected && expected > 1) {
		bugs.push(parallelismRegressionBug(runResult, maxObserved, expected, artifactsDir));
	}

	// 7. Resource exhaustion → bugs
	if (runResult.resources.length > 0) {
		const peak = runResult.regression?.resourcePeak;
		if (peak && peak.maxEventLoopLagMs > 1000) {
			bugs.push(eventLoopStallBug(runResult, peak.maxEventLoopLagMs, artifactsDir));
		}
		if (peak && peak.maxRssMb > 4000) {
			bugs.push(memoryPressureBug(runResult, peak.maxRssMb, artifactsDir));
		}
	}

	// 8. Workspace timeout / stall → bugs
	for (const [wsId, metrics] of runResult.workspaceMetrics) {
		if (metrics.executionTimeMs && metrics.executionTimeMs > 10 * 60 * 1000) {
			bugs.push(workspaceTimeoutBug(wsId, metrics, runResult, artifactsDir));
		}
	}

	// 9. Cache hit rate degradation → bugs
	const lastSnapshot = runResult.metrics[runResult.metrics.length - 1];
	if (lastSnapshot && lastSnapshot.cacheHitRate < 0.2 && lastSnapshot.totalLLMTokens > 100_000) {
		bugs.push(cacheHitRateBug(runResult, lastSnapshot, artifactsDir));
	}

	return bugs;
}

// ---------------------------------------------------------------------------
// Bug evidence builders
// ---------------------------------------------------------------------------

function preflightFailureToBug(check: PreflightCheck, runId: string, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`preflight-${check.name}-${runId}`),
		severity: check.category === "git" || check.category === "db" ? "critical" : "high",
		category: check.category === "db" ? "state" : check.category === "llm" ? "llm" : "other",
		title: `Preflight check "${check.name}" failed: ${check.message}`,
		description: `The pre-execution health check "${check.name}" failed, blocking plan execution.`,
		observed: check.message,
		expected: "All preflight checks pass",
		workspaceIds: [],
		relatedFiles: mapCategoryToFiles(check.category),
		evidence: [
			{ type: "check_failure", label: "Failure reason", value: check.message, source: `${artifactsDir}/preflight-report.json` },
			...(check.detail ? [{ type: "state_diff" as const, label: "Detail", value: check.detail, source: `${artifactsDir}/preflight-report.json` }] : []),
		],
		reproduction: `Run: npx tsx scripts/run-v5-real-implementation.ts\nPreflight check "${check.name}" will fail.`,
		detectedAt: check.durationMs ? Date.now() : check.durationMs,
		runId,
	};
}

function schedulerViolationToBug(violation: SchedulerViolation, runResult: E2ERunResult, artifactsDir: string): BugEvidence {
	const severity = violation.type === "dependency_order" || violation.type === "max_parallelism" ? "critical" : "high";
	return {
		id: hashEvidence(`scheduler-${violation.type}-${runResult.runId}`),
		severity,
		category: "scheduler",
		title: `Scheduler violation: ${violation.type} — ${violation.message}`,
		description: `The scheduler made an incorrect decision during plan execution. This may cause data corruption, deadlocks, or incorrect results.`,
		observed: violation.message,
		expected: mapViolationTypeToExpected(violation.type),
		workspaceIds: violation.workspaceIds,
		relatedFiles: ["packages/coding-agent/src/core/workspace-scheduler.ts", "packages/coding-agent/src/core/autonomous-executor.ts"],
		evidence: [
			{ type: "violation", label: "Violation type", value: violation.type, source: `${artifactsDir}/scheduler-correctness.json` },
			{ type: "violation", label: "Message", value: violation.message, source: `${artifactsDir}/scheduler-correctness.json` },
			...(violation.detail ? [{ type: "state_diff" as const, label: "Detail", value: violation.detail, source: `${artifactsDir}/scheduler-correctness.json` }] : []),
		],
		reproduction: `Run the plan with the same configuration. The scheduler will make the same decision. Check artifacts at ${artifactsDir}/scheduler-decisions.ndjson.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function postCheckFailureToBug(check: PostExecutionCheck, runResult: E2ERunResult, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`post-${check.name}-${runResult.runId}`),
		severity: check.category === "git" || check.category === "state" ? "critical" : "medium",
		category: check.category === "git" ? "git" : check.category === "state" ? "state" : check.category === "worktrees" ? "worktree" : "other",
		title: `Post-execution check "${check.name}" failed: ${check.message}`,
		description: `After plan execution completed, the post-execution verification check "${check.name}" found an issue.`,
		observed: check.message,
		expected: "All post-execution checks pass",
		workspaceIds: [],
		relatedFiles: mapCategoryToFiles(check.category),
		evidence: [
			{ type: "check_failure", label: "Failure", value: check.message, source: `${artifactsDir}/post-verification.json` },
			...(check.detail ? [{ type: "state_diff" as const, label: "Detail", value: check.detail, source: `${artifactsDir}/post-verification.json` }] : []),
		],
		reproduction: `Post-execution state is captured in ${artifactsDir}/post-verification.json.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function workspaceFailureToBug(wsId: string, metrics: WorkspaceMetrics, runResult: E2ERunResult, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`ws-fail-${wsId}-${runResult.runId}`),
		severity: "high",
		category: metrics.error?.includes("timeout") || metrics.error?.includes("timed out") ? "llm" : "other",
		title: `Workspace ${wsId} FAILED: ${metrics.error?.substring(0, 120) ?? "unknown error"}`,
		description: `Workspace ${wsId} failed during execution with verdict ${metrics.verdict}.`,
		observed: `Verdict: ${metrics.verdict}\nError: ${metrics.error}\nAttempts: ${metrics.attempts}\nDuration: ${metrics.executionTimeMs}ms\nLLM tokens: ${metrics.llmTokensIn} in / ${metrics.llmTokensOut} out`,
		expected: `COMPLETE with no errors`,
		workspaceIds: [wsId],
		relatedFiles: ["packages/coding-agent/src/core/workspace-agent-executor.ts", "packages/coding-agent/src/core/autonomous-executor.ts"],
		evidence: [
			{ type: "metric", label: "Verdict", value: metrics.verdict, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "Error", value: metrics.error ?? "none", source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "Attempts", value: metrics.attempts, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "Duration (ms)", value: metrics.executionTimeMs ?? 0, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "LLM tokens in", value: metrics.llmTokensIn, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "LLM tokens out", value: metrics.llmTokensOut, source: `${artifactsDir}/workspace-metrics.ndjson` },
		],
		reproduction: `Workspace ${wsId} failure at ${artifactsDir}/workspace-final-reports/${wsId}.md. Re-run the plan to reproduce.`,
		detectedAt: metrics.completedAt ?? Date.now(),
		runId: runResult.runId,
	};
}

function completionVerificationBug(runResult: E2ERunResult, artifactsDir: string): BugEvidence {
	const error = runResult.errors.find((e) => e.includes("COMPLETION_VERIFICATION_FAILED")) ?? "";
	return {
		id: hashEvidence(`completion-verify-${runResult.runId}`),
		severity: "critical",
		category: "completion",
		title: "Plan marked complete but workspaces never executed",
		description: `The execution loop exited with all workspaces terminal, but some were in Blocked/Failed state with zero execution attempts. This means workspaces were marked terminal without ever running.`,
		observed: error,
		expected: "All workspaces execute at least once before plan completion",
		workspaceIds: [],
		relatedFiles: [
			"packages/web-server/src/plan-runner.ts",
			"packages/coding-agent/src/core/autonomous-executor.ts",
		],
		evidence: [
			{ type: "log_excerpt", label: "Error", value: error, source: `${artifactsDir}/event-stream.ndjson` },
		],
		reproduction: `Run the plan with Postgres backend and worktree isolation. The completion verification catches this before marking the plan complete.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function parallelismRegressionBug(runResult: E2ERunResult, observed: number, expected: number, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`parallelism-${runResult.runId}`),
		severity: "high",
		category: "parallelism",
		title: `Parallelism regression: observed max ${observed} active workers, expected ≥${expected}`,
		description: `The plan requested ${expected} workers but the scheduler only ever ran ${observed} concurrently. This indicates file-lock conflicts, dependency bottlenecks, or scheduler bugs preventing parallel execution.`,
		observed: `Max observed active: ${observed}`,
		expected: `At least ${expected} concurrent workers`,
		workspaceIds: [],
		relatedFiles: [
			"packages/coding-agent/src/core/workspace-scheduler.ts",
			"packages/coding-agent/scripts/e2e-monitoring/scheduler-verify.ts",
		],
		evidence: [
			{ type: "metric", label: "Observed max parallelism", value: observed, source: `${artifactsDir}/parallelism-samples.ndjson` },
			{ type: "metric", label: "Expected parallelism", value: expected, source: `${artifactsDir}/regression-snapshot.json` },
		],
		reproduction: `Check ${artifactsDir}/parallelism-samples.ndjson for per-sample active counts. The scheduler decisions in ${artifactsDir}/scheduler-decisions.ndjson show why workspaces were blocked.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function eventLoopStallBug(runResult: E2ERunResult, maxLagMs: number, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`eventloop-${runResult.runId}`),
		severity: "medium",
		category: "resource",
		title: `Event loop lag spike: ${maxLagMs}ms`,
		description: `The event loop was blocked for ${maxLagMs}ms during execution. This indicates synchronous operations, resource contention, or GC pressure degrading performance.`,
		observed: `Max event loop lag: ${maxLagMs}ms`,
		expected: "Event loop lag < 1000ms",
		workspaceIds: [],
		relatedFiles: ["packages/coding-agent/src/core/workspace-agent-executor.ts"],
		evidence: [
			{ type: "metric", label: "Max event loop lag (ms)", value: maxLagMs, source: `${artifactsDir}/resource-samples.ndjson` },
			{ type: "metric", label: "Peak RSS (MB)", value: runResult.regression?.resourcePeak.maxRssMb ?? 0, source: `${artifactsDir}/regression-snapshot.json` },
		],
		reproduction: `Resource samples at ${artifactsDir}/resource-samples.ndjson. Re-run with the same config to reproduce.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function memoryPressureBug(runResult: E2ERunResult, maxRssMb: number, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`memory-${runResult.runId}`),
		severity: "medium",
		category: "resource",
		title: `Memory pressure: peak RSS ${maxRssMb}MB`,
		description: `Peak RSS reached ${maxRssMb}MB during execution. This may indicate memory leaks, unbounded buffers, or excessive concurrent operations.`,
		observed: `Peak RSS: ${maxRssMb}MB`,
		expected: "RSS < 4000MB",
		workspaceIds: [],
		relatedFiles: ["packages/coding-agent/src/core/json-state-store.ts"],
		evidence: [
			{ type: "metric", label: "Peak RSS (MB)", value: maxRssMb, source: `${artifactsDir}/resource-samples.ndjson` },
			{ type: "metric", label: "Peak Heap (MB)", value: runResult.regression?.resourcePeak.maxHeapMb ?? 0, source: `${artifactsDir}/regression-snapshot.json` },
		],
		reproduction: `Resource samples at ${artifactsDir}/resource-samples.ndjson.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

function workspaceTimeoutBug(wsId: string, metrics: WorkspaceMetrics, runResult: E2ERunResult, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`timeout-${wsId}-${runResult.runId}`),
		severity: "high",
		category: "llm",
		title: `Workspace ${wsId} exceeded 10min timeout (${Math.round((metrics.executionTimeMs ?? 0) / 60000)}min)`,
		description: `Workspace ${wsId} took ${Math.round((metrics.executionTimeMs ?? 0) / 60000)} minutes to complete. This indicates an LLM stall, infinite tool loop, or blocked worktree operation.`,
		observed: `Duration: ${metrics.executionTimeMs}ms, LLM requests: ${metrics.llmRequestCount}, Tool calls: ${metrics.toolCallCount}`,
		expected: "Under 10 minutes per workspace",
		workspaceIds: [wsId],
		relatedFiles: ["packages/coding-agent/src/core/workspace-agent-executor.ts"],
		evidence: [
			{ type: "metric", label: "Duration (ms)", value: metrics.executionTimeMs ?? 0, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "LLM requests", value: metrics.llmRequestCount, source: `${artifactsDir}/workspace-metrics.ndjson` },
			{ type: "metric", label: "Tool calls", value: metrics.toolCallCount, source: `${artifactsDir}/workspace-metrics.ndjson` },
		],
		reproduction: `Workspace ${wsId} logs at ${artifactsDir}/workspace-transcripts/.`,
		detectedAt: metrics.completedAt ?? Date.now(),
		runId: runResult.runId,
	};
}

function cacheHitRateBug(runResult: E2ERunResult, snapshot: RuntimeMetricsSnapshot, artifactsDir: string): BugEvidence {
	return {
		id: hashEvidence(`cache-${runResult.runId}`),
		severity: "low",
		category: "llm",
		title: `Low cache hit rate: ${(snapshot.cacheHitRate * 100).toFixed(1)}%`,
		description: `Cache hit rate is below 20% with ${snapshot.totalLLMTokens} total tokens. This indicates the prompt cache prefix is being invalidated between calls, wasting inference budget.`,
		observed: `Cache hit rate: ${(snapshot.cacheHitRate * 100).toFixed(1)}%, Total tokens: ${snapshot.totalLLMTokens}`,
		expected: "Cache hit rate >= 20%",
		workspaceIds: [],
		relatedFiles: ["packages/ai/src/prompt-cache.ts"],
		evidence: [
			{ type: "metric", label: "Cache hit rate", value: snapshot.cacheHitRate, source: `${artifactsDir}/metrics-snapshots.ndjson` },
			{ type: "metric", label: "Total tokens", value: snapshot.totalLLMTokens, source: `${artifactsDir}/metrics-snapshots.ndjson` },
		],
		reproduction: `Re-run the plan. Cache hit rate is tracked per LLM call.`,
		detectedAt: Date.now(),
		runId: runResult.runId,
	};
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

export async function writeBugEvidenceReport(bugs: BugEvidence[], outputPath: string): Promise<void> {
	const lines: string[] = [
		`# Bug Evidence Report`,
		``,
		`Generated: ${new Date().toISOString()}`,
		`Total bugs found: ${bugs.length}`,
		``,
		`## Summary by Severity`,
		`- Critical: ${bugs.filter((b) => b.severity === "critical").length}`,
		`- High: ${bugs.filter((b) => b.severity === "high").length}`,
		`- Medium: ${bugs.filter((b) => b.severity === "medium").length}`,
		`- Low: ${bugs.filter((b) => b.severity === "low").length}`,
		``,
		`## Summary by Category`,
	];

	const byCategory = new Map<string, number>();
	for (const b of bugs) {
		byCategory.set(b.category, (byCategory.get(b.category) ?? 0) + 1);
	}
	for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`- ${cat}: ${count}`);
	}
	lines.push(``);

	for (let i = 0; i < bugs.length; i++) {
		const b = bugs[i];
		lines.push(
			`---`,
			``,
			`## Bug #${i + 1}: ${b.title}`,
			``,
			`- **ID:** \`${b.id}\``,
			`- **Severity:** ${b.severity.toUpperCase()}`,
			`- **Category:** ${b.category}`,
			`- **Detected:** ${new Date(b.detectedAt).toISOString()}`,
			`- **Run:** ${b.runId}`,
			``,
			`### Description`,
			b.description,
			``,
			`### Observed`,
			`\`\`\``,
			b.observed,
			`\`\`\``,
			``,
			`### Expected`,
			`\`\`\``,
			b.expected,
			`\`\`\``,
			``,
			`### Evidence`,
		);

		for (const item of b.evidence) {
			lines.push(`- **${item.label}:** \`${typeof item.value === "object" ? JSON.stringify(item.value) : item.value}\` _(source: ${item.source})_`);
		}

		lines.push(
			``,
			`### Affected Workspaces`,
			b.workspaceIds.length > 0 ? b.workspaceIds.map((id) => `- \`${id}\``).join("\n") : "- (none)",
			``,
			`### Related Files`,
			b.relatedFiles.map((f) => `- \`${f}\``).join("\n"),
			``,
			`### Reproduction`,
			`\`\`\``,
			b.reproduction,
			`\`\`\``,
			``,
		);
	}

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, lines.join("\n"));

	// Also write machine-readable JSON
	const jsonPath = outputPath.replace(/\.md$/, ".json");
	await fs.writeFile(jsonPath, JSON.stringify(bugs, null, 2));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashEvidence(key: string): string {
	const crypto = require("node:crypto");
	return crypto.createHash("sha256").update(key).digest("hex").substring(0, 12);
}

function mapCategoryToFiles(category: string): string[] {
	switch (category) {
		case "git": return ["packages/coding-agent/src/core/auto-commit.ts"];
		case "disk": return ["packages/coding-agent/src/core/workspace-agent-executor.ts"];
		case "memory": return ["packages/coding-agent/src/core/worker-memory-guard.ts"];
		case "db": return ["packages/coding-agent/src/core/state-store.ts", "packages/coding-agent/src/core/database-state-store.ts"];
		case "llm": return ["packages/ai/src/providers/", "packages/coding-agent/src/core/workspace-agent-executor.ts"];
		case "process": return ["packages/coding-agent/src/core/tools/bash.ts", "packages/coding-agent/src/utils/shell.ts"];
		case "state": return ["packages/coding-agent/src/core/state-store.ts", "packages/coding-agent/src/core/json-state-store.ts"];
		case "worktrees": return ["packages/coding-agent/src/worktree/worktree-manager.ts"];
		case "commits": return ["packages/coding-agent/src/core/auto-commit.ts"];
		case "files": return ["packages/coding-agent/src/core/tools/write.ts", "packages/coding-agent/src/core/tools/edit.ts"];
		case "audit": return ["packages/coding-agent/src/core/completion-gate.ts"];
		default: return [];
	}
}

function mapViolationTypeToExpected(type: string): string {
	switch (type) {
		case "dependency_order": return "No workspace starts before all its dependencies complete";
		case "max_parallelism": return "Never more than maxParallel workspaces active simultaneously";
		case "cannot_run_with": return "No workspace runs concurrently with a cannotRunWith peer";
		case "orphan": return "Every launched workspace completes or fails";
		case "duplicate_launch": return "Each workspace is launched exactly once per attempt";
		case "file_lock_conflict": return "Workspaces with overlapping canEdit from different batches never run concurrently";
		default: return "No violations";
	}
}
