import { useMemo, useState } from "react";
import { BG, SURF, BORD } from "../tokens";
import { useSelectionStore } from "../stores/selectionStore";
import { usePlanExecutionDetail, usePlanStats } from "../hooks/usePlanExecutions";
import { usePlanEvents } from "../hooks/usePlanEvents";
import { useSettings } from "../hooks/useSettings";
import { WarningBanner } from "../components/WarningBanner";
import { StatCard } from "../components/StatCard";
import { SchedulerStatusPanel } from "../components/SchedulerStatusPanel";
import { CockpitPanels } from "../components/CockpitPanels";
import { WorkersGrid } from "../components/workers/WorkersGrid";
import { ArtifactBrowser } from "../components/ArtifactBrowser";
import { LiveLogTerminal } from "../components/LiveLogTerminal";
import { EscalationCenter } from "../components/escalations/EscalationCenter";
import { usePlanEscalations } from "../hooks/usePlanEscalations";
import { CockpitTabs } from "./CockpitTabs";
import type { CockpitTabId } from "../navigation/NavigationState";
import {
	History,
	Activity,
	Filter,
	DollarSign,
	Cpu,
	Zap,
	ListOrdered,
} from "lucide-react";
import { formatTokens, formatCost, formatPercentOrUnknown } from "../utils/format";
import type { JournalEvent } from "../types";

// ─── Sub-components ─────────────────────────────────────────────────────

function QueueStrip({ queue }: { queue: { pending: number; active: number; blocked: number; complete: number; failed: number } }) {
	const items = [
		{ label: "Queued", value: queue.pending, color: "text-stone-400 dark:text-stone-500" },
		{ label: "Running", value: queue.active, color: "text-emerald-600 dark:text-emerald-400" },
		{ label: "Blocked", value: queue.blocked, color: "text-amber-600 dark:text-amber-400" },
		{ label: "Completed", value: queue.complete, color: "text-blue-700 dark:text-blue-300" },
		{ label: "Failed", value: queue.failed, color: "text-red-600 dark:text-red-400" },
	];
	return (
		<div className={`flex shrink-0 border-b ${BORD} ${SURF} divide-x ${BORD}`}>
			{items.map((it) => (
				<div key={it.label} className="flex-1 flex flex-col items-center py-2.5 gap-0.5">
					<span className={`text-sm font-semibold ${it.color}`}>{it.value}</span>
					<span className="text-xs uppercase tracking-widest text-stone-400 dark:text-stone-500 font-medium">{it.label}</span>
				</div>
			))}
		</div>
	);
}



// ─── Route component ────────────────────────────────────────────────────

