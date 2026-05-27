/**
 * useBrainWorkerInbox — React hooks for the Worker Handoff Inbox (25.O).
 *
 * Provides read-only access to the worker handoff inbox via
 * GET /api/brain/workers/inbox and related operations.
 *
 * The inbox returns handoff entries with status, priority, and
 * diagnostic information for triage and routing.
 *
 * 25.O AC1: List handoff entries with optional filters
 * 25.O AC2: View entry details and diagnostics
 * 25.O AC3: Statistics and aggregate counts
 * 25.O AC4: Trigger triage cycles and manage routing rules
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Handoff entry priority. */
export type HandoffPriority = "low" | "normal" | "high" | "critical";

/** Handoff entry status. */
export type HandoffEntryStatus =
	| "pending"
	| "routing"
	| "dispatched"
	| "completed"
	| "failed"
	| "cancelled";

/** A diagnostic attached to a handoff entry. */
export interface WorkerDiagnostic {
	timestamp: string;
	stopCondition: string;
	message: string;
	errorDetail?: string;
	context: Record<string, unknown>;
	evidenceRefs: string[];
}

/** A handoff entry in the worker inbox. */
export interface HandoffEntry {
	id: string;
	priority: HandoffPriority;
	status: HandoffEntryStatus;
	createdAt: string;
	updatedAt: string;
	sourceWorkerId: string;
	sourceWorkerRole: string;
	targetWorkerId?: string;
	targetWorkerRole: string;
	title: string;
	description: string;
	input: Record<string, unknown>;
	output: Record<string, unknown>;
	dedupKey: string;
	tags: string[];
	evidenceRefs: string[];
	error?: string;
	diagnostics: WorkerDiagnostic[];
	metadata: Record<string, unknown>;
}

/** Inbox aggregate statistics. */
export interface HandoffInboxStats {
	total: number;
	pending: number;
	routing: number;
	dispatched: number;
	completed: number;
	failed: number;
	cancelled: number;
	byPriority: Record<HandoffPriority, number>;
	oldestEntryAgeMs: number;
	lastUpdated: string;
}

/** Triage router status. */
export type TriageRouterStatus = "idle" | "processing" | "cooling" | "paused" | "failed";

/** Triage router statistics. */
export interface TriageRouterStats {
	status: TriageRouterStatus;
	totalCycles: number;
	totalEntriesRouted: number;
	totalEntriesFailed: number;
	totalEntriesSkipped: number;
	consecutiveFailures: number;
	lastCycleAt: string | null;
	uptimeMs: number;
}

/** Routing rule for the triage router. */
export interface RoutingRule {
	id: string;
	description: string;
	targetRole: string;
	minPriority?: HandoffPriority;
	requiredTags?: string[];
	excludedTags?: string[];
	dispatchToRole: string;
	dispatchToWorkerId?: string;
	enabled: boolean;
	order: number;
}

/** Response from listing entries. */
export interface InboxListResponse {
	success: boolean;
	entries: HandoffEntry[];
	total: number;
	limit: number;
	offset: number;
	error?: string;
}

/** Response from getting stats. */
export interface InboxStatsResponse {
	success: boolean;
	stats: HandoffInboxStats;
	error?: string;
}

/** Response from getting a single entry. */
export interface InboxEntryResponse {
	success: boolean;
	entry: HandoffEntry;
	error?: string;
}

/** Response from creating an entry. */
export interface InboxCreateResponse {
	success: boolean;
	entry?: HandoffEntry;
	duplicate?: boolean;
	reason?: string;
	error?: string;
	diagnostics?: WorkerDiagnostic[];
}

/** Response from triage status. */
export interface TriageStatusResponse {
	success: boolean;
	stats: TriageRouterStats;
	config: Record<string, unknown>;
	error?: string;
}

/** Response from triage cycle. */
export interface TriageCycleResponse {
	success: boolean;
	cycleResult: {
		cycleId: string;
		entriesProcessed: number;
		entriesRouted: number;
		entriesSkipped: number;
		entriesFailed: number;
		routingResults: Array<{
			entryId: string;
			success: boolean;
			routedToWorkerId?: string;
			routedToRole?: string;
			error?: string;
		}>;
		runtimeMs: number;
	};
	error?: string;
}

// ---------------------------------------------------------------------------
// API URL helpers
// ---------------------------------------------------------------------------

const API_BASE = "";

function inboxUrl(): string {
	return `${API_BASE}/api/brain/workers/inbox`;
}

function inboxEntryUrl(id: string): string {
	return `${API_BASE}/api/brain/workers/inbox/${encodeURIComponent(id)}`;
}

function inboxStatsUrl(): string {
	return `${API_BASE}/api/brain/workers/inbox/stats`;
}

