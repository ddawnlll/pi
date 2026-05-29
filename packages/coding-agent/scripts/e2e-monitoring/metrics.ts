/**
 * E2E Runtime Metrics Collector
 *
 * Tracks per-workspace and aggregate metrics during plan execution:
 * - LLM token usage & cache hit rates
 * - Workspace latency breakdown (queue, execution, commit)
 * - Tool call statistics
 * - Percentile computation
 * - Scheduler utilization
 */

import type { WorkspaceMetrics, RuntimeMetricsSnapshot } from "./types.js";
import type { PlanState } from "../../src/core/plan-state.js";
import { WorkspaceStage } from "../../src/core/workspace-schema.js";

// ---------------------------------------------------------------------------
// Metrics Collector
// ---------------------------------------------------------------------------

export class RuntimeMetricsCollector {
	private workspaceMetrics = new Map<string, WorkspaceMetrics>();
	private workspaceQueueTimes = new Map<string, number>(); // wsId → queuedAt timestamp
	private workspaceStartTimes = new Map<string, number>(); // wsId → activeAt timestamp
	private snapshots: RuntimeMetricsSnapshot[] = [];
	private startTime: number;

	constructor(private maxWorkers: number) {
		this.startTime = Date.now();
	}

	// ── Workspace lifecycle ────────────────────────────────────────────

	markQueued(workspaceId: string): void {
		this.workspaceQueueTimes.set(workspaceId, Date.now());
		this.ensureMetrics(workspaceId);
	}

	markStarted(workspaceId: string, attemptNo: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.startedAt = Date.now();
		metrics.attempts = attemptNo;

		const queuedAt = this.workspaceQueueTimes.get(workspaceId);
		if (queuedAt) {
			metrics.queueTimeMs = Date.now() - queuedAt;
		}
	}

