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
    { label: "Pending", value: queue.pending ?? 0, color: "text-stone-500 dark:text-stone-400" },
    { label: "Active", value: queue.active ?? 0, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Blocked", value: queue.blocked ?? 0, color: "text-amber-600 dark:text-amber-400" },
    { label: "Complete", value: queue.complete ?? 0, color: "text-blue-600 dark:text-blue-400" },
    { label: "Failed", value: queue.failed ?? 0, color: "text-red-600 dark:text-red-400" },
  ];

  return (
    <div className="bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded-xl p-4">
      <h2 className="text-xs font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-3">Queue</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between text-xs">
            <span className="text-stone-500 dark:text-stone-400">{item.label}</span>
            <span className={`font-medium ${item.color}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
