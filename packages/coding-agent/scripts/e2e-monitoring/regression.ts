/**
 * E2E Regression Snapshot
 *
 * Captures a deterministic snapshot of the execution for comparison across runs.
 * Used to detect regressions in workspace completion rates, parallelism, latency, etc.
 */

import * as crypto from "node:crypto";
import { type RegressionSnapshot } from "./types.js";
import type { WorkspaceMetrics, RuntimeMetricsSnapshot } from "./types.js";
import type { ResourceSample } from "./types.js";
import type { WorkspaceQueue } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Snapshot Builder
// ---------------------------------------------------------------------------

export interface SnapshotBuilderConfig {
	startedAt: number;
	completedAt: number;
	planPath: string;
	planContent: string;
	queue: WorkspaceQueue;
	modelProvider: string;
	modelId: string;
	workspaceMetrics: Map<string, WorkspaceMetrics>;
	metricsSnapshots: RuntimeMetricsSnapshot[];
	resourceSamples: ResourceSample[];
	gitDiffStat: string;
}

export function buildRegressionSnapshot(config: SnapshotBuilderConfig): RegressionSnapshot {
	const planHash = crypto.createHash("sha256").update(config.planContent).digest("hex").substring(0, 16);

	// Workspace results
	const workspaceResults: RegressionSnapshot["workspaceResults"] = {};
	for (const [id, m] of config.workspaceMetrics) {
		workspaceResults[id] = {
			verdict: m.verdict,
			attempts: m.attempts,
			durationMs: m.totalDurationMs ?? 0,
			llmTokensIn: m.llmTokensIn,
			llmTokensOut: m.llmTokensOut,
			error: m.error,
		};
	}

	// Scheduler diagnostics from metrics snapshots
	const maxActive = Math.max(0, ...config.metricsSnapshots.map((s) => s.activeWorkspaces));
	const batchWidths = computeBatchWidths(config.queue);

	// Resource peak
	let maxRss = 0, maxHeap = 0, maxLag = 0;
	for (const s of config.resourceSamples) {
		if (s.rssMb > maxRss) maxRss = s.rssMb;
		if (s.heapUsedMb > maxHeap) maxHeap = s.heapUsedMb;
		if (s.eventLoopLagMs > maxLag) maxLag = s.eventLoopLagMs;
	}

	// Checksums for key artifacts
	const checksums: Record<string, string> = {};
	// (populated by the runner after writing artifacts)

	return {
		timestamp: config.completedAt,
		planPath: config.planPath,
		planHash,
		workspaceCount: config.queue.workspaces.length,
		modelProvider: config.modelProvider,
		modelId: config.modelId,
		maxParallelism: config.queue.maxParallelWorkspaces ?? 3,
		observedParallelism: maxActive,
		totalDurationMs: config.completedAt - config.startedAt,
		workspaceResults,
		schedulerDiagnostics: {
			totalBatches: batchWidths.length,
			batchWidths,
			totalSchedulingRounds: config.metricsSnapshots.length,
		},
		resourcePeak: { maxRssMb: maxRss, maxHeapMb: maxHeap, maxEventLoopLagMs: maxLag },
		gitDiff: config.gitDiffStat,
		checksums,
	};
}

/**
 * Compare two regression snapshots and return differences.
 */
export interface RegressionDiff {
	snapshotA: string; // plan hash
	snapshotB: string; // plan hash
	workspaceCountDiff: number;
	observedParallelismDiff: number;
	durationDiffMs: number;
	totalTokensDiff: number;
	newFailures: string[];
	newSuccesses: string[];
	resolvedErrors: string[];
	strategyChanged: string[]; // workspaces where verdict changed
	peakRssDiffMb: number;
}

export function diffSnapshots(a: RegressionSnapshot, b: RegressionSnapshot): RegressionDiff {
	const wsA = new Set(Object.keys(a.workspaceResults));
	const wsB = new Set(Object.keys(b.workspaceResults));

	const newFailures: string[] = [];
	const newSuccesses: string[] = [];
	const resolvedErrors: string[] = [];
	const strategyChanged: string[] = [];

	for (const id of wsA) {
		if (!wsB.has(id)) continue;
		const ra = a.workspaceResults[id];
		const rb = b.workspaceResults[id];
		if (!ra || !rb) continue;

		if (ra.verdict !== rb.verdict) {
			strategyChanged.push(id);
			if (rb.verdict === "FAILED" || rb.verdict === "BLOCKED") newFailures.push(id);
			if (rb.verdict === "COMPLETE" && ra.verdict !== "COMPLETE") newSuccesses.push(id);
		}
		if (ra.error && !rb.error) resolvedErrors.push(id);
	}

	const aTokens = Object.values(a.workspaceResults).reduce((sum, r) => sum + r.llmTokensIn + r.llmTokensOut, 0);
	const bTokens = Object.values(b.workspaceResults).reduce((sum, r) => sum + r.llmTokensIn + r.llmTokensOut, 0);

	return {
		snapshotA: a.planHash,
		snapshotB: b.planHash,
		workspaceCountDiff: b.workspaceCount - a.workspaceCount,
		observedParallelismDiff: b.observedParallelism - a.observedParallelism,
		durationDiffMs: b.totalDurationMs - a.totalDurationMs,
		totalTokensDiff: bTokens - aTokens,
		newFailures,
		newSuccesses,
		resolvedErrors,
		strategyChanged,
		peakRssDiffMb: b.resourcePeak.maxRssMb - a.resourcePeak.maxRssMb,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeBatchWidths(queue: WorkspaceQueue): number[] {
	const batchGroups = new Map<string, number>();
	for (const ws of queue.workspaces) {
		const wsAny = ws as unknown as Record<string, unknown>;
		const batch = (wsAny.batch as string) ?? "B0";
		batchGroups.set(batch, (batchGroups.get(batch) ?? 0) + 1);
	}
	return [...batchGroups.values()].sort((a, b) => a - b);
}
