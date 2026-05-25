/**
 * usePiInbox — React hooks for the Pi Inbox and Message Center (24.M).
 *
 * Provides:
 * - usePiInbox: List inbox messages with optional filters
 * - usePiInboxStats: Get inbox aggregate statistics
 * - usePiInboxMessage: Get a single message by ID
 * - useMarkRead: Mark a single message as read
 * - useMarkAllRead: Mark all messages as read
 * - useDeleteMessage: Delete a single message
 * - usePurgeRead: Delete all read messages
 * - useClearInbox: Clear all messages
 * - usePushMessage: Push a new message
 *
 * Loading, empty, error, and stale states are handled.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PiInboxMessage {
	id: string;
	type: PiInboxMessageType;
	title: string;
	body: string;
	priority: PiInboxMessagePriority;
	read: boolean;
	createdAt: string;
	readAt?: string;
	metadata?: Record<string, unknown>;
	source?: string;
	actionUrl?: string;
}

export type PiInboxMessageType =
	| "system_notification"
	| "daemon_alert"
	| "brain_observation"
	| "proposal_generated"
	| "plan_completed"
	| "plan_failed"
	| "task_completed"
	| "memory_conflict"
	| "goal_drift"
	| "approval_required"
	| "warning"
	| "info";

export type PiInboxMessagePriority = "low" | "normal" | "high" | "critical";

export interface PiInboxStats {
	total: number;
	unread: number;
	byType: Record<string, number>;
	byPriority: Record<string, number>;
}

export interface PiInboxListResponse {
	success: boolean;
	messages: PiInboxMessage[];
	total: number;
	unread: number;
	limit: number;
	offset: number;
	error?: string;
}

export interface PiInboxStatsResponse {
	success: boolean;
	stats: PiInboxStats;
	error?: string;
}

export interface PiInboxMessageResponse {
	success: boolean;
	message: PiInboxMessage;
	error?: string;
}

export interface PiInboxActionResponse {
	success: boolean;
	count?: number;
	error?: string;
}

export interface PiInboxQueryParams {
	type?: PiInboxMessageType;
	priority?: PiInboxMessagePriority;
	read?: boolean;
	limit?: number;
	offset?: number;
	sortBy?: "createdAt" | "priority";
	sortDir?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const API_BASE = "";

function inboxUrl(path: string = ""): string {
	return `${API_BASE}/api/pi/inbox${path}`;
}

async function fetchInbox(params?: PiInboxQueryParams): Promise<PiInboxListResponse> {
	const qs = new URLSearchParams();
	if (params?.type) qs.set("type", params.type);
	if (params?.priority) qs.set("priority", params.priority);
	if (params?.read !== undefined) qs.set("read", String(params.read));
	if (params?.limit) qs.set("limit", String(params.limit));
	if (params?.offset) qs.set("offset", String(params.offset));
	if (params?.sortBy) qs.set("sortBy", params.sortBy);
	if (params?.sortDir) qs.set("sortDir", params.sortDir);

	const url = qs.toString() ? `${inboxUrl()}?${qs}` : inboxUrl();
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch inbox: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function fetchInboxStats(): Promise<PiInboxStatsResponse> {
	const res = await fetch(inboxUrl("/stats"));
	if (!res.ok) {
		throw new Error(`Failed to fetch inbox stats: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function fetchMessage(id: string): Promise<PiInboxMessageResponse> {
	const res = await fetch(inboxUrl(`/${encodeURIComponent(id)}`));
	if (!res.ok) {
		throw new Error(`Failed to fetch message: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function markRead(id: string): Promise<PiInboxMessageResponse> {
	const res = await fetch(inboxUrl(`/${encodeURIComponent(id)}/read`), {
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(`Failed to mark message as read: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function markAllRead(): Promise<PiInboxActionResponse> {
	const res = await fetch(inboxUrl("/read-all"), {
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(`Failed to mark all as read: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function deleteMessage(id: string): Promise<PiInboxActionResponse> {
	const res = await fetch(inboxUrl(`/${encodeURIComponent(id)}`), {
		method: "DELETE",
	});
	if (!res.ok) {
		throw new Error(`Failed to delete message: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function purgeReadMessages(): Promise<PiInboxActionResponse> {
	const res = await fetch(inboxUrl("/purge-read"), {
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(`Failed to purge read messages: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function clearInbox(): Promise<PiInboxActionResponse> {
	const res = await fetch(inboxUrl("/clear"), {
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(`Failed to clear inbox: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

async function pushMessage(data: {
	type: PiInboxMessageType;
	title: string;
	body: string;
	priority?: PiInboxMessagePriority;
	source?: string;
	actionUrl?: string;
	metadata?: Record<string, unknown>;
}): Promise<PiInboxMessageResponse> {
	const res = await fetch(inboxUrl(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(data),
	});
	if (!res.ok) {
		throw new Error(`Failed to push message: ${res.status} ${res.statusText}`);
	}
	return res.json();
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const INBOX_QUERY_KEY = ["pi-inbox"];

/**
 * Hook to fetch inbox messages with optional filters.
 *
 * Automatically polls every 30 seconds.
 *
 * @param params - Optional query parameters (type, priority, read, pagination, sort)
 */
export function usePiInbox(params?: PiInboxQueryParams) {
	return useQuery<PiInboxListResponse>({
		queryKey: [...INBOX_QUERY_KEY, "list", params],
		queryFn: () => fetchInbox(params),
		refetchInterval: 30_000,
		staleTime: 10_000,
	});
}

/**
 * Hook to fetch inbox aggregate statistics.
 *
 * Automatically polls every 15 seconds for fresh unread count.
 */
export function usePiInboxStats() {
	return useQuery<PiInboxStatsResponse>({
		queryKey: [...INBOX_QUERY_KEY, "stats"],
		queryFn: fetchInboxStats,
		refetchInterval: 15_000,
		staleTime: 5_000,
	});
}

/**
 * Hook to fetch a single message by ID.
 *
 * @param id - The message ID, or null to skip fetching
 */
export function usePiInboxMessage(id: string | null) {
	return useQuery<PiInboxMessageResponse>({
		queryKey: [...INBOX_QUERY_KEY, "message", id],
		queryFn: () => fetchMessage(id!),
		enabled: !!id,
	});
}

/**
 * Hook to mark a single message as read.
 */
export function useMarkRead() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: string) => markRead(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}

/**
 * Hook to mark all messages as read.
 */
export function useMarkAllRead() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: markAllRead,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}

/**
 * Hook to delete a single message.
 */
export function useDeleteMessage() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (id: string) => deleteMessage(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}

/**
 * Hook to purge all read messages.
 */
export function usePurgeRead() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: purgeReadMessages,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}

/**
 * Hook to clear all messages from the inbox.
 */
export function useClearInbox() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: clearInbox,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}

/**
 * Hook to push a new message to the inbox.
 */
export function usePushMessage() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: {
			type: PiInboxMessageType;
			title: string;
			body: string;
			priority?: PiInboxMessagePriority;
			source?: string;
			actionUrl?: string;
			metadata?: Record<string, unknown>;
		}) => pushMessage(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY });
		},
	});
}
