import { motion } from "framer-motion";
import type { PlanExecution } from "../types";

interface PlanHistoryProps {
	executions: PlanExecution[];
	selectedExecId: string | null;
	onSelectExecution: (execId: string) => void;
	isLoading: boolean;
}

export function PlanHistory({
	executions,
	selectedExecId,
	onSelectExecution,
	isLoading,
}: PlanHistoryProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="p-3 border-b border-gray-700">
				<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
					Plan History
				</h2>
			</div>

			<div className="flex-1 overflow-auto">
				{isLoading ? (
					<div className="p-4 text-xs text-gray-500">
						Loading executions...
					</div>
				) : executions.length === 0 ? (
					<div className="p-4 text-xs text-gray-500">
						No plan executions yet
					</div>
				) : (
					<div className="space-y-0.5 p-2">
						{executions.map((exec) => (
							<motion.button
								key={exec.id}
								initial={{ opacity: 0, x: -8 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ duration: 0.1 }}
								onClick={() => onSelectExecution(exec.id)}
								className={`w-full text-left px-3 py-2 text-xs rounded transition-colors ${
									selectedExecId === exec.id
										? "bg-blue-700 text-white"
										: "text-gray-300 hover:bg-gray-700"
								}`}
							>
								<div className="flex items-center justify-between">
									<span className="font-medium truncate mr-2">
										{exec.title}
									</span>
									<StatusBadge status={exec.status} />
								</div>
								<div className="text-gray-500 mt-0.5 flex items-center gap-2">
									<span>Phase: {exec.phase}</span>
									<span>&middot;</span>
									<span>{formatDate(exec.startedAt)}</span>
								</div>
							</motion.button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const colorMap: Record<string, string> = {
		running: "bg-green-600",
		complete: "bg-blue-600",
		failed: "bg-red-600",
		paused: "bg-yellow-600",
		stopped: "bg-orange-600",
		cancelled: "bg-gray-600",
	};

	return (
		<span
			className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white whitespace-nowrap ${
				colorMap[status] ?? "bg-gray-600"
			}`}
		>
			{status}
		</span>
	);
}

function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}
