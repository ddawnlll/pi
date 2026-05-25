/**
 * Brain-related TypeScript interfaces for the V2 second-brain dashboard.
 *
 * These types mirror the backend API responses from P13-P18 + P20 endpoints.
 */

// =========================================================================
// Common
// =========================================================================

export interface PaginatedResponse<T> {
	data: T[];
	total: number;
	limit: number;
	offset: number;
}

export interface ApiError {
	error: string;
	message?: string;
	details?: string;
}

// =========================================================================
// Daemon / Brain State (P13)
// =========================================================================

export type DaemonState = "running" | "stopped" | "paused" | "error";

export interface DaemonStatus {
	state: DaemonState;
	uptime: string;
	observationCount: number;
	lastHeartbeat: string | null;
}

export type ObservationSeverity = "info" | "warning" | "critical";

export interface BrainObservation {
	id: string;
	title: string;
	description: string;
	severity: ObservationSeverity;
	source: string;
	timestamp: string;
	resolved: boolean;
	tags?: string[];
}

export type SignalType =
	| "queue_blocked"
	| "integration_dirty"
	| "merge_conflict"
	| "policy_violation"
	| "memory_pressure"
	| "daemon_heartbeat_missed"
	| "workspace_failure"
	| "other";

export interface BrainSignal {
	id: string;
	type: SignalType;
	title: string;
	severity: ObservationSeverity;
	timestamp: string;
	resolved: boolean;
	resolvedAt?: string;
	details?: string;
}

export interface BrainStateData {
	daemon: DaemonStatus;
	observationStats: {
		total: number;
		bySeverity: Record<ObservationSeverity, number>;
	};
	signalStats: {
		total: number;
		active: number;
		resolved: number;
		byType: Record<string, number>;
	};
}

export interface TimelineEvent {
	id: string;
	type: string;
	severity: ObservationSeverity;
	title: string;
	description?: string;
	timestamp: string;
	source?: string;
}

// =========================================================================
// Memory (P14)
// =========================================================================

export type MemoryType =
	| "failure_memory"
	| "success_memory"
	| "user_preference_memory"
	| "workflow_memory"
	| "observation_memory"
	| "context_memory"
	| "custom";

export type MemoryLifecycle = "active" | "candidate" | "rejected";

export interface MemoryRecord {
	id: string;
	title: string;
	content: string;
	type: MemoryType;
	lifecycle: MemoryLifecycle;
	confidence: number;
	tags: string[];
	source?: string;
	createdAt: string;
	updatedAt: string;
	provenance?: {
		planExecId?: string;
		workspaceId?: string;
		observationId?: string;
	};
}

export interface MemoryStats {
	total: number;
	byType: Record<string, number>;
	byLifecycle: Record<string, number>;
	averageConfidence: number;
}

// =========================================================================
// Proposals (P16)
// =========================================================================

export type ProposalStatus = "pending" | "approved" | "rejected" | "corrected";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface Proposal {
	id: string;
	title: string;
	description: string;
	score: number;
	riskLevel: RiskLevel;
	status: ProposalStatus;
	evidence: {
		memories: number;
		observations: number;
	};
	createdAt: string;
	updatedAt?: string;
	rejectionReason?: string;
	corrections?: Record<string, unknown>;
}

export interface InboxView {
	pending: Proposal[];
	totalPending: number;
	total: number;
}

export interface ProposalStats {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
	averageScore: number;
}

// =========================================================================
// Goals (P15)
// =========================================================================

export type GoalStatus = "active" | "paused" | "complete" | "review";
export type GoalPriority = "critical" | "high" | "normal" | "low";

export interface Milestone {
	id: string;
	title: string;
	completed: boolean;
	completedAt?: string;
}

export interface GoalRecord {
	id: string;
	title: string;
	description?: string;
	status: GoalStatus;
	priority: GoalPriority;
	milestones: Milestone[];
	progress: number; // 0-100
	createdAt: string;
	updatedAt?: string;
	completedAt?: string;
}

