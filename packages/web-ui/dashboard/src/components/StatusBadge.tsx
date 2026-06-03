import { CircleDot, Pause, CheckCircle2, AlertCircle, Square, Ban, Clock } from "lucide-react";
import { normalizeStatus, STATUS_LABELS, type WorkerStatus } from "../utils/status";

const STATUS_META: Record<WorkerStatus, { Icon: React.ElementType; pulse?: boolean }> = {
	queued: { Icon: Clock },
	running: { Icon: CircleDot, pulse: true },
	blocked: { Icon: AlertCircle },
	waiting: { Icon: Pause },
	failed: { Icon: AlertCircle },
	completed: { Icon: CheckCircle2 },
	cancelled: { Icon: Ban },
	unknown: { Icon: Clock },
};

export function StatusBadge({ status }: { status: string }) {
	const canonical = normalizeStatus(status);
	const meta = STATUS_META[canonical] ?? STATUS_META.unknown;
	const label = STATUS_LABELS[canonical];

	// Color variants for each canonical status
	const colors: Record<WorkerStatus, string> = {
		queued: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30",
		running: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30",
		blocked: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30",
		waiting: "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30",
		failed: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30",
		completed: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30",
		cancelled: "text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800/50",
		unknown: "text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800/50",
	};

	return (
		<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium tracking-wide ${colors[canonical]}`}>
			<span className={meta.pulse ? "relative flex h-1.5 w-1.5" : ""}>
				{meta.pulse && (
					<>
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50" />
						<span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
					</>
				)}
				{!meta.pulse && <meta.Icon size={11} />}
			</span>
			{label}
		</span>
	);
}