	markCompleted(workspaceId: string, verdict: string, error: string | null): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.completedAt = Date.now();
		metrics.verdict = verdict;
		metrics.error = error;
		metrics.totalDurationMs = metrics.completedAt - metrics.startedAt;
		metrics.executionTimeMs = metrics.totalDurationMs;
	}

	markWorktreeCreate(workspaceId: string, durationMs: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.worktreeCreateMs = durationMs;
	}

	markWorktreeCleanup(workspaceId: string, durationMs: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.worktreeCleanupMs = durationMs;
	}

	markCommit(workspaceId: string, durationMs: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.commitTimeMs = durationMs;
	}

	// ── LLM metrics ────────────────────────────────────────────────────

	recordLLMUsage(workspaceId: string, tokensIn: number, tokensOut: number, cacheRead: number, cacheWrite: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.llmTokensIn += tokensIn;
		metrics.llmTokensOut += tokensOut;
		metrics.llmCacheRead += cacheRead;
		metrics.llmCacheWrite += cacheWrite;
		metrics.llmRequestCount++;
	}

	recordLLMLatency(workspaceId: string, latencyMs: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.llmLatencyMs.push(latencyMs);
	}

	recordFirstToken(workspaceId: string, latencyMs: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.llmFirstTokenMs = latencyMs;
	}

	// ── Tool metrics ───────────────────────────────────────────────────

	recordToolCall(workspaceId: string, toolName: string, isError: boolean): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.toolCallCount++;
		if (isError) metrics.toolCallErrors++;
		const count = metrics.toolNames.get(toolName) ?? 0;
		metrics.toolNames.set(toolName, count + 1);
	}

	// ── File metrics ───────────────────────────────────────────────────

	recordFileRead(workspaceId: string, count: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.filesRead += count;
	}

	recordFileWrite(workspaceId: string, count: number, linesChanged: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.filesWritten += count;
		metrics.linesChanged += linesChanged;
	}

	// ── Session metrics ────────────────────────────────────────────────

	recordAgentTurn(workspaceId: string): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.agentTurns++;
	}

	recordCompaction(workspaceId: string): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.compactionCount++;
	}

	recordThinking(workspaceId: string, charCount: number): void {
		const metrics = this.ensureMetrics(workspaceId);
		metrics.thinkingBufferChars += charCount;
	}

	// ── Snapshot ───────────────────────────────────────────────────────

	takeSnapshot(state: PlanState): RuntimeMetricsSnapshot {
		const now = Date.now();
		let activeCount = 0;
		let completedCount = 0;
		let failedCount = 0;
		let blockedCount = 0;
		let pendingCount = 0;

		for (const [, ws] of state.workspaces) {
			switch (ws.stage) {
				case WorkspaceStage.Active: activeCount++; break;
				case WorkspaceStage.Complete: completedCount++; break;
				case WorkspaceStage.Failed: failedCount++; break;
				case WorkspaceStage.Blocked: blockedCount++; break;
				case WorkspaceStage.Pending: pendingCount++; break;
			}
		}

		let totalTokens = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		const completedDurations: number[] = [];

		for (const metrics of this.workspaceMetrics.values()) {
			totalTokens += metrics.llmTokensIn + metrics.llmTokensOut;
			totalCacheRead += metrics.llmCacheRead;
			totalCacheWrite += metrics.llmCacheWrite;
			if (metrics.totalDurationMs != null) {
				completedDurations.push(metrics.totalDurationMs);
			}
		}

		const snapshot: RuntimeMetricsSnapshot = {
			timestamp: now,
			elapsedMs: now - this.startTime,
			activeWorkspaces: activeCount,
			completedWorkspaces: completedCount,
			failedWorkspaces: failedCount,
			blockedWorkspaces: blockedCount,
			pendingWorkspaces: pendingCount,
			totalLLMTokens: totalTokens,
			totalLLMCostEstimate: estimateCost(totalTokens),
			cacheHitRate: totalCacheRead + totalCacheWrite > 0 ? totalCacheRead / (totalCacheRead + totalCacheWrite) : 0,
			avgWorkspaceLatencyMs: avg(completedDurations),
			p50WorkspaceLatencyMs: percentile(completedDurations, 50),
			p95WorkspaceLatencyMs: percentile(completedDurations, 95),
			p99WorkspaceLatencyMs: percentile(completedDurations, 99),
			schedulerUtilization: this.maxWorkers > 0 ? activeCount / this.maxWorkers : 0,
			fileLocksHeld: 0, // populated externally
			worktreesActive: 0, // populated externally
		};

		this.snapshots.push(snapshot);
		return snapshot;
	}

	// ── Accessors ──────────────────────────────────────────────────────

	getWorkspaceMetrics(): Map<string, WorkspaceMetrics> {
		return new Map(this.workspaceMetrics);
	}

	getSnapshots(): RuntimeMetricsSnapshot[] {
		return [...this.snapshots];
	}

	getElapsedMs(): number {
		return Date.now() - this.startTime;
	}

	// ── Private ────────────────────────────────────────────────────────

	private ensureMetrics(workspaceId: string): WorkspaceMetrics {
		let m = this.workspaceMetrics.get(workspaceId);
		if (!m) {
			m = {
				workspaceId,
				startedAt: 0,
				completedAt: null,
				totalDurationMs: null,
				queueTimeMs: 0,
				executionTimeMs: null,
				commitTimeMs: null,
				worktreeCreateMs: null,
				worktreeCleanupMs: null,
				attempts: 0,
				verdict: "pending",
				error: null,
				llmTokensIn: 0,
				llmTokensOut: 0,
				llmCacheRead: 0,
				llmCacheWrite: 0,
				llmRequestCount: 0,
				llmLatencyMs: [],
				llmFirstTokenMs: null,
				toolCallCount: 0,
				toolCallErrors: 0,
				toolNames: new Map(),
				filesRead: 0,
				filesWritten: 0,
				linesChanged: 0,
				agentTurns: 0,
				compactionCount: 0,
				thinkingBufferChars: 0,
			};
			this.workspaceMetrics.set(workspaceId, m);
		}
		return m;
	}
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

function avg(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function estimateCost(totalTokens: number): number {
	// Rough estimate: $2-15 per million tokens depending on model
	const costPerMillion = 5; // $5/MTok average
	return (totalTokens / 1_000_000) * costPerMillion;
}
