/**
 * Brain API Client — unified client for all V2 second-brain endpoints.
 *
 * Provides typed methods for:
 * - Brain state / timeline / observations / signals (P13)
 * - Memory CRUD (P14)
 * - Goals / autonomy / drift (P15)
 * - Proposals / inbox (P16)
 * - Reflections (P17)
 * - Policy / audit / approvals / emergency stop (P18)
 * - Overnight runs (P20)
 */

import type {
	AutonomyProfile,
	ApprovalRequest,
	ApprovalStats,
	AuditEntry,
	AuditStats,
	BrainObservation,
	BrainSignal,
	BrainStateData,
	DaemonState,
	GoalDriftReport,
	GoalRecord,
	GoalStats,
	InboxView,
	MemoryRecord,
	MemoryStats,
	OvernightSession,
	PolicyResult,
	PolicyRule,
	Proposal,
	ProposalStats,
	ReflectionReport,
	TimelineEvent,
} from "../types-brain.js";

const BASE = "";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${url}`, {
		headers: { "Content-Type": "application/json", ...options?.headers },
		...options,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API ${res.status}: ${body || res.statusText}`);
	}
	// 204 No Content
	if (res.status === 204) return undefined as T;
	return res.json();
}

export class BrainClient {
	// =========================================================================
	// State (P13)
	// =========================================================================

	async getState(): Promise<BrainStateData> {
		return apiFetch<BrainStateData>("/api/brain/state");
	}

	async getTimeline(params?: {
		limit?: number;
		offset?: number;
		severity?: string;
	}): Promise<{ events: TimelineEvent[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.severity) qs.set("severity", params.severity);
		return apiFetch(`/api/brain/timeline?${qs}`);
	}

	async getObservations(params?: {
		limit?: number;
		offset?: number;
		severity?: string;
	}): Promise<{ observations: BrainObservation[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.severity) qs.set("severity", params.severity);
		return apiFetch(`/api/brain/observations?${qs}`);
	}

	async getSignals(params?: {
		limit?: number;
		offset?: number;
		resolved?: boolean;
	}): Promise<{ signals: BrainSignal[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.resolved !== undefined) qs.set("resolved", String(params.resolved));
		return apiFetch(`/api/brain/signals?${qs}`);
	}

	// =========================================================================
	// Memory (P14)
	// =========================================================================

	async getMemories(params?: {
		limit?: number;
		offset?: number;
		search?: string;
		type?: string;
		lifecycle?: string;
		tags?: string[];
	}): Promise<{ memories: MemoryRecord[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.search) qs.set("search", params.search);
		if (params?.type) qs.set("type", params.type);
		if (params?.lifecycle) qs.set("lifecycle", params.lifecycle);
		if (params?.tags?.length) qs.set("tags", params.tags.join(","));
		return apiFetch(`/api/brain/memories?${qs}`);
	}

