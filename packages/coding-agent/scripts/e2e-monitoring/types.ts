/**
 * E2E Monitoring — Shared Types
 *
 * Central type definitions for the flagship E2E test framework.
 * Every monitoring module references these base types.
 */

import type { Workspace, WorkspaceQueue } from "../../src/core/workspace-schema.js";

// =========================================================================
// Preflight
// =========================================================================

export interface PreflightCheck {
	name: string;
	category: "git" | "disk" | "memory" | "network" | "db" | "llm" | "process";
	status: "pass" | "fail" | "warn" | "skip";
	message: string;
	durationMs: number;
	detail?: Record<string, unknown>;
}

export interface PreflightReport {
	timestamp: number;
	totalChecks: number;
	passed: number;
	failed: number;
	warned: number;
	skipped: number;
	checks: PreflightCheck[];
	blockExecution: boolean;
	blockReasons: string[];
}

// =========================================================================
// Runtime Metrics
// =========================================================================

export interface WorkspaceMetrics {
	workspaceId: string;
	startedAt: number;
	completedAt: number | null;
	totalDurationMs: number | null;
	queueTimeMs: number; // pending → active
	executionTimeMs: number | null; // active → complete
	commitTimeMs: number | null;
	worktreeCreateMs: number | null;
	worktreeCleanupMs: number | null;
	attempts: number;
	verdict: string;
	error: string | null;

	// LLM metrics
	llmTokensIn: number;
	llmTokensOut: number;
	llmCacheRead: number;
	llmCacheWrite: number;
	llmRequestCount: number;
	llmLatencyMs: number[]; // per-request latencies
	llmFirstTokenMs: number | null;

	// Tool metrics
	toolCallCount: number;
	toolCallErrors: number;
	toolNames: Map<string, number>; // tool → count

	// File metrics
	filesRead: number;
	filesWritten: number;
	linesChanged: number;

	// Session metrics
	agentTurns: number;
	compactionCount: number;
	thinkingBufferChars: number;
}

export interface RuntimeMetricsSnapshot {
	timestamp: number;
	elapsedMs: number;
	activeWorkspaces: number;
	completedWorkspaces: number;
	failedWorkspaces: number;
	blockedWorkspaces: number;
	pendingWorkspaces: number;
	totalLLMTokens: number;
	totalLLMCostEstimate: number;
	cacheHitRate: number;
	avgWorkspaceLatencyMs: number | null;
	p50WorkspaceLatencyMs: number | null;
	p95WorkspaceLatencyMs: number | null;
	p99WorkspaceLatencyMs: number | null;
	schedulerUtilization: number; // active / maxWorkers
	fileLocksHeld: number;
	worktreesActive: number;
}

// =========================================================================
// Resource Monitoring
// =========================================================================

export interface ResourceSample {
	timestamp: number;
	rssMb: number;
	heapUsedMb: number;
	heapTotalMb: number;
	externalMb: number;
	cpuUser: number;
	cpuSystem: number;
	eventLoopLagMs: number;
	openFds: number;
	activeHandles: number;
	activeRequests: number;
	diskFreeGb: number | null;
	loadAvg1m: number | null;
}

// =========================================================================
// Post-Execution Verification
// =========================================================================

export interface PostExecutionCheck {
	name: string;
	category: "git" | "state" | "files" | "commits" | "worktrees" | "processes" | "api" | "audit";
	status: "pass" | "fail" | "warn" | "skip";
	message: string;
	detail?: Record<string, unknown>;
}

export interface PostExecutionReport {
	timestamp: number;
	totalChecks: number;
	passed: number;
	failed: number;
	warned: number;
	checks: PostExecutionCheck[];
	overallPassed: boolean;
}

// =========================================================================
// Regression Snapshot
// =========================================================================

export interface RegressionSnapshot {
	timestamp: number;
	planPath: string;
	planHash: string;
	workspaceCount: number;
	modelProvider: string;
	modelId: string;
	maxParallelism: number;
	observedParallelism: number;
	totalDurationMs: number;
	workspaceResults: Record<string, {
		verdict: string;
		attempts: number;
		durationMs: number;
		llmTokensIn: number;
		llmTokensOut: number;
		error: string | null;
	}>;
	schedulerDiagnostics: {
		totalBatches: number;
		batchWidths: number[];
		totalSchedulingRounds: number;
	};
	resourcePeak: {
		maxRssMb: number;
		maxHeapMb: number;
		maxEventLoopLagMs: number;
	};
	gitDiff: string; // git diff --stat after execution
	checksums: Record<string, string>; // key artifact → sha256
}

// =========================================================================
// Dashboard Health
// =========================================================================

export interface EndpointCheck {
	endpoint: string;
	method: string;
	statusCode: number | null;
	latencyMs: number;
	error: string | null;
	bodySample: unknown;
}

export interface DashboardHealthReport {
	timestamp: number;
	baseUrl: string;
	endpointsChecked: number;
	endpointsPassed: number;
	endpointsFailed: number;
	checks: EndpointCheck[];
	serverPid: number | null;
	serverUptimeMs: number | null;
}

// =========================================================================
// Full E2E Run Result
// =========================================================================

export interface E2ERunResult {
	runId: string;
	startedAt: number;
	completedAt: number;
	totalDurationMs: number;
	planPath: string;
	exitCode: number;
	success: boolean;
	preflight: PreflightReport;
	metrics: RuntimeMetricsSnapshot[];
	resources: ResourceSample[];
	postExecution: PostExecutionReport;
	regression: RegressionSnapshot | null;
	dashboardHealth: DashboardHealthReport | null;
	workspaceMetrics: Map<string, WorkspaceMetrics>;
	errors: string[];
	artifactsDir: string;
}
