/**
 * Goal Drift Detector — P15.E
 *
 * Monitors proposal rejection patterns against active goals, detects drift
 * (goal misalignment), and creates drift reports for review.
 *
 * The detector does NOT auto-correct goals. It only generates reports that
 * a user or upstream system can act upon. Drift is detected via multiple
 * indicators:
 *
 * 1. Rejection pattern — when proposals aligned with a goal are rejected
 *    repeatedly (threshold: default 3)
 * 2. Proposal mismatch — when rejections cite alignment/priority/relevance
 *    issues
 * 3. Goal staleness — when a goal has not been updated for a long period
 * 4. Priority shift — when user preferences suggest a shift away from a
 *    goal's priority level
 *
 * File scope: Defines GoalDriftDetector class, DriftDetectorConfig,
 * DriftCheckState, RejectionEntry, and GoalRejectionLog.
 * Dependencies: P15.B (store), P14.A (memory types)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { MemorySourceRef } from "../memory/types.js";
import type { GoalStore } from "./store.js";
import type { GoalDriftReport, GoalRecord, PreferenceRecord } from "./types.js";
import { createGoalDriftReport } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the GoalDriftDetector.
 */
export interface DriftDetectorConfig {
	/** Number of rejections of same-goal-aligned proposals before drift is detected (default: 3) */
	rejectionThreshold: number;
	/** Time window in days within which rejections are considered (default: 7) */
	windowDays: number;
	/** Fraction of rejections citing mismatch issues to trigger proposal_mismatch indicator (default: 0.5) */
	mismatchThreshold: number;
	/** Interval in hours between scheduled drift checks (default: 24) */
	checkIntervalHours: number;
}

/**
 * Persisted state of the last drift check.
 */
export interface DriftCheckState {
	/** ISO 8601 timestamp of the last drift check */
	lastCheck: string;
	/** IDs of drift reports created in the last check */
	lastDriftIds: string[];
	/** Cumulative count of rejection entries recorded */
	rejectionCount: number;
}

/**
 * A single rejection entry recorded against a goal.
 */
export interface RejectionEntry {
	/** ISO 8601 timestamp when the rejection occurred */
	timestamp: string;
	/** Optional ID of the rejected proposal */
	proposalId?: string;
	/** Optional title of the rejected proposal */
	proposalTitle?: string;
	/** Optional reason for rejection (from user feedback) */
	reason?: string;
}

/**
 * In-memory rejection log keyed by goal ID.
 */
export interface GoalRejectionLog {
	[goalId: string]: RejectionEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: DriftDetectorConfig = {
	rejectionThreshold: 3,
	windowDays: 7,
	mismatchThreshold: 0.5,
	checkIntervalHours: 24,
};

const REJECTION_LOG_FILENAME = "rejection-log.json";

// ---------------------------------------------------------------------------
// GoalDriftDetector
// ---------------------------------------------------------------------------

/**
 * Detects goal drift by analyzing rejection patterns, proposal alignment,
 * goal staleness, and priority shifts.
 *
 * Drift is detected but NOT auto-corrected. Only drift reports are created,
 * which a user or upstream system can review and act upon.
 */
export class GoalDriftDetector {
	private config: DriftDetectorConfig;
	private store: GoalStore;
	private state: DriftCheckState;
	private rejectionLog: GoalRejectionLog = {};
	private initialized = false;

	/**
	 * @param store - The GoalStore instance for persistence
	 * @param config - Optional partial configuration (merged with defaults)
	 */
	constructor(store: GoalStore, config?: Partial<DriftDetectorConfig>) {
		this.store = store;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.state = {
			lastCheck: "",
			lastDriftIds: [],
			rejectionCount: 0,
		};
	}

	// -----------------------------------------------------------------------
	// Initialization
	// -----------------------------------------------------------------------

