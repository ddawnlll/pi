/**
 * PiInbox — Pi Inbox & Message Center UI (24.M).
 *
 * Displays system messages from various sources with:
 * - Collapsible detail view per message
 * - Priority-based color coding
 * - Type-based icons
 * - Read/unread state management
 * - Bulk actions (mark all read, purge read, clear)
 * - Loading, empty, error, and stale states
 *
 * Hook: usePiInbox / usePiInboxStats
 * API:  GET /api/pi/inbox
 */

import { useMemo, useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	AlertCircle,
	Archive,
	Bell,
	BellOff,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	Clock,
	Database,
	Eye,
	FileText,
	Filter,
	Info,
	Inbox,
	Loader2,
	Mail,
	MailOpen,
	Moon,
	RefreshCw,
	Shield,
	Target,
	Trash2,
	TriangleAlert,
	X,
} from "lucide-react";
import {
	usePiInbox,
	usePiInboxStats,
	useMarkRead,
	useMarkAllRead,
	useDeleteMessage,
	usePurgeRead,
	useClearInbox,
} from "../../hooks/usePiInbox";
import type { PiInboxMessage, PiInboxMessageType, PiInboxMessagePriority } from "../../hooks/usePiInbox";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Type config
// ---------------------------------------------------------------------------

const TYPE_CONFIG: Record<PiInboxMessageType, { label: string; icon: typeof Bell; color: string; bg: string }> = {
	system_notification: {
		label: "System",
		icon: Bell,
		color: "text-blue-700 dark:text-blue-300",
		bg: "bg-blue-50 dark:bg-blue-900/20",
	},
	daemon_alert: {
		label: "Daemon",
		icon: Moon,
		color: "text-purple-600 dark:text-purple-400",
		bg: "bg-purple-50 dark:bg-purple-900/20",
	},
	brain_observation: {
		label: "Observation",
		icon: Eye,
		color: "text-teal-600 dark:text-teal-400",
		bg: "bg-teal-50 dark:bg-teal-900/20",
	},
	proposal_generated: {
		label: "Proposal",
		icon: FileText,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/20",
	},
	plan_completed: {
		label: "Plan Done",
		icon: CheckCheck,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-900/20",
	},
	plan_failed: {
		label: "Plan Failed",
		icon: X,
		color: "text-red-600 dark:text-red-400",
		bg: "bg-red-50 dark:bg-red-900/20",
	},
	task_completed: {
		label: "Task Done",
		icon: CheckCheck,
		color: "text-emerald-600 dark:text-emerald-400",
		bg: "bg-emerald-50 dark:bg-emerald-900/20",
	},
	memory_conflict: {
		label: "Memory",
		icon: Database,
		color: "text-orange-600 dark:text-orange-400",
		bg: "bg-orange-50 dark:bg-orange-900/20",
	},
	goal_drift: {
		label: "Goal Drift",
		icon: Target,
		color: "text-rose-600 dark:text-rose-400",
		bg: "bg-rose-50 dark:bg-rose-900/20",
	},
	approval_required: {
		label: "Approval",
		icon: Shield,
		color: "text-indigo-600 dark:text-indigo-400",
		bg: "bg-indigo-50 dark:bg-indigo-900/20",
	},
	warning: {
		label: "Warning",
		icon: TriangleAlert,
		color: "text-amber-600 dark:text-amber-400",
		bg: "bg-amber-50 dark:bg-amber-900/20",
	},
	info: {
		label: "Info",
		icon: Info,
		color: "text-blue-700 dark:text-blue-300",
		bg: "bg-blue-50 dark:bg-blue-900/20",
	},
};

