/**
 * DriftAlertBadge — Drift indicator badge for the Goal Board header.
 *
 * Shows a count of open drift reports with color-coded severity.
 * Clicking navigates to the drift details.
 */

import type { GoalDriftReport, DriftSeverity } from "../../../hooks/useGoals";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Severity colors
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<DriftSeverity, { bg: string; text: string; dot: string }> = {
	high: {
		bg: "bg-red-50 dark:bg-red-900/20",
		text: "text-red-700 dark:text-red-300",
		dot: "bg-red-500",
	},
	medium: {
		bg: "bg-amber-50 dark:bg-amber-900/20",
		text: "text-amber-700 dark:text-amber-300",
		dot: "bg-amber-400",
	},
	low: {
		bg: "bg-yellow-50 dark:bg-yellow-900/20",
		text: "text-yellow-700 dark:text-yellow-300",
		dot: "bg-yellow-400",
	},
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DriftAlertBadgeProps {
	reports: GoalDriftReport[];
	/** Open/unresolved count override (computed from reports if not provided) */
	openCount?: number;
	onClick?: () => void;
	className?: string;
}

/**
 * DriftAlertBadge — Displays a count of open drift reports with severity
 * indicators. Shows "No drift" when there are no open reports.
 */
export function DriftAlertBadge({ reports, openCount, onClick, className = "" }: DriftAlertBadgeProps) {
	const open = openCount ?? reports.filter((r) => !r.resolvedAt).length;

	if (open === 0) {
		return (
			<div className={`flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/15 ${className}`}>
				<span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
				<span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">No drift</span>
			</div>
		);
	}

	// Find highest severity among open reports
	const highestSeverity: DriftSeverity = reports
		.filter((r) => !r.resolvedAt)
		.reduce<DriftSeverity>((max, r) => {
			const order: DriftSeverity[] = ["low", "medium", "high"];
			return order.indexOf(r.severity) > order.indexOf(max) ? r.severity : max;
		}, "low");

	const severityStyle = SEVERITY_STYLES[highestSeverity] ?? SEVERITY_STYLES.low;

	return (
		<button
			onClick={onClick}
			className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors ${severityStyle.bg} hover:opacity-80 ${className}`}
		>
			<span className={`w-1.5 h-1.5 rounded-full animate-pulse ${severityStyle.dot}`} />
			<span className={`text-[10px] font-semibold ${severityStyle.text}`}>
				{open} drift alert{open !== 1 ? "s" : ""}
			</span>
		</button>
	);
}
