import { useRef, useEffect } from "react";
import type { WorkerInfo, WorkspaceSummary, WorkspaceAttempt, WorkerTranscriptEvent } from "../../../types";
import { AttemptHistoryTable } from "../AttemptHistoryTable";
import { EditStrategyWarnings } from "../../EditStrategyWarnings";

interface OverviewTabProps {
	worker: WorkerInfo;
	workspace?: WorkspaceSummary;
	lines: string[];
	isConnected: boolean;
	isReconnecting: boolean;
	logError: string | null;
	attempts: WorkspaceAttempt[];
	attemptsLoading: boolean;
	transcriptEvents: WorkerTranscriptEvent[];
}

export function OverviewTab({
	worker, workspace, lines, isConnected, isReconnecting, logError,
	attempts, attemptsLoading, transcriptEvents,
}: OverviewTabProps) {
	const logContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
		}
	}, [lines]);

	return (
		<div className="flex flex-col gap-4 pt-3">
			<div className="grid grid-cols-2 gap-2 text-xs">
				<div className="text-stone-400 dark:text-stone-500">Stage:</div>
				<div className="text-stone-800 dark:text-stone-200 font-medium capitalize">{worker.stage}</div>
				<div className="text-stone-400 dark:text-stone-500">Attempt:</div>
				<div className="text-stone-800 dark:text-stone-200">{worker.attempt}</div>
				{worker.error && (
					<>
						<div className="text-stone-400 dark:text-stone-500">Error:</div>
						<div className="text-red-600 dark:text-red-400 break-words col-span-2">{worker.error}</div>
					</>
				)}
			</div>

			<AttemptHistoryTable attempts={attempts} loading={attemptsLoading} />

			{workspace?.editAuditSummary && (
				<EditStrategyWarnings data={{
					editMode: workspace.editAuditSummary.editModeUsed ?? "unknown",
					blockedRewrites: workspace.editAuditSummary.blockedRewrites,
					truncationEvents: workspace.editAuditSummary.truncationEvents,
					exactMatchFailures: workspace.editAuditSummary.exactMatchFailures,
					handoffTriggered: worker.stage === "blocked",
					failedFiles: [],
				}} />
			)}

			{worker.stage === "blocked" && !workspace?.editAuditSummary && (
				<div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded p-2 text-xs">
					<div className="flex items-center gap-2">
						<span className="inline-block w-2 h-2 bg-amber-500 rounded-full shrink-0" />
						<span className="font-semibold text-amber-700 dark:text-amber-400">Patch-first mode active</span>
					</div>
					<div className="text-amber-700 dark:text-amber-300 mt-1">
						This worker is blocked. Full rewrites are restricted — use targeted edits (patches) to modify existing files.
					</div>
				</div>
			)}

			<div className="flex flex-col min-h-0 border-t border-[#E8E6E1] dark:border-[#333] pt-3">
				<div className="flex items-center justify-between mb-2 shrink-0 flex-wrap gap-1">
					<h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400">Live Logs</h3>
					<div className="flex items-center gap-2 shrink-0">
						{isConnected && <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />Connected ({lines.length} lines)</span>}
						{isReconnecting && <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />Reconnecting...</span>}
						{!isConnected && !isReconnecting && !logError && lines.length === 0 && <span className="text-xs text-stone-400 dark:text-stone-500">Connecting...</span>}
						{!isConnected && !isReconnecting && lines.length > 0 && <span className="text-xs text-stone-400 dark:text-stone-500">{lines.length} lines (disconnected)</span>}
						{logError && !isReconnecting && <span className="text-xs text-red-500 dark:text-red-400">{logError}</span>}
					</div>
				</div>
				<div
					ref={logContainerRef}
					className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-800 dark:text-stone-200"
					style={{ maxHeight: "50vh", minHeight: "120px" }}
				>
					{lines.length === 0 && <div className="text-stone-400 dark:text-stone-500 italic">No logs yet...</div>}
					{lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)}
				</div>
			</div>
		</div>
	);
}
