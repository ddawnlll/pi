import { motion } from "framer-motion";
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	Clock,
	Loader2,
	RefreshCw,
	XCircle,
	Timer,
} from "lucide-react";
import type { WorkspaceSummary } from "../../types";
import { useNavigation } from "../../navigation/NavigationState";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkerCardProps {
	workspace: WorkspaceSummary;
	index?: number;
	onStop?: (workspaceId: string) => void;
	onRetry?: (workspaceId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortId(id: string): string {
	if (id.length <= 20) return id;
	return `${id.slice(0, 10)}..${id.slice(-6)}`;
}

function relativeTime(ts: number | null): string {
	if (!ts) return "";
	const diff = Date.now() - ts;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

function durationText(startedAt: number | null, completedAt: number | null): string {
	if (!startedAt) return "";
	const end = completedAt ?? Date.now();
	const diff = end - startedAt;
	if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
	const h = Math.floor(diff / 3_600_000);
	const m = Math.floor((diff % 3_600_000) / 60_000);
	return `${h}h ${m}m`;
}

// ─── Stage config ────────────────────────────────────────────────────────────

interface StageMeta {
	label: string;
	icon: typeof Activity;
	color: string;
	bg: string;
	border: string;
	accentBar: string;
	pulse?: boolean;
}

function getStageMeta(stage: string): StageMeta {
	switch (stage) {
		case "active":
			return {
				label: "Running",
				icon: Loader2,
				color: "text-blue-500",
				bg: "bg-blue-50 dark:bg-blue-900/20",
				border: "border-blue-200 dark:border-blue-800",
				accentBar: "bg-blue-500",
				pulse: true,
			};
		case "pending":
			return {
				label: "Ready",
				icon: Clock,
				color: "text-stone-400 dark:text-stone-500",
				bg: "bg-stone-50 dark:bg-stone-800/50",
				border: "border-stone-200 dark:border-stone-700",
				accentBar: "bg-stone-300 dark:bg-stone-600",
			};
		case "blocked":
			return {
				label: "Blocked",
				icon: AlertTriangle,
				color: "text-amber-500",
				bg: "bg-amber-50 dark:bg-amber-900/20",
				border: "border-amber-200 dark:border-amber-800",
				accentBar: "bg-amber-500",
			};
		case "complete":
			return {
				label: "Completed",
				icon: CheckCircle2,
				color: "text-emerald-500",
				bg: "bg-emerald-50 dark:bg-emerald-900/20",
				border: "border-emerald-200 dark:border-emerald-800",
				accentBar: "bg-emerald-500",
			};
		case "failed":
			return {
				label: "Failed",
				icon: XCircle,
				color: "text-red-500",
				bg: "bg-red-50 dark:bg-red-900/20",
				border: "border-red-200 dark:border-red-800",
				accentBar: "bg-red-500",
			};
		default:
			return {
				label: stage,
				icon: Clock,
				color: "text-stone-400 dark:text-stone-500",
				bg: "bg-stone-50 dark:bg-stone-800/50",
				border: "border-stone-200 dark:border-stone-700",
				accentBar: "bg-stone-300 dark:bg-stone-600",
			};
	}
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkerCard({ workspace, index = 0, onStop, onRetry }: WorkerCardProps) {
	const { navigateToWorkspaceDetail } = useNavigation();
	const meta = getStageMeta(workspace.stage);
	const Icon = meta.icon;

	const handleClick = () => {
		navigateToWorkspaceDetail(workspace.id);
	};

	const handleStop = (e: React.MouseEvent) => {
		e.stopPropagation();
		onStop?.(workspace.id);
	};

	const handleRetry = (e: React.MouseEvent) => {
		e.stopPropagation();
		onRetry?.(workspace.id);
	};

	const showStop = (workspace.stage === "active" || workspace.stage === "blocked") && onStop;
	const showRetry = workspace.stage === "failed" && onRetry;
	const hasActions = showStop || showRetry;

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: 20, scale: 0.95 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			exit={{ opacity: 0, y: -10, scale: 0.95 }}
			transition={{
				duration: 0.35,
				delay: index * 0.05,
				ease: [0.25, 0.46, 0.45, 0.94],
				layout: { duration: 0.3 },
			}}
			whileHover={{ scale: 1.02 }}
			whileTap={{ scale: 0.98 }}
			className="group relative"
		>
			<button
				onClick={handleClick}
				className="w-full text-left rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E] overflow-hidden transition-colors duration-200"
			>
				{/* Accent bar — thin colored stripe at top */}
				<div className={`h-0.5 w-full ${meta.accentBar}`} />

				<div className="p-3.5">
					{/* Header: Status icon + ID */}
					<div className="flex items-start justify-between gap-2">
						<div className="flex items-center gap-2 min-w-0">
							<span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${meta.bg} ${meta.border} border`}>
								<Icon size={13} className={`${meta.color} ${meta.pulse ? "animate-spin" : ""}`} />
							</span>
							<div className="min-w-0">
								<p className="text-xs font-semibold text-stone-700 dark:text-stone-300 truncate">
									{shortId(workspace.id)}
								</p>
								<p className={`text-xs ${meta.color} font-medium mt-0.5`}>
									{meta.label}
								</p>
							</div>
						</div>
					</div>

					{/* Metrics row */}
					<div className="flex items-center gap-3 mt-2.5 text-xs text-stone-400 dark:text-stone-500">
						{workspace.startedAt && (
							<span className="inline-flex items-center gap-1">
								<Timer size={11} />
								{durationText(workspace.startedAt, workspace.completedAt)}
							</span>
						)}
						{workspace.startedAt && !workspace.completedAt && (
							<span className="inline-flex items-center gap-1">
								<Clock size={11} />
								{relativeTime(workspace.startedAt)}
							</span>
						)}
						{workspace.completedAt && workspace.stage === "complete" && (
							<span className="inline-flex items-center gap-1">
								<CheckCircle2 size={11} />
								{relativeTime(workspace.completedAt)}
							</span>
						)}
					</div>

					{/* Attempts indicator */}
					{workspace.attempts > 1 && (
						<div className="flex items-center gap-1.5 mt-2">
							<RefreshCw size={10} className="text-amber-500" />
							<span className="text-xs text-amber-500 font-medium">
								{workspace.attempts} attempts
							</span>
							<div className="flex gap-0.5">
								{Array.from({ length: Math.min(workspace.attempts, 5) }).map((_, i) => (
									<div
										key={i}
										className={`w-1.5 h-1.5 rounded-full ${
											i === workspace.attempts - 1
												? "bg-amber-400"
												: "bg-stone-200 dark:bg-stone-700"
										}`}
									/>
								))}
							</div>
						</div>
					)}

					{/* Error preview */}
					{workspace.error && (
						<div className="mt-2.5 p-2 rounded-md bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20">
							<p className="text-xs text-red-500 truncate" title={workspace.error}>
								{workspace.error}
							</p>
						</div>
					)}

					{/* Actions footer */}
					{hasActions && (
						<div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-[#E8E6E1] dark:border-[#333] opacity-0 group-hover:opacity-100 transition-opacity duration-200">
							{showStop && (
								<button
									onClick={handleStop}
									className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
										bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-100 dark:border-red-900/20 transition-colors"
								>
									<Activity size={10} />
									Stop
								</button>
							)}
							{showRetry && (
								<button
									onClick={handleRetry}
									className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
										bg-blue-50 dark:bg-blue-900/20 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-blue-100 dark:border-blue-900/20 transition-colors"
								>
									<RefreshCw size={10} />
									Retry
								</button>
							)}
						</div>
					)}
				</div>
			</button>
		</motion.div>
	);
}