export interface GoalStats {
	total: number;
	byStatus: Record<string, number>;
	byPriority: Record<string, number>;
	averageProgress?: number;
}

export interface GoalDriftReport {
	goalId: string;
	goalTitle: string;
	drifted: boolean;
	reason?: string;
	lastProgress: number;
	lastUpdated: string;
}

// =========================================================================
// Autonomy (P15)
// =========================================================================

export interface AutonomyProfile {
	level: number;
	levelLabel: string;
	emergencyStop: boolean;
	approvedActions: number;
	blockedActions: number;
	lastUpdated: string;
}

// =========================================================================
// Policy (P18)
// =========================================================================

export interface PolicyRule {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	effect: "allow" | "deny" | "require_approval";
	priority: number;
	createdAt: string;
	updatedAt?: string;
}

export interface PolicyResult {
	allowed: boolean;
	reason?: string;
	requiresApproval: boolean;
	matchedRule?: string;
}

// =========================================================================
// Approvals (P18)
// =========================================================================

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
	id: string;
	title: string;
	description: string;
	action: string;
	status: ApprovalStatus;
	requestedBy: string;
	requestedAt: string;
	decidedAt?: string;
	rejectionReason?: string;
}

export interface ApprovalStats {
	total: number;
	pending: number;
	approved: number;
	rejected: number;
	todayApproved: number;
	todayTotal: number;
}

// =========================================================================
// Audit (P18)
// =========================================================================

export interface AuditEntry {
	id: string;
	action: string;
	actor: string;
	target: string;
	details?: string;
	timestamp: string;
	approved: boolean;
	provenance?: Record<string, unknown>;
}

export interface AuditStats {
	total: number;
	today: number;
	byAction: Record<string, number>;
	approvalRate: number;
}

// =========================================================================
// Reflections (P17)
// =========================================================================

export interface ReflectionReport {
	planExecId: string;
	planTitle: string;
	phase: string;
	timestamp: string;
	summary: string;
	worked: string[];
	failed: string[];
	memoryProposals: number;
	suggestions: number;
	memoriesCreated: number;
}

// =========================================================================
// Overnight (P20)
// =========================================================================

export type OvernightStatus = "queued" | "running" | "completed" | "cancelled" | "failed";

export interface OvernightSession {
	id: string;
	status: OvernightStatus;
	queueSelection: string[];
	autonomyLevel: number;
	maxDurationHours: number;
	stopConditions: string[];
	startedAt?: string;
	completedAt?: string;
	plansCompleted: number;
	totalPlans: number;
	error?: string;
}

// =========================================================================
// Feedback (24.J — Feedback Loop)
// =========================================================================

export type FeedbackRating = 1 | -1;

export type FeedbackItemType =
	| "digest_entry"
	| "signal"
	| "observation"
	| "proposal"
	| "goal"
	| "memory"
	| "reflection"
	| "plan_result";

export interface FeedbackEntry {
	id: string;
	itemType: FeedbackItemType;
	itemId: string;
	itemTitle: string;
	rating: FeedbackRating;
	comment: string;
	applied: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface FeedbackStats {
	total: number;
	positive: number;
	negative: number;
	unapplied: number;
	byType: Record<string, { total: number; positive: number; negative: number }>;
}

export interface FeedbackQueryResult {
	entries: FeedbackEntry[];
	total: number;
}

// =========================================================================
// Morning Digest
// =========================================================================

export interface MorningDigest {
	summary: {
		daemonState: DaemonState;
		daemonUptime: string;
		totalObservations: number;
		criticalObservations: number;
		activeSignals: number;
		pendingProposals: number;
		lastUpdated: string;
	};
	topSignals: BrainSignal[];
	recentObservations: BrainObservation[];
	pendingProposals: Proposal[];
	goalProgress: Array<{
		id: string;
		title: string;
		progress: number;
		status: GoalStatus;
		priority: GoalPriority;
	}>;
	reflectionCounts: {
		total: number;
		today: number;
		newMemories: number;
	};
}
