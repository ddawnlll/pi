/**
 * useGoals — React hooks for the Goal Board (P15.G).
 *
 * Provides data-fetching and mutations for goals and drift reports.
 * Talks to the /api/brain/goals endpoints.
 *
 * When the API is not yet implemented, returns empty states gracefully.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types (mirrors coding-agent/src/brain/goals/types.ts)
// ---------------------------------------------------------------------------

export type GoalStatus = "active" | "completed" | "paused" | "cancelled" | "needs_review";
export type GoalPriority = "critical" | "high" | "normal" | "low";
export type DriftSeverity = "low" | "medium" | "high";

export interface Milestone {
	id: string;
	title: string;
	description?: string;
	completed: boolean;
	completedAt?: string;
	createdAt: string;
	order: number;
}

export interface GoalRecord {
	id: string;
	title: string;
	description: string;
	priority: GoalPriority;
	status: GoalStatus;
	category: string;
	milestones: Milestone[];
	createdAt: string;
	updatedAt: string;
	targetDate?: string;
	completedAt?: string;
	relatedMemoryIds: string[];
	metadata: Record<string, unknown>;
}

export interface GoalCreateInput {
	title: string;
	description: string;
	priority?: GoalPriority;
	category?: string;
	milestones?: Omit<Milestone, "id" | "createdAt">[];
	targetDate?: string;
}

export interface GoalUpdateInput {
	title?: string;
	description?: string;
	priority?: GoalPriority;
	status?: GoalStatus;
	category?: string;
	milestones?: Milestone[];
	targetDate?: string;
}

export interface GoalsStats {
	totalGoals: number;
	activeGoals: number;
	completedGoals: number;
	byStatus: Record<string, number>;
	byPriority: Record<string, number>;
	driftReports: number;
	openDriftReports: number;
}

export interface DriftIndicator {
	type: string;
	details: string;
	score: number;
}

export interface GoalDriftReport {
	id: string;
	goalId: string;
	goalTitle: string;
	severity: DriftSeverity;
	indicators: DriftIndicator[];
	generatedAt: string;
	resolvedAt?: string;
	resolvedBy?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = "";

async function fetchGoals(filters?: {
	status?: GoalStatus;
	priority?: GoalPriority;
}): Promise<GoalRecord[]> {
	const params = new URLSearchParams();
	if (filters?.status) params.set("status", filters.status);
	if (filters?.priority) params.set("priority", filters.priority);

	const query = params.toString();
	const url = `${API_BASE}/api/brain/goals${query ? `?${query}` : ""}`;

	const res = await fetch(url);
	if (!res.ok) {
		if (res.status === 404) return [];
		throw new Error(`Failed to fetch goals: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error fetching goals");
	}

	return data.goals ?? data ?? [];
}

async function fetchGoalDetail(id: string): Promise<GoalRecord | null> {
	const res = await fetch(`${API_BASE}/api/brain/goals/${encodeURIComponent(id)}`);
	if (!res.ok) {
		if (res.status === 404) return null;
		throw new Error(`Failed to fetch goal: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error fetching goal");
	}

	return data.goal ?? data ?? null;
}

async function fetchGoalStats(): Promise<GoalsStats | null> {
	const res = await fetch(`${API_BASE}/api/brain/goals/stats`);
	if (!res.ok) {
		if (res.status === 404) return null;
		throw new Error(`Failed to fetch goal stats: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error fetching goal stats");
	}

	return data.stats ?? data ?? null;
}

async function fetchDriftReports(): Promise<GoalDriftReport[]> {
	const res = await fetch(`${API_BASE}/api/brain/goals/drift`);
	if (!res.ok) {
		if (res.status === 404) return [];
		throw new Error(`Failed to fetch drift reports: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error fetching drift reports");
	}

	return data.reports ?? data ?? [];
}

async function createGoal(input: GoalCreateInput): Promise<GoalRecord> {
	const res = await fetch(`${API_BASE}/api/brain/goals`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!res.ok) {
		throw new Error(`Failed to create goal: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error creating goal");
	}

	return data.goal ?? data;
}

async function updateGoal(id: string, input: GoalUpdateInput): Promise<GoalRecord> {
	const res = await fetch(`${API_BASE}/api/brain/goals/${encodeURIComponent(id)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!res.ok) {
		throw new Error(`Failed to update goal: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	if (data.success === false) {
		throw new Error(data.error ?? "Unknown error updating goal");
	}

	return data.goal ?? data;
}

async function deleteGoal(id: string): Promise<void> {
	const res = await fetch(`${API_BASE}/api/brain/goals/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		throw new Error(`Failed to delete goal: ${res.status} ${res.statusText}`);
	}
}

async function completeGoal(id: string): Promise<GoalRecord> {
	return updateGoal(id, { status: "completed" });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const goalsKey = ["brain", "goals"] as const;
const goalsStatsKey = ["brain", "goals", "stats"] as const;
const driftKey = ["brain", "goals", "drift"] as const;

/**
 * Fetch all goals with optional filters.
 */
export function useGoals(filters?: { status?: GoalStatus; priority?: GoalPriority }) {
	return useQuery({
		queryKey: [...goalsKey, filters ?? {}],
		queryFn: () => fetchGoals(filters),
		staleTime: 30_000,
		retry: 1,
	});
}

/**
 * Fetch a single goal by ID.
 */
export function useGoalDetail(id: string | null) {
	return useQuery({
		queryKey: [...goalsKey, "detail", id],
		queryFn: () => (id ? fetchGoalDetail(id) : null),
		enabled: !!id,
		staleTime: 15_000,
		retry: 1,
	});
}

/**
 * Fetch goal statistics.
 */
export function useGoalStats() {
	return useQuery({
		queryKey: goalsStatsKey,
		queryFn: () => fetchGoalStats(),
		staleTime: 30_000,
		retry: 1,
	});
}

/**
 * Fetch drift reports.
 */
export function useDriftReports() {
	return useQuery({
		queryKey: driftKey,
		queryFn: () => fetchDriftReports(),
		staleTime: 30_000,
		retry: 1,
	});
}

/**
 * Mutation: create a new goal.
 */
export function useCreateGoal() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (input: GoalCreateInput) => createGoal(input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: goalsKey });
			qc.invalidateQueries({ queryKey: goalsStatsKey });
		},
	});
}

/**
 * Mutation: update an existing goal.
 */
export function useUpdateGoal() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, input }: { id: string; input: GoalUpdateInput }) => updateGoal(id, input),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: goalsKey });
			qc.invalidateQueries({ queryKey: goalsStatsKey });
		},
	});
}

/**
 * Mutation: delete a goal.
 */
export function useDeleteGoal() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteGoal(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: goalsKey });
			qc.invalidateQueries({ queryKey: goalsStatsKey });
		},
	});
}

/**
 * Mutation: complete a goal (set status to "completed").
 */
export function useCompleteGoal() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => completeGoal(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: goalsKey });
			qc.invalidateQueries({ queryKey: goalsStatsKey });
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute milestone progress percentage.
 */
export function milestoneProgress(milestones: Milestone[]): number {
	if (milestones.length === 0) return 0;
	const completed = milestones.filter((m) => m.completed).length;
	return Math.round((completed / milestones.length) * 100);
}
