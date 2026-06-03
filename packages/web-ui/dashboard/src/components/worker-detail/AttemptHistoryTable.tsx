import type { WorkspaceAttempt } from "../../types";

function formatDuration(ms: number | null): string {
	if (ms == null) return "--";
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return `${minutes}m ${secs}s`;
}

function RoleBadge({ role }: { role: WorkspaceAttempt["role"] }) {
	const colors: Record<string, string> = {
		worker: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
		flash: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
		reviewer: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
		final: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
	};
	return (
		<span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide shrink-0 ${colors[role] || colors.worker}`}>
			{role}
		</span>
	);
}

function VerdictBadge({ verdict }: { verdict: WorkspaceAttempt["verdict"] }) {
	const colors: Record<string, string> = {
		complete: "text-emerald-600 dark:text-emerald-400",
		failed: "text-red-600 dark:text-red-400",
		running: "text-amber-600 dark:text-amber-400",
	};
	return <span className={`font-medium ${colors[verdict] || "text-stone-500"}`}>{verdict}</span>;
}

function AttemptRow({ attempt: a }: { attempt: WorkspaceAttempt }) {
	const isRunning = a.verdict === "running";
	return (
		<div className="flex items-start gap-2 py-1.5 px-2 rounded bg-stone-50 dark:bg-[#1A1A1A] border border-[#E8E6E1] dark:border-[#333]">
			<RoleBadge role={a.role} />
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
					<span>Attempt {a.attempt}</span>
					{a.duration != null && <span>{formatDuration(a.duration)}</span>}
					<VerdictBadge verdict={a.verdict} />
				</div>
				{isRunning && (
					<div className="flex items-center gap-1 mt-1">
						<span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
						<span className="text-xs text-amber-600 dark:text-amber-400">In progress...</span>
					</div>
				)}
				{a.error && !isRunning && (
					<div className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">{a.error}</div>
				)}
			</div>
		</div>
	);
}

interface AttemptHistoryTableProps {
	attempts: WorkspaceAttempt[];
	loading: boolean;
}

export function AttemptHistoryTable({ attempts, loading }: AttemptHistoryTableProps) {
	if (loading) {
		return (
			<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
				<h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
				<div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
					<span className="w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" />
					Loading...
				</div>
			</div>
		);
	}

	if (attempts.length === 0) return null;

	const isSingleSuccess = attempts.length === 1 && attempts[0].verdict === "complete";
	if (isSingleSuccess) {
		const a = attempts[0];
		return (
			<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
				<h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
				<div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
					<RoleBadge role={a.role} />
					<span>{formatDuration(a.duration)}</span>
					<span className="text-emerald-600 dark:text-emerald-400 font-medium">Complete</span>
				</div>
			</div>
		);
	}

	return (
		<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
			<h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
			<div className="space-y-1.5">
				{attempts.map((a) => <AttemptRow key={a.attempt} attempt={a} />)}
			</div>
		</div>
	);
}
