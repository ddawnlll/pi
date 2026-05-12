import { AnimatePresence, motion } from "framer-motion";
import type { WorkerInfo } from "../types";

interface WorkerListProps {
	workers: WorkerInfo[];
	selectedWorkerId: string | null;
	onSelectWorker: (workerId: string) => void;
}

function getStageColor(stage: string): string {
	switch (stage) {
		case "active":
			return "text-green-400";
		case "pending":
			return "text-gray-400";
		case "blocked":
			return "text-yellow-400";
		case "complete":
			return "text-blue-400";
		case "failed":
			return "text-red-400";
		default:
			return "text-gray-500";
	}
}

function getStageIcon(stage: string): string {
	switch (stage) {
		case "active":
			return "⚡";
		case "pending":
			return "⏳";
		case "blocked":
			return "🚧";
		case "complete":
			return "✓";
		case "failed":
			return "✗";
		default:
			return "•";
	}
}

/**
 * Worker list with AnimatePresence for row enter/exit animations.
 * Shows all workers (active, pending, completed, failed) grouped by status.
 */
export function WorkerList({
	workers,
	selectedWorkerId,
	onSelectWorker,
}: WorkerListProps) {
	// Group workers by stage
	const activeWorkers = workers.filter((w) => w.stage === "active");
	const pendingWorkers = workers.filter((w) => w.stage === "pending");
	const blockedWorkers = workers.filter((w) => w.stage === "blocked");
	const completedWorkers = workers.filter((w) => w.stage === "complete");
	const failedWorkers = workers.filter((w) => w.stage === "failed");

	const renderWorkerGroup = (title: string, groupWorkers: WorkerInfo[]) => {
		if (groupWorkers.length === 0) return null;

		return (
			<div className="mb-3">
				<h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1.5 px-1">
					{title} ({groupWorkers.length})
				</h3>
				<div className="space-y-1">
					<AnimatePresence mode="popLayout">
						{groupWorkers.map((worker) => (
							<motion.button
								key={worker.id}
								initial={{ opacity: 0, x: -8 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 8 }}
								transition={{ duration: 0.15 }}
								layout
								onClick={() => onSelectWorker(worker.id)}
								className={`w-full text-left px-3 py-2 text-xs rounded transition-colors ${
									selectedWorkerId === worker.id
										? "bg-blue-700 text-white"
										: "text-gray-300 hover:bg-gray-700"
								}`}
							>
								<span className="mr-2">{getStageIcon(worker.stage)}</span>
								<span className="font-medium">{worker.id}</span>
								<span className={`ml-2 ${getStageColor(worker.stage)}`}>
									{worker.stage}
								</span>
								<span className="text-gray-500 ml-2">
									&middot; attempt: {worker.attempt}
								</span>
							</motion.button>
						))}
					</AnimatePresence>
				</div>
			</div>
		);
	};

	return (
		<div className="border-b border-gray-700 p-4 max-h-64 overflow-y-auto">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
				Workers
			</h2>
			{workers.length === 0 ? (
				<div className="text-xs text-gray-500">No workers</div>
			) : (
				<>
					{renderWorkerGroup("Active", activeWorkers)}
					{renderWorkerGroup("Pending", pendingWorkers)}
					{renderWorkerGroup("Blocked", blockedWorkers)}
					{renderWorkerGroup("Completed", completedWorkers)}
					{renderWorkerGroup("Failed", failedWorkers)}
				</>
			)}
		</div>
	);
}
