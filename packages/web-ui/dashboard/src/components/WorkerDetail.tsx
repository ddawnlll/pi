import { useState } from "react";
import type { WorkerInfo, WorkspaceSummary, LogStream } from "../types";
import { useWorkerData } from "../hooks/useWorkerData";
import { useWorkspaceLogStream } from "../hooks/useWorkspaceLogStream";
import { useWorkerTranscript } from "../hooks/useWorkerTranscript";
import { OverviewTab } from "./worker-detail/tabs/OverviewTab";
import { PiCliTab } from "./worker-detail/tabs/PiCliTab";
import { TokensTab } from "./worker-detail/tabs/TokensTab";
import { PerformanceTab } from "./worker-detail/tabs/PerformanceTab";
import { GitTab } from "./worker-detail/tabs/GitTab";
import { CommandsTab } from "./worker-detail/tabs/CommandsTab";
import { LogsTab } from "./worker-detail/tabs/LogsTab";
import { TranscriptTab } from "./worker-detail/tabs/TranscriptTab";
import { WorkerP6LifecycleTab } from "./WorkerP6LifecycleTab";

type TabId = "overview" | "pi-cli" | "tokens" | "performance" | "git" | "commands" | "logs" | "transcript" | "p6-lifecycle";

const TABS: { id: TabId; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "pi-cli", label: "Pi CLI" },
	{ id: "tokens", label: "Tokens" },
	{ id: "performance", label: "Performance" },
	{ id: "git", label: "Git" },
	{ id: "commands", label: "Commands" },
	{ id: "logs", label: "Logs" },
	{ id: "transcript", label: "Transcript" },
	{ id: "p6-lifecycle", label: "P6 Lifecycle" },
];

interface WorkerDetailProps {
	worker: WorkerInfo;
	planExecId: string | null;
	workspace?: WorkspaceSummary;
}

export function WorkerDetail({ worker, planExecId, workspace }: WorkerDetailProps) {
	const [activeTab, setActiveTab] = useState<TabId>("overview");
	const [activeLogStream, setActiveLogStream] = useState<LogStream>("raw");

	// Centralized data hook — all tab fetches happen once here
	const { attempts, attemptsLoading, patches, diffLoading, diffError, perfMetrics, perfLoading, perfError } =
		useWorkerData({ planExecId, workerId: worker.id });

	// Stream hooks only used by specific tabs
	const { lines, isConnected, isReconnecting, error: logError } = useWorkspaceLogStream(planExecId, worker.id);
	const { events: transcriptEvents } = useWorkerTranscript({ planExecId, workspaceId: worker.id });

	const statusDot = worker.stage === "active" ? "bg-emerald-500"
		: worker.stage === "failed" ? "bg-red-500"
		: worker.stage === "blocked" ? "bg-amber-500"
		: "bg-stone-300 dark:bg-stone-600";

	return (
		<div className="flex flex-col h-full bg-white dark:bg-[#1E1E1E]">
			{/* Header + tabs */}
			<div className="shrink-0 px-4 pt-4 pb-0">
				<h2 className="text-sm font-semibold text-stone-800 dark:text-stone-200 tracking-wide mb-2 flex items-center gap-2">
					<span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
					{worker.id}
				</h2>
				<div className="flex gap-1 border-b border-[#E8E6E1] dark:border-[#333] overflow-x-auto">
					{TABS.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`px-3 py-1.5 text-xs rounded-t whitespace-nowrap transition-colors ${
								activeTab === tab.id
									? "bg-[#EBF2FF] dark:bg-[#1A2A44] text-blue-700 dark:text-blue-300 border-b-2 border-blue-500 dark:border-blue-400"
									: "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Tab content */}
			<div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
				{activeTab === "overview" && (
					<OverviewTab
						worker={worker} workspace={workspace}
						lines={lines} isConnected={isConnected} isReconnecting={isReconnecting}
						logError={logError} attempts={attempts} attemptsLoading={attemptsLoading}
						transcriptEvents={transcriptEvents}
					/>
				)}
				{activeTab === "pi-cli" && (
					<PiCliTab lines={lines} isConnected={isConnected} isReconnecting={isReconnecting} logError={logError} workerId={worker.id} />
				)}
				{activeTab === "tokens" && <TokensTab workspace={workspace} />}
				{activeTab === "performance" && <PerformanceTab metrics={perfMetrics} loading={perfLoading} error={perfError} />}
				{activeTab === "git" && (
					<GitTab workspace={workspace} planExecId={planExecId} workerId={worker.id}
						patches={patches} diffLoading={diffLoading} diffError={diffError} />
				)}
				{activeTab === "commands" && <CommandsTab lines={lines} />}
				{activeTab === "logs" && <LogsTab planExecId={planExecId} workerId={worker.id} activeStream={activeLogStream} onSwitchStream={setActiveLogStream} />}
				{activeTab === "transcript" && <TranscriptTab planExecId={planExecId} workerId={worker.id} />}
				{activeTab === "p6-lifecycle" && <WorkerP6LifecycleTab worker={worker} workspace={workspace} planExecId={planExecId} />}
			</div>
		</div>
	);
}