	/**
	 * Initialize the detector: ensure directories exist and load the
	 * persisted rejection log.
	 *
	 * Call this once before performing any drift detection operations.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		const logPath = this.getRejectionLogPath();
		await fs.mkdir(path.dirname(logPath), { recursive: true });

		try {
			const data = await fs.readFile(logPath, "utf-8");
			const parsed = JSON.parse(data);
			if (parsed && typeof parsed === "object") {
				this.rejectionLog = parsed as GoalRejectionLog;
			}
		} catch {
			this.rejectionLog = {};
		}

		// Load persisted check state from the log metadata if available
		if (this.rejectionLog.__meta__) {
			const meta = this.rejectionLog.__meta__ as unknown as DriftCheckState;
			if (meta.lastCheck) this.state.lastCheck = meta.lastCheck;
			if (meta.lastDriftIds) this.state.lastDriftIds = meta.lastDriftIds;
			if (meta.rejectionCount !== undefined) this.state.rejectionCount = meta.rejectionCount;
		}

		this.initialized = true;
	}

	/**
	 * Persist the current rejection log to disk.
	 */
	private async persistRejectionLog(): Promise<void> {
		const logPath = this.getRejectionLogPath();
		const data: GoalRejectionLog & { __meta__: DriftCheckState } = {
			...this.rejectionLog,
			__meta__: { ...this.state },
		};
		await fs.mkdir(path.dirname(logPath), { recursive: true });
		await fs.writeFile(logPath, JSON.stringify(data, null, 2), "utf-8");
	}

	/**
	 * Get the path to the rejection log file.
	 */
	private getRejectionLogPath(): string {
		const basePath = this.store.getConfig().basePath;
		return path.join(basePath, "drift", REJECTION_LOG_FILENAME);
	}

