import { AnimatePresence, motion } from "framer-motion";
import type { WorkerInfo } from "../types";

interface WorkerListProps {
	workers: WorkerInfo[];
	selectedWorkerId: string | null;
	onSelectWorker: (workerId: string) => void;
}

/**
 * Worker list with AnimatePresence for row enter/exit animations.
 * Uses TailGrids table-row styling (hover, selected highlight).
 */
export function WorkerList({
	workers,
	selectedWorkerId,
	onSelectWorker,
}: WorkerListProps) {
	return (
		<div className="border-b border-gray-700 p-4">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
				Active Workers
			</h2>
			{workers.length === 0 ? (
				<div className="text-xs text-gray-500">No active workers</div>
			) : (
				<div className="space-y-1">
					<AnimatePresence mode="popLayout">
						{workers.map((worker, index) => (
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
								<span className="text-gray-500 mr-2">[{index + 1}]</span>
								<span className="font-medium">{worker.id}</span>
								<span className="text-gray-500 ml-2">
									stage: {worker.stage} &middot; attempt: {worker.attempt}
								</span>
							</motion.button>
						))}
					</AnimatePresence>
				</div>
			)}
		</div>
	);
}
