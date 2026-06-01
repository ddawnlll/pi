/**
 * CockpitPanels — Minimal Dashboard Cockpit Panels container (P41.12).
 *
 * Groups the following minimal panels together for a complete cockpit view:
 * - Plan Overview (delegates to PlanSummaryPanel)
 * - Worker List (delegates to existing WorkerList in run view)
 * - Worker Detail (delegates to WorkerContextInspector)
 * - Live Logs (delegates to LiveLogTerminal)
 * - File Tree (delegates to FileExplorer)
 * - Diff metadata (delegates to DiffViewer/DagDiffViewer)
 * - Lead/Escalation (LeadEscalationPanel)
 * - Control Actions (ControlActionsPanel)
 * - Human Directives (HumanDirectivePanel)
 *
 * This component is designed to be rendered in the dashboard run view as
 * a compact, minimal cockpit section without requiring a full dashboard rewrite.
 *
 * Acceptance Criteria:
 * - minimal panels exist
 * - panels consume read models/APIs
 * - no full dashboard rewrite
 */

import { useState } from "react";
import {
	Activity,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	FileCode,
	FolderTree,
	MessageSquare,
	Sparkles,
	Terminal,
	User,
} from "lucide-react";
import type { JournalEvent, WorkerInfo } from "../types";
import { WorkerContextInspector } from "./WorkerContextInspector";
import { LeadEscalationPanel } from "./LeadEscalationPanel";
import { HumanDirectivePanel } from "./HumanDirectivePanel";
import { ControlActionsPanel } from "./ControlActionsPanel";
import { PlanSummaryPanel } from "./PlanSummaryPanel";
import { LiveLogTerminal } from "./LiveLogTerminal";
import { FileExplorer } from "./FileExplorer";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";

// ─── Section definitions ───────────────────────────────────────────────────

interface Section {
	id: string;
	label: string;
	icon: typeof Activity;
	defaultExpanded?: boolean;
}

const SECTIONS: Section[] = [
	{ id: "plan-summary", label: "Plan Summary", icon: Sparkles, defaultExpanded: true },
	{ id: "worker-context", label: "Worker Context", icon: User, defaultExpanded: true },
	{ id: "live-logs", label: "Live Logs", icon: Terminal, defaultExpanded: true },
	{ id: "file-explorer", label: "File Explorer", icon: FolderTree },
	{ id: "escalations", label: "Escalations", icon: AlertTriangle },
	{ id: "directives", label: "Directives", icon: MessageSquare },
	{ id: "control", label: "Control Actions", icon: FileCode },
];

// ─── Component ─────────────────────────────────────────────────────────────

interface CockpitPanelsProps {
	/** Project ID */
	projectId: string | null;
	/** Plan execution ID */
	planExecId: string | null;
	/** Selected workspace ID (for context-specific panels) */
	selectedWorkerId: string | null;
	/** Current workspace stage */
	workspaceStage?: string;
	/** Workers list for live logs and related panels */
	workers?: WorkerInfo[];
	/** Plan events for live logs panel */
	planEvents?: JournalEvent[];
	/** Optional class name */
	className?: string;
}

/**
 * Minimal Dashboard Cockpit Panels container.
 *
 * Groups all minimal cockpit panels into collapsible sections
 * for a complete overview and control surface.
 */
export function CockpitPanels({
	projectId,
	planExecId,
	selectedWorkerId,
	workspaceStage,
	workers = [],
	planEvents,
	className = "",
}: CockpitPanelsProps) {
	const [expandedSections, setExpandedSections] = useState<Set<string>>(
		new Set(SECTIONS.filter((s) => s.defaultExpanded).map((s) => s.id)),
	);

	const toggleSection = (id: string) => {
		setExpandedSections((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const hasWorker = !!selectedWorkerId;

	return (
		<div className={`${BG} ${className}`}>
			{/* Section header */}
			<div className={`flex items-center gap-2 px-3 py-2 ${SURF} border-b ${BORD}`}>
				<Activity size={14} className={ACC_TXT} />
				<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
					Cockpit Panels
				</span>
			</div>

			<div className="space-y-3 p-3">
				{/* Collapsible sections — show all even without worker selection */}
				{SECTIONS.map((section) => {
					const isExpanded = expandedSections.has(section.id);
					const Icon = section.icon;

					return (
						<div
							key={section.id}
							className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}
						>
							{/* Section header (collapsible) */}
							<button
								onClick={() => toggleSection(section.id)}
								className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] text-left transition-colors`}
							>
								{isExpanded ? (
									<ChevronDown size={12} className={`shrink-0 ${MUT}`} />
								) : (
									<ChevronRight size={12} className={`shrink-0 ${MUT}`} />
								)}
								<Icon size={13} className={ACC_TXT} />
								<span>{section.label}</span>
							</button>

							{/* Section content */}
							{isExpanded && (
								<div className="p-0">
									{section.id === "plan-summary" && (
										<PlanSummaryPanel
											projectId={projectId}
											planExecId={planExecId}
										/>
									)}
									{section.id === "worker-context" && (
										hasWorker ? (
											<WorkerContextInspector
												planExecId={planExecId}
												workspaceId={selectedWorkerId}
											/>
										) : (
											<div className={`flex flex-col items-center justify-center gap-2 py-6 ${MUT} text-xs`}>
												<User size={20} className="text-stone-300 dark:text-stone-600" />
												<p>Select a worker to view context</p>
											</div>
										)
									)}
									{section.id === "live-logs" && (
										<LiveLogTerminal
											workers={workers}
											planEvents={planEvents}
										/>
									)}
									{section.id === "file-explorer" && (
										<FileExplorer
											projectId={projectId ?? ""}
											planExecId={planExecId ?? ""}
											initialWorkspaceId={selectedWorkerId ?? undefined}
											height="360px"
										/>
									)}
									{section.id === "escalations" && (
										<LeadEscalationPanel
											planExecId={planExecId}
											workspaceId={selectedWorkerId}
										/>
									)}
									{section.id === "directives" && (
										<HumanDirectivePanel
											planExecId={planExecId}
											workspaceId={selectedWorkerId}
										/>
									)}
									{section.id === "control" && (
										<ControlActionsPanel
											planExecId={planExecId}
											workspaceId={selectedWorkerId}
											workspaceStage={workspaceStage}
										/>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
