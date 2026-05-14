/**
 * ScaleModeSettings — Dashboard component for scale mode configuration.
 *
 * Workspace 6.F — Safe 6+ Worker Mode.
 * Workspace 6.J — Dashboard scale controls and integration visibility.
 *
 * Acceptance Criteria:
 * - AC4: User can see why 6-worker mode is enabled/blocked
 * - AC5: Dashboard shows current scale mode and prerequisite status
 * - AC6: Stable default remains 3 workers
 *
 * Displays:
 * - Current scale mode (stable vs scale)
 * - Prerequisite checklist (worktree isolation, integration queue, validation lock)
 * - Overall readiness status
 * - Worker count configuration
 */

import { CheckCircle, XCircle, AlertTriangle, Cpu, Shield, GitBranch, Layers, Lock, RefreshCw } from "lucide-react";
import { useScaleModeReadiness } from "../hooks/useScaleStatus";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Prerequisite icon map ──────────────────────────────────────────────────

const PREREQ_ICONS: Record<string, React.ReactNode> = {
	worktree_isolation: <GitBranch size={14} strokeWidth={2} />,
	integration_queue: <Layers size={14} strokeWidth={2} />,
	validation_lock: <Lock size={14} strokeWidth={2} />,
};

// ─── Prerequisite row component ─────────────────────────────────────────────

interface PrerequisiteRowProps {
	status: {
		key: string;
		name: string;
		met: boolean;
		message: string;
	};
}

/** A single prerequisite status row. */
function PrerequisiteRow({ status }: PrerequisiteRowProps) {
	const icon = PREREQ_ICONS[status.key] ?? <Shield size={14} strokeWidth={2} />;

	return (
		<div className="flex items-start gap-2.5 py-2">
			<div className="mt-0.5 shrink-0">
				{status.met ? (
					<CheckCircle size={15} className="text-emerald-600 dark:text-emerald-400" />
				) : (
					<XCircle size={15} className="text-red-500 dark:text-red-400" />
				)}
			</div>
			<div className="flex items-center gap-1.5 min-w-0">
				<span className={`shrink-0 ${MUT}`}>{icon}</span>
				<div className="min-w-0">
					<span className={`text-sm font-medium ${TXT}`}>{status.name}</span>
					<p className={`text-[11px] leading-tight mt-0.5 ${MUT}`}>{status.message}</p>
				</div>
			</div>
		</div>
	);
}

// ─── Main component ─────────────────────────────────────────────────────────

interface ScaleModeSettingsProps {
	/** Optional class name. */
	className?: string;
}

/**
 * ScaleModeSettings component.
 *
 * Shows the current scale mode state with a prerequisite checklist
 * and overall readiness status. Fetches live data from the API.
 * Designed to be embedded in the settings dialog or scheduler status panel.
 */
export function ScaleModeSettings({ className }: ScaleModeSettingsProps) {
	const { data: readiness, isLoading, error } = useScaleModeReadiness();

	// Determine overall status icon and colors
	const getStatusDisplay = () => {
		if (isLoading) {
			return {
				icon: <RefreshCw size={16} className="animate-spin" />,
				label: "Loading...",
				color: MUT,
				bgColor: "bg-stone-50 dark:bg-[#222]",
			};
		}
		if (!readiness) {
			return {
				icon: <AlertTriangle size={16} />,
				label: "Unknown",
				color: MUT,
				bgColor: "bg-stone-50 dark:bg-[#222]",
			};
		}
		if (readiness.isScaleModeActive && readiness.ready) {
			return {
				icon: <CheckCircle size={16} />,
				label: "Ready",
				color: "text-emerald-600 dark:text-emerald-400",
				bgColor: "bg-emerald-50 dark:bg-emerald-900/20",
			};
		}
		if (readiness.isScaleModeActive && !readiness.ready) {
			return {
				icon: <XCircle size={16} />,
				label: "Blocked",
				color: "text-red-600 dark:text-red-400",
				bgColor: "bg-red-50 dark:bg-red-900/20",
			};
		}
		// Stable mode
		if (readiness.prerequisites.every((p) => p.met)) {
			return {
				icon: <CheckCircle size={16} />,
				label: "Stable (prerequisites met)",
				color: "text-blue-600 dark:text-blue-400",
				bgColor: "bg-blue-50 dark:bg-blue-900/20",
			};
		}
		return {
			icon: <AlertTriangle size={16} />,
			label: "Stable (prerequisites incomplete)",
			color: "text-amber-600 dark:text-amber-400",
			bgColor: "bg-amber-50 dark:bg-amber-900/20",
		};
	};

	const status = getStatusDisplay();

	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3 ${className ?? ""}`}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Cpu size={16} className={ACC_TXT} />
					<h3 className={`text-sm font-semibold ${TXT}`}>Scale Mode</h3>
				</div>
				{/* Mode badge */}
				<span
					className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${status.color} ${status.bgColor}`}
				>
					{status.icon}
					{status.label}
				</span>
			</div>

			{/* Error state */}
			{error && (
				<div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/10 rounded px-2.5 py-2">
					<AlertTriangle size={14} className="text-red-500 shrink-0" />
					<p className="text-[11px] text-red-600 dark:text-red-400">
						Failed to load scale mode: {String(error)}
					</p>
				</div>
			)}

			{/* Worker count info */}
			<div className="flex items-center gap-2 text-xs">
				<span className={MUT}>Workers:</span>
				<span className={`font-medium tabular-nums ${TXT}`}>
					{readiness?.requestedWorkers ?? 3}
				</span>
				{readiness?.experimentalModeEnabled && (
					<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-[10px] font-medium text-amber-700 dark:text-amber-300">
						scale enabled
					</span>
				)}
			</div>

			{/* Prerequisite checklist */}
			<div className="border-t ${BORD} pt-2">
				<h4 className={`text-[10px] uppercase tracking-widest font-semibold mb-1 ${MUT}`}>
					Prerequisites
				</h4>
				<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
					{readiness ? (
						readiness.prerequisites.map((prereq) => (
							<PrerequisiteRow key={prereq.key} status={prereq} />
						))
					) : (
						<p className={`text-xs py-2 ${MUT}`}>No readiness data available.</p>
					)}
				</div>
			</div>

			{/* Errors */}
			{readiness && readiness.errors.length > 0 && (
				<div className="bg-red-50 dark:bg-red-900/10 rounded px-2.5 py-1.5">
					<p className={`text-[11px] font-medium text-red-700 dark:text-red-300 mb-1`}>
						Blocking Issues:
					</p>
					<ul className="space-y-0.5">
						{readiness.errors.map((err, i) => (
							<li key={i} className="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1">
								<span className="shrink-0 mt-0.5">•</span>
								<span>{err}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Warnings */}
			{readiness && readiness.warnings.length > 0 && (
				<div className="bg-amber-50 dark:bg-amber-900/10 rounded px-2.5 py-1.5">
					<p className={`text-[11px] font-medium text-amber-700 dark:text-amber-300 mb-1`}>
						Warnings:
					</p>
					<ul className="space-y-0.5">
						{readiness.warnings.map((warn, i) => (
							<li key={i} className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
								<span className="shrink-0 mt-0.5">•</span>
								<span>{warn}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* Help text */}
			<p className={`text-[10px] leading-tight ${MUT}`}>
				Scale mode (4-6 workers) requires worktree isolation, integration queue,
				and global validation lock.{' '}
				<strong>Stable default: 3 workers</strong>.
			</p>
		</div>
	);
}