function inboxPruneUrl(): string {
	return `${API_BASE}/api/brain/workers/inbox/prune`;
}

function triageStatusUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/status`;
}

function triageCycleUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/cycle`;
}

function triagePauseUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/pause`;
}

function triageResumeUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/resume`;
}

function triageResetUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/reset`;
}

function triageRulesUrl(): string {
	return `${API_BASE}/api/brain/workers/triage/rules`;
}

function triageRuleUrl(id: string): string {
	return `${API_BASE}/api/brain/workers/triage/rules/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Hooks — Inbox
// ---------------------------------------------------------------------------

/**
 * Build query parameters for the inbox list endpoint.
 */
function buildInboxQuery(params: {
	status?: HandoffEntryStatus;
	priority?: HandoffPriority;
	sourceWorkerId?: string;
	targetWorkerRole?: string;
	limit?: number;
	offset?: number;
}): string {
	const searchParams = new URLSearchParams();
	if (params.status) searchParams.set("status", params.status);
	if (params.priority) searchParams.set("priority", params.priority);
	if (params.sourceWorkerId) searchParams.set("sourceWorkerId", params.sourceWorkerId);
	if (params.targetWorkerRole) searchParams.set("targetWorkerRole", params.targetWorkerRole);
	if (params.limit) searchParams.set("limit", String(params.limit));
	if (params.offset) searchParams.set("offset", String(params.offset));
	const qs = searchParams.toString();
	return qs ? `?${qs}` : "";
}

/**
 * Fetch the inbox list with optional filters.
 */
