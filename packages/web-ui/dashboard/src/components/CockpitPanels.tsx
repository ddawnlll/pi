/**
 * CockpitPanels — Minimal Dashboard Cockpit Panels container (P41.12).
 *
 * Groups the following minimal panels together for a complete cockpit view:
 * - Plan Overview (delegates to PlanSummaryPanel)
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
import { BG, SURF, BORD, TXT, MUT, ACC_TXT } from "../tokens";
import { Activity } from "lucide-react";
import type { JournalEvent, WorkerInfo } from "../types";
import { PlanSummaryPanel } from "./PlanSummaryPanel";

// ─── Section definitions ───────────────────────────────────────────────────

interface Section {
	id: string;
	label: string;
	icon: typeof Activity;
	defaultExpanded?: boolean;
}

const SECTIONS: Section[] = [
	{ id: "plan-summary", label: "Plan Summary", icon: Activity, defaultExpanded: true },
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

	return (
		<div className={`${BG} ${className}`}>
			{/* Section header */}
			<div className={`flex items-center gap-2 px-3 py-2 ${SURF} border-b ${BORD}`}>
				<Activity size={14} className={ACC_TXT} />
				<span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
					Cockpit Panels
				</span>
			</div>

			<div className="space-y-3 p-3">
				{SECTIONS.map((section) => {
					const Icon = section.icon;

					return (
						<div
							key={section.id}
							className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}
						>
							{/* Section header */}
							<div className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium ${TXT} text-left`}>
								<Icon size={13} className={ACC_TXT} />
								<span>{section.label}</span>
							</div>

							{/* Section content */}
							<div className="p-0">
								{section.id === "plan-summary" && (
									<PlanSummaryPanel
										projectId={projectId}
										planExecId={planExecId}
									/>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
