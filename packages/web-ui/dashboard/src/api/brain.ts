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
 *
 * P22.B: All methods accept an optional projectId parameter.
 * When provided, API calls are scoped to /api/projects/:projectId/brain/...
 * When omitted, they fall back to global /api/brain/... (legacy).
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
	FeedbackEntry,
	FeedbackItemType,
	FeedbackQueryResult,
	FeedbackStats,
	GoalDriftReport,
	GoalRecord,
	GoalStats,
	InboxView,
	MemoryRecord,
	MemoryStats,
	MorningDigest,
	OvernightSession,
	PolicyResult,
	PolicyRule,
	Proposal,
	ProposalStats,
	ReflectionReport,
	TimelineEvent,
} from "../types-brain.js";

const BASE = "";

/**
 * Build a brain API URL, scoped to a project if projectId is provided.
 *
 * @param path - The API path relative to the brain prefix (e.g., "/state")
 * @param projectId - Optional project ID for project-scoped routes
 * @returns The full API URL
 */
function brainUrl(path: string, projectId?: string | null): string {
	const prefix = projectId
		? `/api/projects/${encodeURIComponent(projectId)}/brain`
		: "/api/brain";
	return `${BASE}${prefix}${path}`;
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, {
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

	async getState(projectId?: string | null): Promise<BrainStateData> {
		return apiFetch<BrainStateData>(brainUrl("/state", projectId));
	}

	async getTimeline(
		params?: {
			limit?: number;
			offset?: number;
			severity?: string;
		},
		projectId?: string | null,
	): Promise<{ events: TimelineEvent[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.severity) qs.set("severity", params.severity);
		return apiFetch(`${brainUrl("/timeline", projectId)}?${qs}`);
	}

	async getObservations(
		params?: {
			limit?: number;
			offset?: number;
			severity?: string;
		},
		projectId?: string | null,
	): Promise<{ observations: BrainObservation[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.severity) qs.set("severity", params.severity);
		return apiFetch(`${brainUrl("/observations", projectId)}?${qs}`);
	}

	async getSignals(
		params?: {
			limit?: number;
			offset?: number;
			resolved?: boolean;
		},
		projectId?: string | null,
	): Promise<{ signals: BrainSignal[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.resolved !== undefined) qs.set("resolved", String(params.resolved));
		return apiFetch(`${brainUrl("/signals", projectId)}?${qs}`);
	}

	// =========================================================================
	// Memory (P14)
	// =========================================================================

	async getMemories(
		params?: {
			limit?: number;
			offset?: number;
			search?: string;
			type?: string;
			lifecycle?: string;
			tags?: string[];
		},
		projectId?: string | null,
	): Promise<{ memories: MemoryRecord[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.search) qs.set("search", params.search);
		if (params?.type) qs.set("type", params.type);
		if (params?.lifecycle) qs.set("lifecycle", params.lifecycle);
		if (params?.tags?.length) qs.set("tags", params.tags.join(","));
		return apiFetch(`${brainUrl("/memories", projectId)}?${qs}`);
	}

	async getMemory(id: string, projectId?: string | null): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`${brainUrl("/memories", projectId)}/${encodeURIComponent(id)}`);
	}

	async createMemory(
		data: {
			title: string;
			content: string;
			type?: string;
			tags?: string[];
			confidence?: number;
		},
		projectId?: string | null,
	): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(brainUrl("/memories", projectId), {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async updateMemory(id: string, data: Partial<MemoryRecord>, projectId?: string | null): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`${brainUrl("/memories", projectId)}/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	async deleteMemory(id: string, projectId?: string | null): Promise<void> {
		return apiFetch<void>(`${brainUrl("/memories", projectId)}/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}

	async rejectMemory(id: string, projectId?: string | null): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`${brainUrl("/memories", projectId)}/${encodeURIComponent(id)}/reject`, {
			method: "POST",
		});
	}

	async activateMemory(id: string, projectId?: string | null): Promise<MemoryRecord> {
		return apiFetch<MemoryRecord>(`${brainUrl("/memories", projectId)}/${encodeURIComponent(id)}/activate`, {
			method: "POST",
		});
	}

	async getMemoryStats(projectId?: string | null): Promise<MemoryStats> {
		return apiFetch<MemoryStats>(brainUrl("/memories/stats", projectId));
	}

	// =========================================================================
	// Proposals (P16)
	// =========================================================================

	async getProposalInbox(projectId?: string | null): Promise<InboxView> {
		return apiFetch<InboxView>(brainUrl("/proposals/inbox", projectId));
	}

	async getProposals(
		params?: {
			limit?: number;
			offset?: number;
			status?: string;
		},
		projectId?: string | null,
	): Promise<{ proposals: Proposal[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.status) qs.set("status", params.status);
		return apiFetch(`${brainUrl("/proposals", projectId)}?${qs}`);
	}

	async getProposal(id: string, projectId?: string | null): Promise<Proposal> {
		return apiFetch<Proposal>(`${brainUrl("/proposals", projectId)}/${encodeURIComponent(id)}`);
	}

	async acceptProposal(id: string, projectId?: string | null): Promise<Proposal> {
		return apiFetch<Proposal>(`${brainUrl("/proposals", projectId)}/${encodeURIComponent(id)}/accept`, {
			method: "POST",
		});
	}

	async rejectProposal(id: string, reason?: string, projectId?: string | null): Promise<Proposal> {
		return apiFetch<Proposal>(`${brainUrl("/proposals", projectId)}/${encodeURIComponent(id)}/reject`, {
			method: "POST",
			body: JSON.stringify({ reason }),
		});
	}

	async correctProposal(id: string, corrections: Record<string, unknown>, projectId?: string | null): Promise<Proposal> {
		return apiFetch<Proposal>(`${brainUrl("/proposals", projectId)}/${encodeURIComponent(id)}/correct`, {
			method: "POST",
			body: JSON.stringify(corrections),
		});
	}

	async getProposalStats(projectId?: string | null): Promise<ProposalStats> {
		return apiFetch<ProposalStats>(brainUrl("/proposals/stats", projectId));
	}

	// =========================================================================
	// Goals (P15)
	// =========================================================================

	async getGoals(
		params?: { status?: string },
		projectId?: string | null,
	): Promise<GoalRecord[]> {
		const qs = new URLSearchParams();
		if (params?.status) qs.set("status", params.status);
		const data = await apiFetch<{ goals: GoalRecord[] }>(`${brainUrl("/goals", projectId)}?${qs}`);
		return data.goals ?? [];
	}

	async getGoal(id: string, projectId?: string | null): Promise<GoalRecord> {
		const data = await apiFetch<{ goal: GoalRecord }>(`${brainUrl("/goals", projectId)}/${encodeURIComponent(id)}`);
		return data.goal;
	}

	async createGoal(
		data: {
			title: string;
			description?: string;
			priority?: string;
			milestones?: string[];
		},
		projectId?: string | null,
	): Promise<GoalRecord> {
		const result = await apiFetch<{ goal: GoalRecord }>(brainUrl("/goals", projectId), {
			method: "POST",
			body: JSON.stringify(data),
		});
		return result.goal;
	}

	async updateGoal(id: string, data: Partial<GoalRecord>, projectId?: string | null): Promise<GoalRecord> {
		const result = await apiFetch<{ goal: GoalRecord }>(`${brainUrl("/goals", projectId)}/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		});
		return result.goal;
	}

	async deleteGoal(id: string, projectId?: string | null): Promise<void> {
		return apiFetch<void>(`${brainUrl("/goals", projectId)}/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
	}

	async completeGoal(id: string, projectId?: string | null): Promise<GoalRecord> {
		const result = await apiFetch<{ goal: GoalRecord }>(`${brainUrl("/goals", projectId)}/${encodeURIComponent(id)}/complete`, {
			method: "POST",
		});
		return result.goal;
	}

	async getGoalStats(projectId?: string | null): Promise<GoalStats> {
		const data = await apiFetch<{ stats: Record<string, unknown> }>(brainUrl("/goals/stats", projectId));
		const s = data.stats;
		return {
			total: (s.totalGoals as number) ?? 0,
			byStatus: (s.byStatus as Record<string, number>) ?? {},
			byPriority: (s.byPriority as Record<string, number>) ?? {},
		};
	}

	async getDriftReports(projectId?: string | null): Promise<GoalDriftReport[]> {
		const data = await apiFetch<{ reports: GoalDriftReport[] }>(brainUrl("/goals/drift", projectId));
		return data.reports ?? [];
	}

	// =========================================================================
	// Autonomy (P15)
	// =========================================================================

	async getAutonomyProfile(projectId?: string | null): Promise<AutonomyProfile> {
		return apiFetch<AutonomyProfile>(brainUrl("/autonomy", projectId));
	}

	async updateAutonomyProfile(data: Partial<AutonomyProfile>, projectId?: string | null): Promise<AutonomyProfile> {
		return apiFetch<AutonomyProfile>(brainUrl("/autonomy", projectId), {
			method: "PATCH",
			body: JSON.stringify(data),
		});
	}

	async emergencyStop(projectId?: string | null): Promise<void> {
		return apiFetch<void>(brainUrl("/autonomy/emergency-stop", projectId), { method: "POST" });
	}

	async releaseStop(projectId?: string | null): Promise<void> {
		return apiFetch<void>(brainUrl("/autonomy/release-stop", projectId), { method: "POST" });
	}

	async getEmergencyStatus(projectId?: string | null): Promise<{ stopped: boolean }> {
		return apiFetch<{ stopped: boolean }>(brainUrl("/autonomy/emergency-status", projectId));
	}

	// =========================================================================
	// Policy (P18)
	// =========================================================================

	async getPolicyRules(projectId?: string | null): Promise<PolicyRule[]> {
		return apiFetch<PolicyRule[]>(brainUrl("/policy/rules", projectId));
	}

	async toggleRule(id: string, projectId?: string | null): Promise<PolicyRule> {
		return apiFetch<PolicyRule>(`${brainUrl("/policy/rules", projectId)}/${encodeURIComponent(id)}/toggle`, {
			method: "POST",
		});
	}

	async evaluateAction(
		data: { action: string; context?: Record<string, unknown> },
		projectId?: string | null,
	): Promise<PolicyResult> {
		return apiFetch<PolicyResult>(brainUrl("/policy/evaluate", projectId), {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	// =========================================================================
	// Approvals (P18)
	// =========================================================================

	async getApprovals(
		params?: {
			limit?: number;
			offset?: number;
			status?: string;
		},
		projectId?: string | null,
	): Promise<{ approvals: ApprovalRequest[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.status) qs.set("status", params.status);
		return apiFetch(`${brainUrl("/approvals", projectId)}?${qs}`);
	}

	async approve(id: string, projectId?: string | null): Promise<ApprovalRequest> {
		return apiFetch<ApprovalRequest>(`${brainUrl("/approvals", projectId)}/${encodeURIComponent(id)}/approve`, {
			method: "POST",
		});
	}

	async rejectApproval(id: string, reason?: string, projectId?: string | null): Promise<ApprovalRequest> {
		return apiFetch<ApprovalRequest>(`${brainUrl("/approvals", projectId)}/${encodeURIComponent(id)}/reject`, {
			method: "POST",
			body: JSON.stringify({ reason }),
		});
	}

	async getApprovalStats(projectId?: string | null): Promise<ApprovalStats> {
		return apiFetch<ApprovalStats>(brainUrl("/approvals/stats", projectId));
	}

	// =========================================================================
	// Reflections (P17)
	// =========================================================================

	async getReflections(projectId?: string | null): Promise<ReflectionReport[]> {
		const data = await apiFetch<{ reflections: ReflectionReport[] }>(brainUrl("/reflections", projectId));
		return data.reflections ?? [];
	}

	async getReflection(planExecId: string, projectId?: string | null): Promise<ReflectionReport> {
		const data = await apiFetch<{ reflection: ReflectionReport }>(`${brainUrl("/reflections", projectId)}/${encodeURIComponent(planExecId)}`);
		return data.reflection;
	}

	async getReflectionStats(projectId?: string | null): Promise<{
		total: number;
		memoriesCreated: number;
		suggestionsGenerated: number;
	}> {
		const data = await apiFetch<{ stats: { total: number; memoriesCreated: number; suggestionsGenerated: number } }>(brainUrl("/reflections/stats", projectId));
		return data.stats;
	}

	// =========================================================================
	// Audit (P18)
	// =========================================================================

	async getAuditEntries(
		params?: {
			limit?: number;
			offset?: number;
			action?: string;
		},
		projectId?: string | null,
	): Promise<{ entries: AuditEntry[]; total: number }> {
		const qs = new URLSearchParams();
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		if (params?.action) qs.set("action", params.action);
		return apiFetch(`${brainUrl("/audit", projectId)}?${qs}`);
	}

	async getAuditStats(projectId?: string | null): Promise<AuditStats> {
		return apiFetch<AuditStats>(brainUrl("/audit/stats", projectId));
	}

	async getProvenance(targetId: string, projectId?: string | null): Promise<Record<string, unknown>> {
		return apiFetch(`${brainUrl("/audit/provenance", projectId)}/${encodeURIComponent(targetId)}`);
	}

	async explainDecision(targetId: string, projectId?: string | null): Promise<string> {
		const res = await apiFetch<{ explanation: string }>(
			`${brainUrl("/audit/explain", projectId)}/${encodeURIComponent(targetId)}`,
		);
		return res.explanation;
	}

	// =========================================================================
	// Overnight (P20)
	// =========================================================================

	async queueOvernight(
		config: {
			queueSelection: string[];
			autonomyLevel: number;
			maxDurationHours: number;
			stopConditions: string[];
		},
		projectId?: string | null,
	): Promise<{ sessionId: string }> {
		return apiFetch<{ sessionId: string }>(brainUrl("/overnight/queue", projectId), {
			method: "POST",
			body: JSON.stringify(config),
		});
	}

	async getOvernightStatus(sessionId: string, projectId?: string | null): Promise<OvernightSession> {
		return apiFetch<OvernightSession>(`${brainUrl("/overnight", projectId)}/${encodeURIComponent(sessionId)}`);
	}

	async getOvernightHistory(projectId?: string | null): Promise<OvernightSession[]> {
		return apiFetch<OvernightSession[]>(brainUrl("/overnight/history", projectId));
	}

	async cancelOvernight(sessionId: string, projectId?: string | null): Promise<void> {
		return apiFetch<void>(`${brainUrl("/overnight", projectId)}/${encodeURIComponent(sessionId)}/cancel`, {
			method: "POST",
		});
	}

	// =========================================================================
	// Morning Digest
	// =========================================================================

	async getDigest(projectId?: string | null): Promise<MorningDigest> {
		return apiFetch<MorningDigest>(brainUrl("/digest", projectId));
	}

	// =========================================================================
	// Feedback (24.J — Feedback Loop)
	// =========================================================================

	async submitFeedback(
		data: {
			itemType: FeedbackItemType;
			itemId: string;
			itemTitle: string;
			rating: 1 | -1;
			comment?: string;
		},
		projectId?: string | null,
	): Promise<FeedbackEntry> {
		return apiFetch<FeedbackEntry>(brainUrl("/feedback", projectId), {
			method: "POST",
			body: JSON.stringify(data),
		});
	}

	async listFeedback(
		params?: {
			itemType?: string;
			itemId?: string;
			rating?: number;
			applied?: boolean;
			limit?: number;
			offset?: number;
		},
		projectId?: string | null,
	): Promise<FeedbackQueryResult> {
		const qs = new URLSearchParams();
		if (params?.itemType) qs.set("itemType", params.itemType);
		if (params?.itemId) qs.set("itemId", params.itemId);
		if (params?.rating !== undefined) qs.set("rating", String(params.rating));
		if (params?.applied !== undefined) qs.set("applied", String(params.applied));
		if (params?.limit) qs.set("limit", String(params.limit));
		if (params?.offset) qs.set("offset", String(params.offset));
		return apiFetch<FeedbackQueryResult>(`${brainUrl("/feedback", projectId)}?${qs}`);
	}

	async getFeedbackStats(projectId?: string | null): Promise<FeedbackStats> {
		return apiFetch<FeedbackStats>(brainUrl("/feedback/stats", projectId));
	}

	async updateFeedback(
		id: string,
		updates: {
			rating?: 1 | -1;
			comment?: string;
			applied?: boolean;
		},
		projectId?: string | null,
	): Promise<FeedbackEntry> {
		return apiFetch<FeedbackEntry>(
			`${brainUrl("/feedback", projectId)}/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				body: JSON.stringify(updates),
			},
		);
	}

	async deleteFeedback(id: string, projectId?: string | null): Promise<void> {
		return apiFetch<void>(
			`${brainUrl("/feedback", projectId)}/${encodeURIComponent(id)}`,
			{ method: "DELETE" },
		);
	}
}

/** Singleton instance */
export const brainClient = new BrainClient();