	async getMemory(id: string): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`/api/brain/memories/${encodeURIComponent(id)}`);
	}

	async createMemory(data: {
		title: string;
		content: string;
		type?: string;
		tags?: string[];
		confidence?: number;
	}): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>("/api/brain/memories", {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async updateMemory(id: string, data: Partial<MemoryRecord>): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`/api/brain/memories/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	async deleteMemory(id: string): Promise<void> {
		return apiFetch<void>(`/api/brain/memories/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}

	async rejectMemory(id: string): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`/api/brain/memories/${encodeURIComponent(id)}/reject`, {
			method: "POST",
		});
	}

	async activateMemory(id: string): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`/api/brain/memories/${encodeURIComponent(id)}/activate`, {
			method: "POST",
		});
	}

	async getMemoryStats(): Promise<MemoryStats> {
		return apiFetch<MemoryStats>("/api/brain/memories/stats");
	}

	// =========================================================================
	// Proposals (P16)
	// =========================================================================

	async getProposalInbox(): Promise<InboxView> {
		return apiFetch<InboxView>("/api/brain/proposals/inbox");
	}

	async getProposals(params?: {
		limit?: number;
		offset?: number;
		status?: string;
	}): Promise<{ proposals: Proposal[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.status) qs.set("status", params.status);
		return apiFetch(`/api/brain/proposals?${qs}`);
	}

	async getProposal(id: string): Promise<Proposal> {
		return apiFetch<Proposal>(`/api/brain/proposals/${encodeURIComponent(id)}`);
	}

	async acceptProposal(id: string): Promise<Proposal> {
		return apiFetch<Proposal>(`/api/brain/proposals/${encodeURIComponent(id)}/accept`, {
			method: "POST",
		});
	}

	async rejectProposal(id: string, reason?: string): Promise<Proposal> {
		return apiFetch<Proposal>(`/api/brain/proposals/${encodeURIComponent(id)}/reject`, {
			method: "POST",
			body: JSON.stringify({ reason }),
		});
	}

	async correctProposal(id: string, corrections: Record<string, unknown>): Promise<Proposal> {
		return apiFetch<Proposal>(`/api/brain/proposals/${encodeURIComponent(id)}/correct`, {
			method: "POST",
			body: JSON.stringify(corrections),
		});
	}

	async getProposalStats(): Promise<ProposalStats> {
		return apiFetch<ProposalStats>("/api/brain/proposals/stats");
	}

	// =========================================================================
	// Goals (P15)
	// =========================================================================

	async getGoals(params?: { status?: string }): Promise<GoalRecord[]> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set("status", params.status);
		return apiFetch<GoalRecord[]>(`/api/brain/goals?${qs}`);
	}

	async getGoal(id: string): Promise<GoalRecord> {
		return apiFetch<GoalRecord>(`/api/brain/goals/${encodeURIComponent(id)}`);
	}

	async createGoal(data: {
		title: string;
		description?: string;
		priority?: string;
		milestones?: string[];
	}): Promise<GoalRecord> {
		return apiFetch<GoalRecord>("/api/brain/goals", {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async updateGoal(id: string, data: Partial<GoalRecord>): Promise<GoalRecord> {
		return apiFetch<GoalRecord>(`/api/brain/goals/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	async deleteGoal(id: string): Promise<void> {
		return apiFetch<void>(`/api/brain/goals/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}

	async completeGoal(id: string): Promise<GoalRecord> {
		return apiFetch<GoalRecord>(`/api/brain/goals/${encodeURIComponent(id)}/complete`, {
			method: "POST",
		});
	}

	async getGoalStats(): Promise<GoalStats> {
		return apiFetch<GoalStats>("/api/brain/goals/stats");
	}

	async getDriftReports(): Promise<GoalDriftReport[]> {
		return apiFetch<GoalDriftReport[]>("/api/brain/goals/drift");
	}

	// =========================================================================
	// Autonomy (P15)
	// =========================================================================

	async getAutonomyProfile(): Promise<AutonomyProfile> {
		return apiFetch<AutonomyProfile>("/api/brain/autonomy");
	}

	async updateAutonomyProfile(data: Partial<AutonomyProfile>): Promise<AutonomyProfile> {
		return apiFetch<AutonomyProfile>("/api/brain/autonomy", {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	async emergencyStop(): Promise<void> {
		return apiFetch<void>("/api/brain/autonomy/emergency-stop", { method: "POST" });
	}

	async releaseStop(): Promise<void> {
		return apiFetch<void>("/api/brain/autonomy/release-stop", { method: "POST" });
	}

	async getEmergencyStatus(): Promise<{ stopped: boolean }> {
		return apiFetch<{ stopped: boolean }>("/api/brain/autonomy/emergency-status");
	}

	// =========================================================================
	// Policy (P18)
	// =========================================================================

	async getPolicyRules(): Promise<PolicyRule[]> {
		return apiFetch<PolicyRule[]>("/api/brain/policy/rules");
	}

	async toggleRule(id: string): Promise<PolicyRule> {
		return apiFetch<PolicyRule>(`/api/brain/policy/rules/${encodeURIComponent(id)}/toggle`, {
			method: "POST",
		});
	}

	async evaluateAction(data: { action: string; context?: Record<string, unknown> }): Promise<PolicyResult> {
		return apiFetch<PolicyResult>("/api/brain/policy/evaluate", {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	// =========================================================================
	// Approvals (P18)
	// =========================================================================

	async getApprovals(params?: {
		limit?: number;
		offset?: number;
		status?: string;
	}): Promise<{ approvals: ApprovalRequest[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.status) qs.set("status", params.status);
		return apiFetch(`/api/brain/approvals?${qs}`);
	}

	async approve(id: string): Promise<ApprovalRequest> {
		return apiFetch<ApprovalRequest>(`/api/brain/approvals/${encodeURIComponent(id)}/approve`, {
			method: "POST",
		});
	}

	async rejectApproval(id: string, reason?: string): Promise<ApprovalRequest> {
		return apiFetch<ApprovalRequest>(`/api/brain/approvals/${encodeURIComponent(id)}/reject`, {
			method: "POST",
			body: JSON.stringify({ reason }),
		});
	}

	async getApprovalStats(): Promise<ApprovalStats> {
		return apiFetch<ApprovalStats>("/api/brain/approvals/stats");
	}

	// =========================================================================
	// Reflections (P17)
	// =========================================================================

	async getReflections(): Promise<ReflectionReport[]> {
		return apiFetch<ReflectionReport[]>("/api/brain/reflections");
	}

	async getReflection(planExecId: string): Promise<ReflectionReport> {
		return apiFetch<ReflectionReport>(`/api/brain/reflections/${encodeURIComponent(planExecId)}`);
	}

	async getReflectionStats(): Promise<{
		total: number;
		memoriesCreated: number;
		suggestionsGenerated: number;
	}> {
		return apiFetch("/api/brain/reflections/stats");
	}

	// =========================================================================
	// Audit (P18)
	// =========================================================================

	async getAuditEntries(params?: {
		limit?: number;
		offset?: number;
		action?: string;
	}): Promise<{ entries: AuditEntry[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.action) qs.set("action", params.action);
		return apiFetch(`/api/brain/audit?${qs}`);
	}

	async getAuditStats(): Promise<AuditStats> {
		return apiFetch<AuditStats>("/api/brain/audit/stats");
	}

	async getProvenance(targetId: string): Promise<Record<string, unknown>> {
		return apiFetch(`/api/brain/audit/provenance/${encodeURIComponent(targetId)}`);
	}

	async explainDecision(targetId: string): Promise<string> {
		const res = await apiFetch<{ explanation: string }>(
			`/api/brain/audit/explain/${encodeURIComponent(targetId)}`,
		);
		return res.explanation;
	}

	// =========================================================================
	// Overnight (P20)
	// =========================================================================

	async queueOvernight(config: {
		queueSelection: string[];
		autonomyLevel: number;
		maxDurationHours: number;
		stopConditions: string[];
	}): Promise<{ sessionId: string }> {
		return apiFetch<{ sessionId: string }>("/api/brain/overnight/queue", {
			method: "POST",
			body: JSON.stringify(config),
		});
	}

	async getOvernightStatus(sessionId: string): Promise<OvernightSession> {
		return apiFetch<OvernightSession>(`/api/brain/overnight/${encodeURIComponent(sessionId)}`);
	}

	async getOvernightHistory(): Promise<OvernightSession[]> {
		return apiFetch<OvernightSession[]>("/api/brain/overnight/history");
	}

	async cancelOvernight(sessionId: string): Promise<void> {
		return apiFetch<void>(`/api/brain/overnight/${encodeURIComponent(sessionId)}/cancel`, {
			method: "POST",
		});
	}
}

/** Singleton instance */
export const brainClient = new BrainClient();
