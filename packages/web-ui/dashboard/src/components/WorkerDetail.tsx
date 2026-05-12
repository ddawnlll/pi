import { useEffect, useRef } from "react";
import type { WorkerInfo } from "../types";
import { useWorkspaceLogStream } from "../hooks/useWorkspaceLogStream";

interface WorkerDetailProps {
	worker: WorkerInfo;
	planExecId: string | null;
}

/**
 * Detail panel for the selected worker workspace.
 */
export function WorkerDetail({ worker, planExecId }: WorkerDetailProps) {
	const { lines, isConnected, error: logError } = useWorkspaceLogStream(planExecId, worker.id);
	const logContainerRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to bottom when new logs arrive
	useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
		}
	}, [lines]);

	return (
		<div className="border-b border-gray-700 p-4 flex flex-col flex-1 min-h-0 overflow-hidden">
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2 shrink-0">
				Selected Workspace Detail
			</h2>
			<div className="text-xs space-y-1 text-gray-400 mb-4 shrink-0">
				<DetailRow label="ID" value={worker.id} />
				<DetailRow label="Stage" value={worker.stage} />
				<DetailRow label="Attempts" value={String(worker.attempt)} />
				<DetailRow label="Retries" value={String(worker.retries)} />
				{worker.snapshotPath && (
					<DetailRow label="Snapshot" value={worker.snapshotPath} />
				)}
				{worker.reportPath && (
					<DetailRow label="Report" value={worker.reportPath} />
				)}
				{worker.error && (
					<div className="mt-3 pt-3 border-t border-gray-700">
						<div className="text-red-400 font-semibold mb-1">Error:</div>
						<div className="text-red-300 bg-red-900/20 p-2 rounded border border-red-800/30 whitespace-pre-wrap break-words">
							{worker.error}
						</div>
					</div>
				)}
			</div>

			{/* Live Logs Section */}
			<div className="flex-1 flex flex-col min-h-0 mt-4 border-t border-gray-700 pt-4">
				<div className="flex items-center justify-between mb-2 shrink-0">
					<h3 className="text-sm font-semibold text-gray-300">Live Logs</h3>
					<div className="flex items-center gap-2">
						{isConnected && (
							<span className="text-xs text-green-400 flex items-center gap-1">
								<span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
								Connected
							</span>
						)}
						{!isConnected && !logError && (
							<span className="text-xs text-yellow-400">Connecting...</span>
						)}
						{logError && (
							<span className="text-xs text-red-400">{logError}</span>
						)}
					</div>
				</div>
				<div
					ref={logContainerRef}
					className="flex-1 bg-gray-900 rounded border border-gray-700 p-2 overflow-y-auto font-mono text-xs text-gray-300"
				>
					{lines.length === 0 && (
						<div className="text-gray-500 italic">No logs yet...</div>
					)}
					{lines.map((line, index) => (
						<div key={index} className="whitespace-pre-wrap break-words">
							{line}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-gray-500 w-20 shrink-0">{label}:</span>
			<span className="text-gray-200 truncate">{value}</span>
		</div>
	);
}
