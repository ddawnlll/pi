/**
 * Pi Dashboard — Canonical Status Vocabulary
 *
 * Normalizes raw API status strings into a consistent display vocabulary.
 * Components should use STATUS_LABELS for display text and STATUS_COLORS for visual variants.
 * The raw API status is preserved; this module only affects display.
 */

// ─── Canonical domain status type ──────────────────────────────────────

export type WorkerStatus =
	| "queued"
	| "running"
	| "blocked"
	| "waiting"
	| "failed"
	| "completed"
	| "cancelled"
	| "unknown";

// ─── Raw → canonical mapping ──────────────────────────────────────────

/**
 * Map raw API status strings (from WorkerSummary.stage, PlanExecution.status, etc.)
 * to the canonical WorkerStatus.
 */
export function normalizeStatus(raw: string | undefined | null): WorkerStatus {
	if (!raw) return "unknown";
	const s = raw.toLowerCase().trim();
	switch (s) {
		case "pending":
		case "ready":
			return "queued";
		case "active":
		case "running":
			return "running";
		case "blocked":
			return "blocked";
		case "waiting":
			return "waiting";
		case "failed":
			return "failed";
		case "complete":
		case "completed":
		case "done":
			return "completed";
		case "cancelled":
		case "stopped":
		case "canceled":
			return "cancelled";
		case "paused":
			return "waiting";
		default:
			return "unknown";
	}
}

// ─── Display labels ────────────────────────────────────────────────────

export const STATUS_LABELS: Record<WorkerStatus, string> = {
	queued: "Queued",
	running: "Running",
	blocked: "Blocked",
	waiting: "Waiting",
	failed: "Failed",
	completed: "Completed",
	cancelled: "Cancelled",
	unknown: "Unknown",
};

// ─── Visual color variants ─────────────────────────────────────────────

export interface StatusColors {
	dot: string;
	bg: string;
	text: string;
	border: string;
}

export const STATUS_COLORS: Record<WorkerStatus, StatusColors> = {
	queued: {
		dot: "bg-amber-500",
		bg: "bg-amber-50 dark:bg-amber-900/30",
		text: "text-amber-700 dark:text-amber-400",
		border: "border-amber-200 dark:border-amber-800",
	},
	running: {
		dot: "bg-emerald-500",
		bg: "bg-emerald-50 dark:bg-emerald-900/30",
		text: "text-emerald-700 dark:text-emerald-400",
		border: "border-emerald-200 dark:border-emerald-800",
	},
	blocked: {
		dot: "bg-red-500",
		bg: "bg-red-50 dark:bg-red-900/30",
		text: "text-red-700 dark:text-red-400",
		border: "border-red-200 dark:border-red-800",
	},
	waiting: {
		dot: "bg-blue-500",
		bg: "bg-blue-50 dark:bg-blue-900/30",
		text: "text-blue-700 dark:text-blue-400",
		border: "border-blue-200 dark:border-blue-800",
	},
	failed: {
		dot: "bg-red-500",
		bg: "bg-red-50 dark:bg-red-900/30",
		text: "text-red-700 dark:text-red-400",
		border: "border-red-200 dark:border-red-800",
	},
	completed: {
		dot: "bg-emerald-500",
		bg: "bg-emerald-50 dark:bg-emerald-900/30",
		text: "text-emerald-700 dark:text-emerald-400",
		border: "border-emerald-200 dark:border-emerald-800",
	},
	cancelled: {
		dot: "bg-stone-400",
		bg: "bg-stone-100 dark:bg-stone-800/50",
		text: "text-stone-600 dark:text-stone-400",
		border: "border-stone-200 dark:border-stone-700",
	},
	unknown: {
		dot: "bg-stone-300 dark:bg-stone-600",
		bg: "bg-stone-100 dark:bg-stone-800/30",
		text: "text-stone-500 dark:text-stone-400",
		border: "border-stone-200 dark:border-stone-700",
	},
};
