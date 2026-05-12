import type { PlanState } from "../types";

interface PlanSummaryProps {
	planState: PlanState;
}

export function PlanSummary({ planState }: PlanSummaryProps) {
	const statusColorMap: Record<string, string> = {
		running: "text-emerald-600",
		paused: "text-amber-600",
		complete: "text-blue-600",
		failed: "text-red-600",
		stopped: "text-orange-600",
		cancelled: "text-stone-500",
	};

	const elapsed = formatElapsed(planState);

	return (
		<div className="bg-white border border-[#E8E6E1] rounded-xl p-4">
			<h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
				Plan Summary
			</h2>
			<div className="text-xs space-y-2 text-stone-500">
				<div className="flex justify-between">
					<span>Title</span>
					<span className="text-stone-700 font-medium truncate ml-2 max-w-[140px]">
						{planState.title}
					</span>
				</div>
				<div className="flex justify-between">
					<span>Phase</span>
					<span className="text-stone-700">{planState.phase}</span>
				</div>
				<div className="flex justify-between">
					<span>Status</span>
					<span className={`font-medium ${statusColorMap[planState.status] ?? "text-stone-400"}`}>
						{planState.status}
					</span>
				</div>
				<div className="flex justify-between">
					<span>Elapsed</span>
					<span className="text-stone-700">{elapsed}</span>
				</div>
			</div>
		</div>
	);
}

function formatElapsed(state: PlanState): string {
	const now = Date.now();
	const start = state.startedAt ?? now;
	const end = state.completedAt ?? now;
	const ms = end - start;
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
}