// ---------------------------------------------------------------------------
// Priority styling
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<PiInboxMessagePriority, { dot: string; label: string; badge: string }> = {
	low: {
		dot: "bg-stone-400 dark:bg-stone-500",
		label: "Low",
		badge: "bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500",
	},
	normal: {
		dot: "bg-blue-500 dark:bg-blue-400",
		label: "Normal",
		badge: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
	},
	high: {
		dot: "bg-amber-500 dark:bg-amber-400",
		label: "High",
		badge: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",
	},
	critical: {
		dot: "bg-red-500 dark:bg-red-400",
		label: "Critical",
		badge: "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400",
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | undefined): string {
	if (!iso) return "";
	const ts = new Date(iso).getTime();
	const now = Date.now();
	const diff = now - ts;
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);

	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;

	return new Date(ts).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function timeAgo(iso: string): string {
	return formatTimestamp(iso);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Priority dot indicator. */
function PriorityDot({ priority }: { priority: PiInboxMessagePriority }) {
	return (
		<span
			className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_STYLES[priority].dot}`}
			title={PRIORITY_STYLES[priority].label}
		/>
	);
}

/** Type badge with icon + label. */
function TypeBadge({ type }: { type: PiInboxMessageType }) {
	const cfg = TYPE_CONFIG[type];
	return (
		<span
			className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full border ${BORD} ${cfg.color} ${cfg.bg}`}
		>
			<cfg.icon size={9} />
			{cfg.label}
		</span>
	);
}

// ---------------------------------------------------------------------------
// MessageRow — Collapsible detail row
// ---------------------------------------------------------------------------

function MessageRow({
	message,
	expanded,
	onToggle,
	onMarkRead,
	onDelete,
}: {
	message: PiInboxMessage;
	expanded: boolean;
	onToggle: () => void;
	onMarkRead: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const typeCfg = TYPE_CONFIG[message.type];
	const TypeIcon = typeCfg.icon;

	return (
		<div
			className={`border-b ${BORD} ${
				!message.read ? "bg-blue-50/30 dark:bg-blue-900/10" : SURF
			} transition-colors`}
		>
			{/* Collapsed row */}
			<button
				onClick={onToggle}
				className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors"
			>
				{/* Type icon */}
				<div
					className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 mt-0.5 ${typeCfg.bg}`}
				>
					<TypeIcon size={13} strokeWidth={1.8} className={typeCfg.color} />
				</div>

				{/* Main content */}
				<div className="flex-1 min-w-0">
					{/* Title row */}
					<div className="flex items-center gap-2 mb-0.5">
						{!message.read && (
							<span className="w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400 shrink-0" />
						)}
						<h3
							className={`text-sm font-semibold truncate ${
								!message.read ? "text-stone-900 dark:text-stone-100" : TXT
							}`}
						>
							{message.title}
						</h3>
						{expanded ? (
							<ChevronDown size={12} className={`shrink-0 ${MUT}`} />
						) : (
							<ChevronRight size={12} className={`shrink-0 ${MUT}`} />
						)}
					</div>

					{/* Tags row */}
					<div className="flex items-center gap-1.5 mb-1 flex-wrap">
						<TypeBadge type={message.type} />
						<span
							className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_STYLES[message.priority].badge}`}
						>
							<PriorityDot priority={message.priority} />
							{PRIORITY_STYLES[message.priority].label}
						</span>
						{message.source && (
							<span
								className={`text-xs px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 border ${BORD}`}
							>
								{message.source}
							</span>
						)}
					</div>

					{/* Body snippet + time */}
					<div className="flex items-center gap-2">
						<p
							className={`text-xs ${MUT} leading-relaxed line-clamp-1 flex-1`}
						>
							{message.body}
						</p>
						<span className={`text-xs ${MUT} shrink-0`}>
							{timeAgo(message.createdAt)}
						</span>
					</div>
				</div>
			</button>

			{/* Expanded detail */}
			{expanded && (
				<div className={`px-4 pb-4 pt-1 border-t ${BORD} ${SURF}`}>
					{/* Body */}
					<div className="mb-3">
						<h4
							className={`text-xs font-semibold uppercase tracking-widest ${MUT} mb-1`}
						>
							Message
						</h4>
						<p
							className={`text-xs ${TXT} leading-relaxed bg-stone-50 dark:bg-[#222] rounded-lg px-3 py-2 border ${BORD}`}
						>
							{message.body}
						</p>
					</div>

					{/* Metadata */}
					<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
						<div>
							<span className={MUT}>ID: </span>
							<span className={`font-mono ${TXT}`}>
								{message.id.slice(0, 8)}...
							</span>
						</div>
						<div>
							<span className={MUT}>Created: </span>
							<span className={TXT}>
								{new Date(message.createdAt).toLocaleString()}
							</span>
						</div>
						{message.readAt && (
							<div>
								<span className={MUT}>Read: </span>
								<span className={TXT}>
									{new Date(message.readAt).toLocaleString()}
								</span>
							</div>
						)}
						{message.actionUrl && (
							<div>
								<span className={MUT}>Action: </span>
								<span className="text-blue-700 dark:text-blue-300 underline">
									{message.actionUrl}
								</span>
							</div>
						)}
					</div>

					{/* Actions */}
					<div className="flex items-center gap-2 mt-3">
						{!message.read && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onMarkRead(message.id);
								}}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-stone-600 dark:text-stone-400"
							>
								<MailOpen size={10} /> Mark Read
							</button>
						)}
						<button
							onClick={(e) => {
								e.stopPropagation();
								onDelete(message.id);
							}}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400"
						>
							<Trash2 size={10} /> Delete
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 p-8">
			<Inbox size={32} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
			<p className={`text-sm ${MUT}`}>Inbox is empty</p>
			<p className={`text-xs ${MUT} text-center max-w-sm`}>
				Your inbox is all clear. System notifications, alerts, and updates will appear here
				when they arrive.
			</p>
		</div>
	);
}