	/**
	 * Ensure the detector is initialized before operations.
	 */
	private async ensureInitialized(): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}
	}

	// -----------------------------------------------------------------------
	// Core detection
	// -----------------------------------------------------------------------

	/**
	 * Check for goal drift given active goals and recent rejections.
	 *
	 * Records the recent rejections in the rejection log, then analyzes
	 * each active goal for drift indicators. If drift is detected, creates
	 * a drift report via the store.
	 *
	 * @param activeGoals - The currently active goals to check
	 * @param recentRejections - Recent proposal rejections, each with the
	 *   rejected proposal (or its metadata) and the IDs of goals the
	 *   proposal was aligned with
	 * @returns Array of newly created GoalDriftReports
	 */
	async checkDrift(
		activeGoals: GoalRecord[],
		recentRejections: Array<{ proposal: unknown; goalIds: string[] }>,
	): Promise<GoalDriftReport[]> {
		await this.ensureInitialized();

		// Record recent rejections
		const now = new Date().toISOString();
		for (const rejection of recentRejections) {
			const proposal = rejection.proposal as Record<string, unknown> | undefined;
			for (const goalId of rejection.goalIds) {
				if (!this.rejectionLog[goalId]) {
					this.rejectionLog[goalId] = [];
				}
				this.rejectionLog[goalId].push({
					timestamp: (proposal?.timestamp as string) ?? now,
					proposalId: (proposal?.id as string) ?? undefined,
					proposalTitle: (proposal?.title as string) ?? undefined,
					reason: (proposal?.reason as string) ?? undefined,
				});
			}
			this.state.rejectionCount += rejection.goalIds.length;
		}
		await this.persistRejectionLog();

		// Analyze each active goal for drift
		const reports: GoalDriftReport[] = [];
		for (const goal of activeGoals) {
			const rejectionHistory = (this.rejectionLog[goal.id] ?? []).map((e) => ({
				proposal:
					e.proposalId || e.proposalTitle
						? { id: e.proposalId, title: e.proposalTitle, timestamp: e.timestamp, reason: e.reason }
						: { reason: e.reason },
				reason: e.reason,
			}));

			const report = await this.analyzeGoalDrift(goal, rejectionHistory);
			if (report) {
				reports.push(report);
				await this.store.createDriftReport(report);
				this.state.lastDriftIds.push(report.id);
			}
		}

		this.state.lastCheck = now;
		await this.persistRejectionLog();
		return reports;
	}

	/**
	 * Analyze a single goal for drift given its rejection history.
	 *
	 * Computes all four drift indicators:
	 * - rejection_pattern: number of rejections exceeds threshold
	 * - proposal_mismatch: rejections cite alignment/priority issues
	 * - stale_goal: goal has not been updated recently
	 * - priority_shift: preferences suggest a shift away from goal priority
	 *
	 * @param goal - The goal record to analyze
	 * @param rejectionHistory - Array of rejection records for this goal
	 * @returns A GoalDriftReport if drift is detected, null otherwise
	 */
	async analyzeGoalDrift(
		goal: GoalRecord,
		rejectionHistory: Array<{ proposal: unknown; reason?: string }>,
	): Promise<GoalDriftReport | null> {
		await this.ensureInitialized();

		const now = new Date().toISOString();
		const windowStart = new Date(Date.now() - this.config.windowDays * 24 * 60 * 60 * 1000).toISOString();

		// Filter rejection history to the configured time window
		const windowedRejections = rejectionHistory.filter((r) => {
			const proposal = r.proposal as Record<string, unknown> | undefined;
			const ts = proposal?.timestamp as string | undefined;
			return !ts || ts >= windowStart;
		});

		const indicators: Array<{
			type: "rejection_pattern" | "proposal_mismatch" | "stale_goal" | "priority_shift";
			details: string;
			evidence: MemorySourceRef[];
			score: number;
		}> = [];

		// 1. Check rejection pattern
		const rejectionIndicators = this.computeRejectionPattern(windowedRejections);
		indicators.push(...rejectionIndicators);

		// 2. Check proposal mismatch
		const mismatchIndicators = this.computeProposalMismatch(goal, windowedRejections);
		indicators.push(...mismatchIndicators);

		// 3. Check staleness
		const stalenessIndicator = this.computeStaleness(goal);
		if (stalenessIndicator) {
			indicators.push(stalenessIndicator);
		}

		// 4. Check priority shift (needs preferences from store)
		const preferences = await this.store.listPreferences();
		const priorityIndicator = this.computePriorityShift(goal, preferences);
		if (priorityIndicator) {
			indicators.push(priorityIndicator);
		}

		if (indicators.length === 0) return null;

		// Determine severity based on indicator scores
		const severity = this.computeSeverity(indicators);

		const report = createGoalDriftReport();
		report.goalId = goal.id;
		report.goalTitle = goal.title;
		report.severity = severity;
		report.indicators = indicators;
		report.generatedAt = now;

		return report;
	}

	// -----------------------------------------------------------------------
	// Indicator computation
	// -----------------------------------------------------------------------

	/**
	 * Compute rejection pattern indicators.
	 *
	 * Triggers when the number of rejections within the time window meets
	 * or exceeds the configured rejection threshold.
	 */
	private computeRejectionPattern(
		rejections: Array<{ proposal: unknown; reason?: string }>,
	): Array<{ type: "rejection_pattern"; details: string; evidence: MemorySourceRef[]; score: number }> {
		if (rejections.length >= this.config.rejectionThreshold) {
			const evidence: MemorySourceRef[] = rejections
				.filter((r) => {
					const p = r.proposal as Record<string, unknown> | undefined;
					return p?.id && typeof p.id === "string";
				})
				.map((r) => {
					const p = r.proposal as Record<string, unknown>;
					return {
						type: "observation" as const,
						path: ".pi/brain/proposals/rejection-log.json",
						id: p.id as string,
						timestamp: (p.timestamp as string) ?? undefined,
					};
				});

			return [
				{
					type: "rejection_pattern",
					details: `${rejections.length} proposals aligned with this goal were rejected. This meets or exceeds the threshold of ${this.config.rejectionThreshold} within the ${this.config.windowDays}-day window.`,
					evidence,
					score: Math.min(rejections.length / (this.config.rejectionThreshold * 2), 1),
				},
			];
		}
		return [];
	}

	/**
	 * Compute proposal mismatch indicators.
	 *
	 * Triggers when rejections cite alignment, relevance, priority, or
	 * off-topic reasons, and the fraction exceeds the mismatch threshold.
	 */
	private computeProposalMismatch(
		goal: GoalRecord,
		rejections: Array<{ proposal: unknown; reason?: string }>,
	): Array<{ type: "proposal_mismatch"; details: string; evidence: MemorySourceRef[]; score: number }> {
		if (rejections.length === 0) return [];

		const mismatchReasons = rejections.filter((r) => {
			const reason = r.reason?.toLowerCase() ?? "";
			return (
				reason.includes("not aligned") ||
				reason.includes("mismatch") ||
				reason.includes("irrelevant") ||
				reason.includes("off-topic") ||
				reason.includes("wrong priority") ||
				reason.includes("not relevant") ||
				reason.includes("doesn't align") ||
				reason.includes("misalignment")
			);
		});

		if (
			mismatchReasons.length >= Math.ceil(this.config.mismatchThreshold * rejections.length) &&
			rejections.length > 0
		) {
			const evidence: MemorySourceRef[] = mismatchReasons
				.filter((r) => {
					const p = r.proposal as Record<string, unknown> | undefined;
					return p?.id && typeof p.id === "string";
				})
				.map((r) => {
					const p = r.proposal as Record<string, unknown>;
					return {
						type: "observation" as const,
						path: ".pi/brain/proposals/inbox.json",
						id: p.id as string,
					};
				});

			return [
				{
					type: "proposal_mismatch",
					details: `${mismatchReasons.length} of ${rejections.length} rejected proposals cited alignment or relevance issues with goal "${goal.title}". This suggests proposals are not aligned with the goal's intent.`,
					evidence,
					score: Math.min(mismatchReasons.length / Math.max(rejections.length, 1), 1),
				},
			];
		}
		return [];
	}

	/**
	 * Compute goal staleness indicator.
	 *
	 * Triggers when a goal has not been updated for more than twice the
	 * configured window days.
	 */
	private computeStaleness(
		goal: GoalRecord,
	): { type: "stale_goal"; details: string; evidence: MemorySourceRef[]; score: number } | null {
		const updatedAt = new Date(goal.updatedAt).getTime();
		const daysSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);

		if (daysSinceUpdate > this.config.windowDays * 2) {
			const evidence: MemorySourceRef[] = [
				{
					type: "observation",
					path: `.pi/brain/goals/goal_${goal.id}.json`,
					id: goal.id,
					timestamp: goal.updatedAt,
				},
			];

			return {
				type: "stale_goal",
				details: `Goal "${goal.title}" has not been updated in ${Math.round(daysSinceUpdate)} days (last updated: ${goal.updatedAt}). Consider reviewing whether this goal is still relevant.`,
				evidence,
				score: Math.min(daysSinceUpdate / (this.config.windowDays * 4), 1),
			};
		}
		return null;
	}

	/**
	 * Compute priority shift indicator.
	 *
	 * Triggers when user preferences suggest a shift away from the goal's
	 * priority level, combined with a significant number of rejections.
	 */
	private computePriorityShift(
		goal: GoalRecord,
		preferences: PreferenceRecord[],
	): { type: "priority_shift"; details: string; evidence: MemorySourceRef[]; score: number } | null {
		// Look for preferences that might indicate a priority shift
		const priorityPrefs = preferences.filter(
			(p) =>
				(p.category === "execution" || p.category === "planning") &&
				(p.key.toLowerCase().includes("priority") || p.key.toLowerCase().includes("focus")),
		);

		if (priorityPrefs.length === 0) return null;

		// If user preferences explicitly deprioritize the goal's category/priority
		const deprioritizingPrefs = priorityPrefs.filter((p) => {
			const val = typeof p.value === "string" ? p.value.toLowerCase() : "";
			return (
				val.includes(goal.priority === "critical" ? "low priority" : goal.priority === "high" ? "medium" : "low") ||
				val.includes("don't focus") ||
				val.includes("not important")
			);
		});

		if (deprioritizingPrefs.length > 0) {
			const evidence: MemorySourceRef[] = deprioritizingPrefs.map((p) => ({
				type: "observation" as const,
				path: `.pi/brain/goals/pref_${p.id}.json`,
				id: p.id,
			}));

			return {
				type: "priority_shift",
				details: `User preferences suggest a shift away from "${goal.title}" (priority: ${goal.priority}). ${deprioritizingPrefs.length} preference(s) indicate reduced priority focus.`,
				evidence,
				score: Math.min(deprioritizingPrefs.length / 3, 1),
			};
		}

		return null;
	}

	// -----------------------------------------------------------------------
	// Severity
	// -----------------------------------------------------------------------

	/**
	 * Compute the overall severity of a drift report from its indicators.
	 *
	 * Severity is based on the maximum indicator score:
	 * - >= 0.8 → "high"
	 * - >= 0.4 → "medium"
	 * - < 0.4 → "low"
	 */
	private computeSeverity(
		indicators: Array<{ type: string; details: string; evidence: MemorySourceRef[]; score: number }>,
	): "low" | "medium" | "high" {
		const maxScore = Math.max(...indicators.map((i) => i.score), 0);
		if (maxScore >= 0.8) return "high";
		if (maxScore >= 0.4) return "medium";
		return "low";
	}

	// -----------------------------------------------------------------------
	// Proposal creation
	// -----------------------------------------------------------------------

	/**
	 * Create a drift proposal for a given drift report.
	 *
	 * Persists the drift report via the store and generates a synthetic
	 * proposal ID. In a full implementation, this would also create a
	 * proposal in the upstream proposal system.
	 *
	 * @param report - The drift report to create a proposal for
	 * @returns An object containing the stored drift report and a proposal ID
	 */
	async createDriftProposal(report: GoalDriftReport): Promise<{ drift: GoalDriftReport; proposalId?: string }> {
		const stored = await this.store.createDriftReport(report);
		const proposalId = `drift-review-${report.id}`;
		return { drift: stored, proposalId };
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	/**
	 * Update the detector configuration.
	 *
	 * @param config - Partial configuration to merge with existing
	 */
	setConfig(config: Partial<DriftDetectorConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * Get the current detector configuration.
	 *
	 * @returns A copy of the current configuration
	 */
	getConfig(): DriftDetectorConfig {
		return { ...this.config };
	}

	// -----------------------------------------------------------------------
	// Scheduled check
	// -----------------------------------------------------------------------

	/**
	 * Run a scheduled drift check on all active goals.
	 *
	 * Uses the stored rejection log to build rejection history for each
	 * active goal. Skips goals that already have an unresolved drift report.
	 *
	 * Respects the check interval — if the last check was less than
	 * `checkIntervalHours` ago, returns an empty array.
	 *
	 * @returns Array of newly created GoalDriftReports
	 */
	async runScheduledCheck(): Promise<GoalDriftReport[]> {
		await this.ensureInitialized();

		const now = new Date().toISOString();

		// Check if enough time has passed since last check
		if (this.state.lastCheck) {
			const lastCheckTime = new Date(this.state.lastCheck).getTime();
			const hoursSinceCheck = (Date.now() - lastCheckTime) / (1000 * 60 * 60);
			if (hoursSinceCheck < this.config.checkIntervalHours) {
				return [];
			}
		}

		// Get all active goals
		const activeGoals = await this.store.listGoals({ status: "active" });

		// Analyze each active goal
		const allReports: GoalDriftReport[] = [];
		for (const goal of activeGoals) {
			const rejectionHistory = (this.rejectionLog[goal.id] ?? []).map((e) => ({
				proposal:
					e.proposalId || e.proposalTitle
						? { id: e.proposalId, title: e.proposalTitle, timestamp: e.timestamp, reason: e.reason }
						: { reason: e.reason },
				reason: e.reason,
			}));

			const report = await this.analyzeGoalDrift(goal, rejectionHistory);
			if (report) {
				// Check if we already have an unresolved drift report for this goal
				const existingReports = await this.store.listDriftReports(goal.id);
				const hasUnresolved = existingReports.some((r) => !r.resolvedAt);

				if (!hasUnresolved) {
					allReports.push(report);
					await this.store.createDriftReport(report);
					this.state.lastDriftIds.push(report.id);
				}
			}
		}

		this.state.lastCheck = now;
		await this.persistRejectionLog();
		return allReports;
	}

	/**
	 * Get the current check state.
	 *
	 * @returns A copy of the current DriftCheckState
	 */
	getState(): DriftCheckState {
		return { ...this.state };
	}

	/**
	 * Get a copy of the current rejection log.
	 *
	 * @returns A shallow copy of the rejection log
	 */
	getRejectionLog(): GoalRejectionLog {
		return { ...this.rejectionLog };
	}
}
