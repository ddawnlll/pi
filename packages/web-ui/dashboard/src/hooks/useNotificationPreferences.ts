/**
 * useNotificationPreferences — React hook for notification channel
 * and delivery preference management (24.H).
 *
 * Provides:
 * - Fetching current notification preferences
 * - Fetching available channels with status
 * - Updating preferences (global enable, channel toggles, per-type rules)
 * - Resetting preferences to defaults
 * - Loading, empty, error, and success states
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannel = "email" | "inbox" | "system";

export type NotificationType =
	| "plan_completed"
	| "plan_failed"
	| "task_completed"
	| "task_failed"
	| "approval_required"
	| "proposal_generated"
	| "goal_drift"
	| "memory_conflict"
	| "daemon_alert"
	| "brain_observation"
	| "warning"
	| "info";

export interface ChannelRule {
	email?: boolean;
	inbox?: boolean;
	system?: boolean;
}

export interface NotificationPreferences {
	enabled: boolean;
	channels: Record<NotificationChannel, boolean>;
	rules: Partial<Record<NotificationType, ChannelRule>>;
}

export interface ChannelInfo {
	channel: NotificationChannel;
	name: string;
	description: string;
	enabled: boolean;
	configured: boolean;
}

interface ApiResponse<T> {
	success: boolean;
	[key: string]: unknown;
}

interface PreferencesResponse extends ApiResponse<NotificationPreferences> {
	preferences: NotificationPreferences;
}

interface ChannelsResponse extends ApiResponse<ChannelInfo[]> {
	channels: ChannelInfo[];
}

const API_BASE = "";

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

async function fetchPreferences(): Promise<NotificationPreferences> {
	const res = await fetch(`${API_BASE}/api/notifications/preferences`);
	if (!res.ok) {
		throw new Error(`Failed to fetch notification preferences: ${res.statusText}`);
	}
	const data = (await res.json()) as PreferencesResponse;
	if (!data.success || !data.preferences) {
		throw new Error("Invalid response: missing preferences data");
	}
	return data.preferences;
}

async function updatePreferences(
	updates: Partial<{
		enabled: boolean;
		channels: Partial<Record<NotificationChannel, boolean>>;
		rules: Partial<Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>>;
	}>,
): Promise<NotificationPreferences> {
	const res = await fetch(`${API_BASE}/api/notifications/preferences`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(updates),
	});
	if (!res.ok) {
		throw new Error(`Failed to update notification preferences: ${res.statusText}`);
	}
	const data = (await res.json()) as PreferencesResponse;
	if (!data.success || !data.preferences) {
		throw new Error("Invalid response: missing preferences data");
	}
	return data.preferences;
}

async function resetPreferences(): Promise<NotificationPreferences> {
	const res = await fetch(`${API_BASE}/api/notifications/preferences/reset`, {
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(`Failed to reset notification preferences: ${res.statusText}`);
	}
	const data = (await res.json()) as PreferencesResponse;
	if (!data.success || !data.preferences) {
		throw new Error("Invalid response: missing preferences data");
	}
	return data.preferences;
}

async function fetchChannels(): Promise<ChannelInfo[]> {
	const res = await fetch(`${API_BASE}/api/notifications/channels`);
	if (!res.ok) {
		throw new Error(`Failed to fetch notification channels: ${res.statusText}`);
	}
	const data = (await res.json()) as ChannelsResponse;
	if (!data.success || !data.channels) {
		throw new Error("Invalid response: missing channels data");
	}
	return data.channels;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const PREFERENCES_KEY = ["notification-preferences"];
const CHANNELS_KEY = ["notification-channels"];

export function useNotificationPreferences() {
	const queryClient = useQueryClient();

	const preferencesQuery = useQuery<NotificationPreferences>({
		queryKey: PREFERENCES_KEY,
		queryFn: fetchPreferences,
		staleTime: 60_000,
	});

	const channelsQuery = useQuery<ChannelInfo[]>({
		queryKey: CHANNELS_KEY,
		queryFn: fetchChannels,
		staleTime: 60_000,
	});

	const updateMutation = useMutation({
		mutationFn: async (
			updates: Partial<{
				enabled: boolean;
				channels: Partial<Record<NotificationChannel, boolean>>;
				rules: Partial<Record<NotificationType, Partial<Record<NotificationChannel, boolean>>>>;
			}>,
		) => {
			return updatePreferences(updates);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
		},
	});

	const resetMutation = useMutation({
		mutationFn: async () => {
			return resetPreferences();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
		},
	});

	return {
		// Data
		preferences: preferencesQuery.data ?? null,
		channels: channelsQuery.data ?? [],

		// Loading states
		isLoading: preferencesQuery.isLoading || channelsQuery.isLoading,
		isSaving: updateMutation.isPending || resetMutation.isPending,

		// Error states
		error: preferencesQuery.error ?? channelsQuery.error,

		// Actions
		updatePreferences: updateMutation.mutateAsync,
		resetPreferences: resetMutation.mutateAsync,
		refetch: () => {
			preferencesQuery.refetch();
			channelsQuery.refetch();
		},
	};
}