async function fetchInbox(params: {
	status?: HandoffEntryStatus;
	priority?: HandoffPriority;
	sourceWorkerId?: string;
	targetWorkerRole?: string;
	limit?: number;
	offset?: number;
}): Promise<InboxListResponse> {
	const url = `${inboxUrl()}${buildInboxQuery(params)}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch inbox: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

/**
 * Hook to fetch the worker handoff inbox with optional filters.
 *
 * Automatically polls every 15 seconds for updates.
 */
export function useWorkerInbox(params: {
	status?: HandoffEntryStatus;
	priority?: HandoffPriority;
	sourceWorkerId?: string;
	targetWorkerRole?: string;
	limit?: number;
	offset?: number;
} = {}) {
	return useQuery<InboxListResponse>({
		queryKey: ["brain-workers", "inbox", params],
		queryFn: () => fetchInbox(params),
		refetchInterval: 15_000,
		staleTime: 5_000,
	});
}

/**
 * Fetch a single handoff entry by ID.
 */
async function fetchEntry(id: string): Promise<InboxEntryResponse> {
	const res = await fetch(inboxEntryUrl(id));
	if (!res.ok) {
		if (res.status === 404) {
			return { success: false, error: `Entry not found: ${id}`, entry: null as unknown as HandoffEntry };
		}
		throw new Error(`Failed to fetch entry: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

/**
 * Hook to fetch a single handoff entry by ID.
 */
export function useWorkerInboxEntry(id: string | undefined) {
	return useQuery<InboxEntryResponse>({
		queryKey: ["brain-workers", "inbox", "entry", id],
		queryFn: () => fetchEntry(id!),
		enabled: !!id,
	});
}

/**
 * Fetch the inbox statistics.
 */
async function fetchStats(): Promise<InboxStatsResponse> {
	const res = await fetch(inboxStatsUrl());
	if (!res.ok) {
		throw new Error(`Failed to fetch inbox stats: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

/**
 * Hook to fetch the inbox statistics.
 */
export function useWorkerInboxStats() {
	return useQuery<InboxStatsResponse>({
		queryKey: ["brain-workers", "inbox", "stats"],
		queryFn: fetchStats,
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

// ---------------------------------------------------------------------------
// Hooks — Triage Router
// ---------------------------------------------------------------------------

/**
 * Fetch triage router status.
 */
async function fetchTriageStatus(): Promise<TriageStatusResponse> {
	const res = await fetch(triageStatusUrl());
	if (!res.ok) {
		throw new Error(`Failed to fetch triage status: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

/**
 * Hook to fetch triage router status.
 */
export function useTriageStatus() {
	return useQuery<TriageStatusResponse>({
		queryKey: ["brain-workers", "triage", "status"],
		queryFn: fetchTriageStatus,
		refetchInterval: 15_000,
		staleTime: 5_000,
	});
}

/**
 * Hook to trigger a triage cycle.
 */
export function useTriageCycle() {
	const queryClient = useQueryClient();

	return useMutation<TriageCycleResponse, Error, void>({
		mutationFn: async () => {
			const res = await fetch(triageCycleUrl(), { method: "POST" });
			if (!res.ok) {
				throw new Error(`Failed to run triage cycle: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers"] });
		},
	});
}

/**
 * Hook to pause the triage router.
 */
export function useTriagePause() {
	const queryClient = useQueryClient();

	return useMutation<TriageStatusResponse, Error, { reason?: string }>({
		mutationFn: async (body) => {
			const res = await fetch(triagePauseUrl(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`Failed to pause triage: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers"] });
		},
	});
}

/**
 * Hook to resume the triage router.
 */
export function useTriageResume() {
	const queryClient = useQueryClient();

	return useMutation<TriageStatusResponse, Error, void>({
		mutationFn: async () => {
			const res = await fetch(triageResumeUrl(), { method: "POST" });
			if (!res.ok) {
				throw new Error(`Failed to resume triage: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers"] });
		},
	});
}

/**
 * Hook to reset the triage router.
 */
export function useTriageReset() {
	const queryClient = useQueryClient();

	return useMutation<TriageStatusResponse, Error, void>({
		mutationFn: async () => {
			const res = await fetch(triageResetUrl(), { method: "POST" });
			if (!res.ok) {
				throw new Error(`Failed to reset triage: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers"] });
		},
	});
}

// ---------------------------------------------------------------------------
// Hooks — Create / Cancel Entry
// ---------------------------------------------------------------------------

/**
 * Hook to create a new handoff entry.
 */
export function useCreateHandoff() {
	const queryClient = useQueryClient();

	return useMutation<InboxCreateResponse, Error, {
		sourceWorkerId: string;
		sourceWorkerRole: string;
		targetWorkerRole: string;
		title: string;
		description: string;
		dedupKey: string;
		priority?: HandoffPriority;
		targetWorkerId?: string;
		input?: Record<string, unknown>;
		output?: Record<string, unknown>;
		tags?: string[];
		evidenceRefs?: string[];
	}>({
		mutationFn: async (body) => {
			const res = await fetch(inboxUrl(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				throw new Error(`Failed to create handoff: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "inbox"] });
		},
	});
}

/**
 * Hook to cancel a handoff entry.
 */
export function useCancelHandoff() {
	const queryClient = useQueryClient();

	return useMutation<InboxEntryResponse, Error, { id: string; reason?: string }>({
		mutationFn: async ({ id, reason }) => {
			const res = await fetch(inboxEntryUrl(id) + "/cancel", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason }),
			});
			if (!res.ok) {
				throw new Error(`Failed to cancel handoff: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "inbox"] });
		},
	});
}

/**
 * Hook to trigger inbox pruning.
 */
export function usePruneInbox() {
	const queryClient = useQueryClient();

	return useMutation<InboxStatsResponse, Error, void>({
		mutationFn: async () => {
			const res = await fetch(inboxPruneUrl(), { method: "POST" });
			if (!res.ok) {
				throw new Error(`Failed to prune inbox: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "inbox"] });
		},
	});
}

// ---------------------------------------------------------------------------
// Hooks — Routing Rules
// ---------------------------------------------------------------------------

/**
 * Hook to fetch routing rules.
 */
export function useRoutingRules() {
	return useQuery<{ success: boolean; rules: RoutingRule[]; error?: string }>({
		queryKey: ["brain-workers", "triage", "rules"],
		queryFn: async () => {
			const res = await fetch(triageRulesUrl());
			if (!res.ok) {
				throw new Error(`Failed to fetch routing rules: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

/**
 * Hook to add a routing rule.
 */
export function useAddRoutingRule() {
	const queryClient = useQueryClient();

	return useMutation<{ success: boolean; rule: RoutingRule; error?: string }, Error, RoutingRule>({
		mutationFn: async (rule) => {
			const res = await fetch(triageRulesUrl(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(rule),
			});
			if (!res.ok) {
				throw new Error(`Failed to add routing rule: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "triage", "rules"] });
		},
	});
}

/**
 * Hook to remove a routing rule.
 */
export function useRemoveRoutingRule() {
	const queryClient = useQueryClient();

	return useMutation<{ success: boolean; error?: string }, Error, string>({
		mutationFn: async (ruleId) => {
			const res = await fetch(triageRuleUrl(ruleId), { method: "DELETE" });
			if (!res.ok) {
				throw new Error(`Failed to remove routing rule: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "triage", "rules"] });
		},
	});
}

/**
 * Hook to toggle a routing rule's enabled state.
 */
export function useToggleRoutingRule() {
	const queryClient = useQueryClient();

	return useMutation<{ success: boolean; error?: string }, Error, { id: string; enabled: boolean }>({
		mutationFn: async ({ id, enabled }) => {
			const res = await fetch(triageRuleUrl(id), {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled }),
			});
			if (!res.ok) {
				throw new Error(`Failed to toggle routing rule: ${res.status} ${res.statusText}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["brain-workers", "triage", "rules"] });
		},
	});
}
