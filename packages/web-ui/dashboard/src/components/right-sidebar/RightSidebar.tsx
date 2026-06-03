/**
 * RightSidebar — LEGACY (P42.10)
 *
 * @deprecated Replaced by contextual drawers in V3 cockpit.
 *   Kept for backward compatibility but NOT part of default layout.
 *   The permanent right sidebar must not be the default cockpit layout.
 *   Use TranscriptDrawer, ArtifactDrawer, DebugEventDrawer,
 *   FileEvidenceDrawer, or DirectiveDrawer instead.
 *
 * Three vertically stacked sections with clear separators:
 *   1. Events — filterable event feed (All / Errors)
 *   2. Alerts — collapsible section with badge count
 *   3. Cleanup Review — PlanSummaryPanel anchored to bottom
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	Bell,
	Filter,
} from "lucide-react";
import { EventLine } from "../EventLine";
import { PlanSummaryPanel } from "../PlanSummaryPanel";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlertEntry {
	id: string;
	type: "failed" | "conflict" | "blocked";
	workspaceId: string;
}

export interface RightSidebarProps {
	/** Raw event list */
	events: any[];
	/** Filter: "all" or "errors" */
	eventFilter: "all" | "errors";
	/** Called when filter changes */
	onEventFilterChange: (filter: "all" | "errors") => void;
	/** Alert entries (failed workspaces + conflicts) */
	alertEntries: AlertEntry[];
	/** Total number of alert issues (drives badge count) */
	totalAlertIssues: number;
	/** Project ID for PlanSummaryPanel */
	projectId: string | null;
	/** Plan execution ID for PlanSummaryPanel */
	planExecId: string | null;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * Section separator: thin line matching the BORD token.
 */
function SectionDivider() {
	return <div className={`h-px bg-[#E8E6E1] dark:bg-[#333] shrink-0`} />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RightSidebar({
	events,
	eventFilter,
	onEventFilterChange,
	alertEntries,
	totalAlertIssues,
	projectId,
	planExecId,
}: RightSidebarProps) {
	// Alerts collapsible state (controlled internally)
	const [alertsCollapsed, setAlertsCollapsed] = useState(false);

	const filteredEvents =
		eventFilter === "errors"
			? events.filter(
					(e: any) => e.type === "error" || e.level === "error",
				)
			: events;

	return (
		<div
			className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden h-full`}
		>
			{/* ─── Section 1: Events ─── */}
			<div
				className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}
			>
				<span
					className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}
				>
					Events
				</span>
				<div className="flex items-center gap-1">
					<button
						onClick={() => onEventFilterChange("all")}
						className={`h-6 px-2 rounded text-xs font-medium transition-colors ${
							eventFilter === "all"
								? "bg-stone-100 dark:bg-[#333] text-stone-700 dark:text-stone-200"
								: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
						}`}
					>
						All
					</button>
					<button
						onClick={() => onEventFilterChange("errors")}
						className={`h-6 px-2 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
							eventFilter === "errors"
								? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
								: `${MUT} hover:text-red-600 dark:hover:text-red-400`
						}`}
					>
						<Filter size={9} /> Errors
					</button>
				</div>
			</div>
			<div className="flex-1 min-h-0 overflow-y-auto">
				{filteredEvents.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-300 dark:text-stone-600">
						<Activity size={20} strokeWidth={1.2} />
						<p className="text-xs">No events</p>
					</div>
				) : (
					filteredEvents.map((ev: any, i: number) => (
						<EventLine key={ev.id ?? i} event={ev} />
					))
				)}
			</div>

			{/* ─── Section 2: Alerts (collapsible) ─── */}
			<SectionDivider />
			<div className={`shrink-0 ${SURF}`}>
				<button
					onClick={() => setAlertsCollapsed(!alertsCollapsed)}
					className={`w-full flex items-center px-4 h-9 border-b ${BORD} transition-colors hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
					aria-expanded={!alertsCollapsed}
				>
					<Bell
						size={11}
						className={`${MUT} mr-1.5 shrink-0`}
					/>
					<span
						className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}
					>
						Alerts
					</span>
					{totalAlertIssues > 0 && (
						<span className="ml-auto h-4 min-w-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold px-1">
							{totalAlertIssues}
						</span>
					)}
					<span className="ml-1.5 text-xs text-stone-400 dark:text-stone-500">
						{alertsCollapsed ? "▸" : "▾"}
					</span>
				</button>
				<div
					className={`transition-all duration-200 overflow-hidden ${
						alertsCollapsed
							? "max-h-0 opacity-0"
							: "max-h-[200px] opacity-100"
					}`}
				>
					<div className="max-h-40 overflow-y-auto">
						{totalAlertIssues === 0 ? (
							<div className="flex flex-col items-center justify-center py-6 gap-1 text-stone-300 dark:text-stone-600">
								<p className="text-xs">No alerts</p>
							</div>
						) : (
							<>
								{alertEntries
									.filter((a) => a.type === "failed")
									.map((entry) => (
										<div
											key={`alert-failed-${entry.id}`}
											className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-red-50/50 dark:bg-red-950/20`}
										>
											<AlertCircle
												size={11}
												className="shrink-0 text-red-500"
											/>
											<span className="text-red-700 dark:text-red-300 font-medium truncate">
												{entry.workspaceId}
											</span>
											<span
												className={`ml-auto text-xs ${MUT} shrink-0`}
											>
												failed
											</span>
										</div>
									))}
								{alertEntries
									.filter((a) => a.type === "conflict")
									.map((entry) => (
										<div
											key={`alert-conflict-${entry.id}`}
											className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-amber-50/50 dark:bg-amber-950/20`}
										>
											<AlertTriangle
												size={11}
												className="shrink-0 text-amber-500"
											/>
											<span className="text-amber-700 dark:text-amber-300 font-medium truncate">
												{entry.workspaceId}
											</span>
											<span
												className={`ml-auto text-xs ${MUT} shrink-0`}
											>
												conflict
											</span>
										</div>
									))}
								{alertEntries
									.filter((a) => a.type === "blocked")
									.map((entry) => (
										<div
											key={`alert-blocked-${entry.id}`}
											className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-amber-50/50 dark:bg-amber-950/20`}
										>
											<AlertCircle
												size={11}
												className="shrink-0 text-amber-500"
											/>
											<span className="text-amber-700 dark:text-amber-300 font-medium truncate">
												{entry.workspaceId}
											</span>
											<span
												className={`ml-auto text-xs ${MUT} shrink-0`}
											>
												blocked
											</span>
										</div>
									))}
							</>
						)}
					</div>
				</div>
			</div>

			{/* ─── Section 3: Cleanup Review (sticky bottom) ─── */}
			<SectionDivider />
			<div className="flex-1 min-h-0 overflow-y-auto">
				<div
					className={`shrink-0 flex items-center px-4 h-9 border-b ${BORD}`}
				>
					<span
						className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}
					>
						CLEANUP REVIEW
					</span>
				</div>
				<div className="p-3">
					<PlanSummaryPanel
						projectId={projectId}
						planExecId={planExecId}
					/>
				</div>
			</div>
		</div>
	);
}
