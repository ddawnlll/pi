import { motion } from "framer-motion";
import type { PlanState } from "../types";
import { formatElapsed, getStatusColorClass } from "../utils/format";

interface PlanSummaryProps {
	planState: PlanState;
}

/**
 * TailGrids-style dashboard card for plan summary.
 */
export function PlanSummary({ planState }: PlanSummaryProps) {
	return (
		<div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
				Plan Summary
			</h2>
			<div className="text-xs space-y-2 text-gray-400">
				<div className="flex justify-between">
					<span>Title</span>
					<span className="text-gray-200 font-medium truncate ml-2 max-w-[140px]">
						{planState.title}
					</span>
				</div>
				<div className="flex justify-between">
					<span>Phase</span>
					<span className="text-gray-200">{planState.phase}</span>
				</div>
				<div className="flex justify-between">
					<span>Status</span>
					<motion.span
						className={`font-medium ${getStatusColorClass(planState.status)}`}
						animate={{ backgroundColor: "transparent" }}
						transition={{ duration: 0.3 }}
					>
						{planState.status}
					</motion.span>
				</div>
				<div className="flex justify-between">
					<span>Elapsed</span>
					<span className="text-gray-200">
						{formatElapsed(planState.elapsed)}
					</span>
				</div>
			</div>
		</div>
	);
}
