export type { DogfoodReport } from "./dogfood-report.js";
export { DogfoodReportGenerator } from "./dogfood-report.js";
export type {
	ArtifactLink,
	MorningReport,
	MorningReportAuditLedger,
	MorningReportData,
	MorningReportMemoryStore,
	MorningReportObservationEngine,
	MorningReportReflectionEngine,
	PlanRunSummary,
	TopProposal,
	WhatRanEntry,
	WhatStoppedEntry,
} from "./morning-report.js";
export { MorningReportGenerator } from "./morning-report.js";
export type {
	OvernightConfig,
	OvernightStatus,
	OvernightStopCondition,
	PlanQueueRef,
	RunProgress,
	RunSession,
	RunStatus,
} from "./orchestrator.js";
export { OvernightOrchestrator } from "./orchestrator.js";
export type {
	FindingSeverity,
	Trend,
	TrustAssessment,
	TrustCriterion,
	TrustDimension,
	TrustFinding,
	TrustStatus,
} from "./trust-assessment.js";
export { TrustAssessor } from "./trust-assessment.js";
export type {
	ScenarioResult,
	ValidationCheck,
	ValidationCheckResult,
	ValidationResult,
	ValidationScenario,
} from "./validation.js";
export { FullLoopValidator } from "./validation.js";

export const DEFAULT_OVERNIGHT_CONFIG = {
	maxDurationHours: 8,
	autonomyLevel: 3,
	stopConditions: ["max_duration_reached"],
	notificationEnabled: true,
	generateMorningReport: true,
	planExecIds: [],
};

/**
 * In-memory session store for overnight execution tracking.
 *
 * NOTE: Sessions are NOT persisted to disk. After a process restart
 * all session history is lost. This is intentional for single-process
 * overnight runs where the lifetime of sessions matches the process
 * lifetime. For durable storage, extend or wrap this class with a
 * file-backed store (e.g. JSON file persistence similar to MemoryStore).
 */
export class SessionStore {
	private sessions: Map<string, unknown> = new Map();

	add(session: { id: string; [key: string]: unknown }): void {
		this.sessions.set(session.id, session);
	}

	get(id: string): unknown {
		return this.sessions.get(id) ?? null;
	}

	list(): unknown[] {
		return Array.from(this.sessions.values());
	}

	/** Update a session by ID with partial fields. Returns null if not found. */
	update(id: string, updates: Record<string, unknown>): unknown | null {
		const existing = this.sessions.get(id);
		if (!existing) return null;
		const updated = { ...(existing as Record<string, unknown>), ...updates, id };
		this.sessions.set(id, updated);
		return updated;
	}

	/** Return all sessions, newest first, limited to `limit` entries. */
	getAll(limit?: number): unknown[] {
		const all = Array.from(this.sessions.values()) as Array<Record<string, unknown>>;
		const sorted = all.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
		return sorted.slice(0, limit ?? sorted.length);
	}

	/** Remove a session by ID. */
	remove(id: string): void {
		this.sessions.delete(id);
	}

	/** Remove all sessions. */
	clear(): void {
		this.sessions.clear();
	}
}