export function RunRoute() {
	const { selectedProjectId, selectedPlanExecId } = useSelectionStore();

	const { data: executionDetail } = usePlanExecutionDetail(selectedProjectId, selectedPlanExecId);
	const { data: planStats } = usePlanStats(selectedProjectId, selectedPlanExecId);
	const { budgets: contextBudgets } = useSettings();
	const { events: planEvents, connectionStatus, lastEventAt, isStale: isEventStreamStale } = usePlanEvents({
		projectId: selectedProjectId,
		planExecId: selectedPlanExecId,
	});
	const { escalations, blockedWorkspaceIds, isLoading: isLoadingEscalations } = usePlanEscalations(selectedProjectId, selectedPlanExecId);

	const [cockpitTab, setCockpitTab] = useState<CockpitTabId>("overview");

	const activeWorkspaces = executionDetail?.workspaces ?? [];
	const workers = activeWorkspaces.map((ws) => ({ id: ws.id, stage: ws.stage as any, attempt: ws.attempts, retries: 0, workspaceId: ws.id }));

	const queue = useMemo(() => ({
		pending: activeWorkspaces.filter((w) => w.stage === "pending").length,
		active: activeWorkspaces.filter((w) => w.stage === "active").length,
		blocked: activeWorkspaces.filter((w) => w.stage === "blocked").length,
		complete: activeWorkspaces.filter((w) => w.stage === "complete").length,
		failed: activeWorkspaces.filter((w) => w.stage === "failed").length,
	}), [activeWorkspaces]);

	if (!executionDetail) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400 dark:text-stone-500">
				<History size={32} strokeWidth={1.2} />
				<p className="text-sm">Select a run from the sidebar to begin.</p>
			</div>
		);
	}

	const runHeader = (
		<>
			<WarningBanner
				executionDetail={executionDetail}
				workers={activeWorkspaces}
				events={planEvents as any}
				burnRatePerMin={planStats?.burn_rate_per_min}
				contextBudgets={contextBudgets}
				executionStats={planStats ?? null}
			/>
			<div className={`shrink-0 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3 p-3 ${BG} border-b ${BORD}`}>
				<StatCard icon={DollarSign} label="Est. cost" value={formatCost(planStats?.estimated_cost_usd)} />
				<StatCard icon={Cpu} label="Tokens in" value={formatTokens(planStats?.total_tokens_in)} accent />
				<StatCard icon={Activity} label="Tokens out" value={formatTokens(planStats?.total_tokens_out)} />
				<StatCard icon={Zap} label="Burn rate" value={planStats?.burn_rate_per_min != null ? `${planStats.burn_rate_per_min.toFixed(0)}/m` : "—"} sublabel="total tokens ÷ elapsed min" />
				<StatCard icon={Activity} label="Cache hit" value={formatPercentOrUnknown(planStats?.cache_hit_rate_known ? planStats?.cache_hit_rate : null)} />
				<StatCard icon={ListOrdered} label="Tok/workspace" value={planStats?.tokens_per_workspace != null ? formatTokens(planStats.tokens_per_workspace) : "—"} />
				<StatCard icon={Filter} label="Tok/progress%" value={planStats?.tokens_per_percent != null ? formatTokens(planStats.tokens_per_percent) : "—"} />
			</div>
			<div className={`shrink-0 p-3 border-b ${BORD}`}>
				<SchedulerStatusPanel stats={planStats ?? null} />
			</div>
		</>
	);

	const tabBar = (
		<CockpitTabs
			activeTab={cockpitTab}
			onTabChange={setCockpitTab}
			tabBadges={{
				workspaces: activeWorkspaces.length,
				escalations: activeWorkspaces.filter((w) => w.stage === "failed").length,
			}}
		/>
	);

	let tabContent: React.ReactNode;
	switch (cockpitTab) {
		case "workspaces":
			tabContent = <WorkersGrid workspaces={activeWorkspaces} className="flex-1 min-h-0" />;
			break;
		case "files":
			tabContent = <div className="flex-1 min-h-0 overflow-hidden p-4"><ArtifactBrowser planExecId={selectedPlanExecId} /></div>;
			break;
		case "logs":
			tabContent = <div className="flex-1 min-h-0 overflow-hidden"><LiveLogTerminal workers={workers} planExecId={selectedPlanExecId} className="h-full" /></div>;
			break;
		case "escalations":
			tabContent = (
				<div className="flex-1 min-h-0 overflow-y-auto p-4">
					<EscalationCenter
						planExecId={selectedPlanExecId}
						projectId={selectedProjectId}
						escalations={escalations}
						blockedWorkspaceIds={blockedWorkspaceIds}
						isLoading={isLoadingEscalations}
					/>
				</div>
			);
			break;
		case "overview":
		default:
			tabContent = (
				<div className={`border-b ${BORD} flex-1 min-h-0 overflow-y-auto`}>
					<CockpitPanels
						projectId={selectedProjectId}
						planExecId={selectedPlanExecId}
						selectedWorkerId={null}
						workspaceStage={undefined}
						workers={workers}
						planEvents={planEvents as unknown as JournalEvent[]}
					/>
				</div>
			);
	}

	return (
		<>
			{runHeader}
			{tabBar}
			{tabContent}
		</>
	);
}
