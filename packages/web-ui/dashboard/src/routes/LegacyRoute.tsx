import { useState } from "react";
import { BG, SURF, BORD } from "../tokens";
import { usePlanState } from "../hooks/usePlanState";
import { useJournalStream } from "../hooks/useJournalStream";
import { PlanSummary } from "../components/PlanSummary";
import { QueuePanel } from "../components/QueuePanel";
import { WorkerDetail } from "../components/WorkerDetail";
import { LiveLogTerminal } from "../components/LiveLogTerminal";
import { StatCard } from "../components/StatCard";
import { History, Activity, LayoutGrid, Upload, Plus } from "lucide-react";
import type { WorkspaceJson } from "../types";

export function LegacyRoute() {
	const { data: planState, isLoading, workers, queue } = usePlanState(true);
	const { events } = useJournalStream(true);
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

	const selectedWorker = workers.find((w: { id: string }) => w.id === selectedWorkerId);
	const activeWorkspaces = planState?.workspaces?.map((ws: WorkspaceJson) => ({
		id: ws.workspaceId,
		stage: ws.stage,
		attempts: ws.attempts,
		error: ws.error ?? null,
		startedAt: ws.startedAt ?? null,
		completedAt: ws.completedAt ?? null,
	})) ?? [];
	const selectedWorkspace = activeWorkspaces.find((w) => w.id === selectedWorkerId);

	if (isLoading) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<Activity size={20} className="animate-spin text-stone-400 dark:text-stone-500" />
			</div>
		);
	}

	if (!planState) {
		return (
			<div className={`flex-1 flex flex-col items-center justify-center gap-4 text-stone-400 dark:text-stone-500 p-8`}>
				<LayoutGrid size={48} strokeWidth={1} className="text-stone-300 dark:text-stone-600" />
				<p className="text-sm">No plan execution data found</p>
				<p className="text-xs max-w-md text-center">Your Pi cockpit is ready. Upload a plan to begin.</p>
				<div className="flex gap-2 mt-2">
					<button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700">
						<Upload size={14} /> Upload plan
					</button>
					<button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300">
						<Plus size={14} /> Create project
					</button>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className={`shrink-0 grid grid-cols-2 gap-3 p-3 ${BG} border-b ${BORD}`}>
				<StatCard icon={History} label="Workspaces" value={String(planState.workspaces?.length ?? 0)} />
				<StatCard icon={Activity} label="Status" value={planState.status} accent={planState.status === "running"} />
			</div>
			<div className={`flex gap-4 p-4 border-b ${BORD} ${SURF} shrink-0`}>
				<div className="w-64"><PlanSummary planState={planState} /></div>
				<div className="w-48"><QueuePanel queue={queue} /></div>
			</div>
			{workers.length > 0 && (
				<div className={`shrink-0 max-h-48 overflow-y-auto border-b ${BORD} ${SURF}`}>
					{workers.map((w) => (
						<button
							key={w.id}
							onClick={() => setSelectedWorkerId(w.id)}
							className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b ${BORD} last:border-b-0 transition-colors ${
								w.id === selectedWorkerId ? "bg-[#EBF2FF] dark:bg-[#1A2A44]" : "hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
							}`}
						>
							<span className="text-xs font-medium">{w.id}</span>
							<span className="text-xs text-stone-400">{w.stage}</span>
						</button>
					))}
				</div>
			)}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{selectedWorker ? (
					<WorkerDetail worker={selectedWorker} planExecId={null} workspace={selectedWorkspace} />
				) : workers.length > 0 ? (
					<LiveLogTerminal workers={workers} planEvents={events as any} className="h-full" />
				) : null}
			</div>
		</>
	);
}
