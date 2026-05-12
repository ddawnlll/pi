interface QueuePanelProps {
	queue: {
		pending: number;
		active: number;
		blocked: number;
		complete: number;
		failed: number;
	};
}

export function QueuePanel({ queue }: QueuePanelProps) {
	if (!queue) return null;

	const items = [
		{ label: "Pending", value: queue.pending ?? 0, color: "text-stone-500" },
		{ label: "Active", value: queue.active ?? 0, color: "text-emerald-600" },
		{ label: "Blocked", value: queue.blocked ?? 0, color: "text-amber-600" },
		{ label: "Complete", value: queue.complete ?? 0, color: "text-blue-600" },
		{ label: "Failed", value: queue.failed ?? 0, color: "text-red-600" },
	];

	return (
		<div className="bg-white border border-[#E8E6E1] rounded-xl p-4">
			<h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
				Queue
			</h2>
			<div className="space-y-2">
				{items.map((item) => (
					<div key={item.label} className="flex justify-between text-xs">
						<span className="text-stone-500">{item.label}</span>
						<span className={`font-medium ${item.color}`}>{item.value}</span>
					</div>
				))}
			</div>
		</div>
	);
}