function EmptyFilteredState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 p-8">
			<Filter size={28} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
			<p className={`text-sm ${MUT}`}>No matching messages</p>
			<p className={`text-xs ${MUT} text-center max-w-sm`}>
				No messages match the current filter. Try adjusting your filter criteria.
			</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// LoadingState
// ---------------------------------------------------------------------------

function LoadingState() {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3">
			<Loader2 size={20} className="animate-spin text-stone-400" />
			<p className={`text-sm ${MUT}`}>Loading inbox...</p>
		</div>
	);
}

// ---------------------------------------------------------------------------
// ErrorState
// ---------------------------------------------------------------------------

function ErrorState({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center h-full gap-3 p-8">
			<AlertCircle size={24} strokeWidth={1.5} className="text-red-500" />
			<p className="text-sm text-red-600 dark:text-red-400 font-medium">
				Failed to load inbox
			</p>
			<p className={`text-xs ${MUT} text-center max-w-sm`}>{error}</p>
			<button
				onClick={onRetry}
				className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-stone-800 dark:text-stone-200"
			>
				<RefreshCw size={12} /> Retry
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
	unreadOnly: boolean;
	onToggleUnreadOnly: () => void;
	selectedType: PiInboxMessageType | "all";
	onTypeChange: (type: PiInboxMessageType | "all") => void;
	selectedPriority: PiInboxMessagePriority | "all";
	onPriorityChange: (priority: PiInboxMessagePriority | "all") => void;
}

const TYPE_FILTER_OPTIONS: Array<{ value: PiInboxMessageType | "all"; label: string }> = [
	{ value: "all", label: "All Types" },
	...Object.entries(TYPE_CONFIG).map(([value, cfg]) => ({
		value: value as PiInboxMessageType,
		label: cfg.label,
	})),
];

const PRIORITY_FILTER_OPTIONS: Array<{ value: PiInboxMessagePriority | "all"; label: string }> = [
	{ value: "all", label: "All Priorities" },
	{ value: "critical", label: "Critical" },
	{ value: "high", label: "High" },
	{ value: "normal", label: "Normal" },
	{ value: "low", label: "Low" },
];

function FilterBar({
	unreadOnly,
	onToggleUnreadOnly,
	selectedType,
	onTypeChange,
	selectedPriority,
	onPriorityChange,
}: FilterBarProps) {
	return (
		<div
			className={`shrink-0 flex items-center gap-2 px-4 py-2 border-b ${BORD} ${SURF}`}
		>
			{/* Unread toggle */}
			<button
				onClick={onToggleUnreadOnly}
				className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${
					unreadOnly
						? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
						: `${BORD} ${MUT} hover:text-stone-700 dark:hover:text-stone-300`
				}`}
			>
				{unreadOnly ? <Mail size={10} /> : <MailOpen size={10} />}
				Unread only
			</button>

			{/* Type filter */}
			<select
				value={selectedType}
				onChange={(e) => onTypeChange(e.target.value as PiInboxMessageType | "all")}
				className={`text-xs px-2 py-1 rounded-lg border ${BORD} ${SURF} ${TXT} outline-none`}
			>
				{TYPE_FILTER_OPTIONS.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>

			{/* Priority filter */}
			<select
				value={selectedPriority}
				onChange={(e) =>
					onPriorityChange(e.target.value as PiInboxMessagePriority | "all")
				}
				className={`text-xs px-2 py-1 rounded-lg border ${BORD} ${SURF} ${TXT} outline-none`}
			>
				{PRIORITY_FILTER_OPTIONS.map((opt) => (
					<option key={opt.value} value={opt.value}>
						{opt.label}
					</option>
				))}
			</select>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inbox Icon Component (for import)
// ---------------------------------------------------------------------------

export { Inbox };

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface PiInboxProps {
	className?: string;
}

export function PiInbox({ className = "" }: PiInboxProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [unreadOnly, setUnreadOnly] = useState(false);
	const [selectedType, setSelectedType] = useState<PiInboxMessageType | "all">("all");
	const [selectedPriority, setSelectedPriority] = useState<PiInboxMessagePriority | "all">("all");

	// Build query params from filters
	const queryParams = useMemo(() => {
		const params: {
			type?: PiInboxMessageType;
			priority?: PiInboxMessagePriority;
			read?: boolean;
			limit?: number;
		} = {};
		if (selectedType !== "all") params.type = selectedType;
		if (selectedPriority !== "all") params.priority = selectedPriority;
		if (unreadOnly) params.read = false;
		params.limit = 200;
		return params;
	}, [selectedType, selectedPriority, unreadOnly]);

	const {
		data: inboxData,
		isLoading,
		error,
		refetch,
		dataUpdatedAt,
		isRefetching,
	} = usePiInbox(queryParams);

	const { data: statsData } = usePiInboxStats();

	const markReadMutation = useMarkRead();
	const markAllReadMutation = useMarkAllRead();
	const deleteMutation = useDeleteMessage();
	const purgeReadMutation = usePurgeRead();
	const clearMutation = useClearInbox();

	// Toggle expanded entry
	const handleToggle = (messageId: string) => {
		setExpandedId((prev) => (prev === messageId ? null : messageId));
	};

	// Mark single as read
	const handleMarkRead = async (id: string) => {
		await markReadMutation.mutateAsync(id);
	};

	// Delete single
	const handleDelete = async (id: string) => {
		await deleteMutation.mutateAsync(id);
		if (expandedId === id) setExpandedId(null);
	};

	// Mark all as read
	const handleMarkAllRead = async () => {
		await markAllReadMutation.mutateAsync();
	};

	// Purge read
	const handlePurgeRead = async () => {
		await purgeReadMutation.mutateAsync();
	};

	// Clear all
	const handleClear = async () => {
		await clearMutation.mutateAsync();
	};

	// Determine data freshness
	const isStale = useMemo(() => {
		if (!dataUpdatedAt) return false;
		return Date.now() - dataUpdatedAt > 60_000;
	}, [dataUpdatedAt]);

	// Loading state
	if (isLoading && !inboxData) {
		return (
			<div className={`h-full ${BG} ${className}`}>
				<LoadingState />
			</div>
		);
	}

	// Error state
	if (error && !inboxData) {
		return (
			<div className={`h-full ${BG} ${className}`}>
				<ErrorState error={String(error)} onRetry={() => refetch()} />
			</div>
		);
	}

	const messages = inboxData?.messages ?? [];
	const total = inboxData?.total ?? 0;
	const unread = inboxData?.unread ?? statsData?.stats?.unread ?? 0;

	return (
		<div className={`flex flex-col h-full overflow-hidden ${BG} ${className}`}>
			{/* Header */}
			<div
				className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD} ${SURF}`}
			>
				<Bell size={14} strokeWidth={1.8} className={ACC_TXT} />
				<span className={`text-xs font-semibold ${TXT}`}>Pi Inbox</span>

				{/* Unread count badge */}
				{unread > 0 && (
					<span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
						<span className="w-1.5 h-1.5 rounded-full bg-red-500 dark:bg-red-400" />
						{unread} unread
					</span>
				)}

				<div className="flex-1" />

				{/* Mark all read */}
				{unread > 0 && (
					<button
						onClick={handleMarkAllRead}
						disabled={markAllReadMutation.isPending}
						className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-stone-600 dark:text-stone-400 disabled:opacity-40 transition-colors"
						title="Mark all as read"
					>
						<MailOpen size={10} /> Mark All Read
					</button>
				)}

				{/* Refresh */}
				<button
					onClick={() => refetch()}
					disabled={isRefetching}
					className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors`}
					title="Refresh inbox"
				>
					<RefreshCw
						size={13}
						strokeWidth={1.8}
						className={isRefetching ? "animate-spin" : ""}
					/>
				</button>
			</div>

			{/* Filter bar */}
			<FilterBar
				unreadOnly={unreadOnly}
				onToggleUnreadOnly={() => setUnreadOnly((v) => !v)}
				selectedType={selectedType}
				onTypeChange={setSelectedType}
				selectedPriority={selectedPriority}
				onPriorityChange={setSelectedPriority}
			/>

			{/* Stale data warning */}
			{isStale && messages.length > 0 && (
				<div
					className={`shrink-0 flex items-center gap-2 px-4 py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b ${BORD}`}
				>
					<Clock size={10} />
					<span>Data may be stale.</span>
					<button
						onClick={() => refetch()}
						className="ml-auto text-xs font-medium underline hover:no-underline"
					>
						Refresh
					</button>
				</div>
			)}

			{/* Body */}
			<div className="flex-1 min-h-0 overflow-hidden flex flex-col">
				{/* Summary bar */}
				{messages.length > 0 && (
					<div
						className={`shrink-0 flex items-center gap-3 px-4 py-2 border-b ${BORD} ${SURF}`}
					>
						<span className={`text-xs ${MUT}`}>
							Showing {messages.length} of {total} messages
							{unread > 0 && ` (${unread} unread)`}
						</span>

						<div className="flex-1" />

						{/* Purge read */}
						{unread < total && (
							<button
								onClick={handlePurgeRead}
								disabled={purgeReadMutation.isPending}
								className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-stone-400 dark:text-stone-500 disabled:opacity-40 transition-colors"
							>
								<Archive size={9} /> Purge Read
							</button>
						)}

						{/* Clear all */}
						<button
							onClick={handleClear}
							disabled={clearMutation.isPending}
							className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400 disabled:opacity-40 transition-colors"
						>
							<Trash2 size={9} /> Clear All
						</button>

						{isRefetching && (
							<span className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300">
								<Loader2 size={9} className="animate-spin" />
								Refreshing...
							</span>
						)}
					</div>
				)}

				{/* Messages list or empty state */}
				{messages.length === 0 ? (
					<div className="flex-1">
						{unreadOnly || selectedType !== "all" || selectedPriority !== "all" ? (
							<EmptyFilteredState />
						) : (
							<EmptyState />
						)}
					</div>
				) : (
					<div className="flex-1 min-h-0 overflow-y-auto">
						{messages.map((message) => (
							<MessageRow
								key={message.id}
								message={message}
								expanded={expandedId === message.id}
								onToggle={() => handleToggle(message.id)}
								onMarkRead={handleMarkRead}
								onDelete={handleDelete}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
