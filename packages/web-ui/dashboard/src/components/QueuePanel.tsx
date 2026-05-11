import type { PlanState } from "../types";

interface QueuePanelProps {
	queue: PlanState["queue"];
}

/**
 * TailGrids-style card showing queue breakdown.
 */
export function QueuePanel({ queue }: QueuePanelProps) {
	const items = [
		{ label: "Pending", value: queue.pending, color: "text-gray-400" },
		{ label: "Active", value: queue.active, color: "text-green-400" },
		{ label: "Blocked", value: queue.blocked, color: "text-yellow-400" },
		{ label: "Complete", value: queue.complete, color: "text-blue-400" },
		{ label: "Failed", value: queue.failed, color: "text-red-400" },
	];

	return (
		<div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
				Queue
			</h2>
			<div className="space-y-2">
				{items.map((item) => (
					<div
						key={item.label}
						className="flex justify-between text-xs"
					>
						<span className="text-gray-400">{item.label}</span>
						<span className={`font-medium ${item.color}`}>{item.value}</span>
					</div>
				))}
			</div>
		</div>
	);
}
