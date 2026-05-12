import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { WorkerInfo, WorkspaceSummary } from "../types";
import { useWorkspaceLogStream } from "../hooks/useWorkspaceLogStream";
import { ActivityDot, stageToPulseState } from "./ActivityDot";

type TabId = "overview" | "tokens" | "git" | "commands";

interface WorkerDetailProps {
	worker: WorkerInfo;
	planExecId: string | null;
	/** Extended workspace detail — required for Tokens / Git tabs */
	workspace?: WorkspaceSummary;
}

const TABS: { id: TabId; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "tokens", label: "Tokens" },
	{ id: "git", label: "Git" },
	{ id: "commands", label: "Commands" },
];

/**
 * Detail panel for the selected worker workspace with tab navigation.
 *
 * Tabs:
 *  - Overview: metadata, idle/hang detection, live WebSocket logs
 *  - Tokens: context meter + per-worker token stats
 *  - Git: branch, dirty files, commits or "Git data unavailable"
 *  - Commands: filtered command lines from the log stream
 */
export function WorkerDetail({ worker, planExecId, workspace }: WorkerDetailProps) {
	const [activeTab, setActiveTab] = useState<TabId>("overview");
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
			{/* Header with activity dot + title */}
			<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2 shrink-0 flex items-center gap-2">
				<ActivityDot state={stageToPulseState(worker.stage)} />
				{worker.id}
			</h2>

			{/* Tab navigation */}
			<div className="flex gap-1 mb-3 shrink-0 border-b border-gray-700">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
							activeTab === tab.id
								? "bg-gray-700 text-gray-100 border-b-2 border-blue-500"
								: "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Tab content */}
			<AnimatePresence mode="wait">
				<motion.div
					key={activeTab}
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={{ duration: 0.15 }}
					className="flex-1 flex flex-col min-h-0 overflow-hidden"
				>
					{activeTab === "overview" && (
						<OverviewTab
							worker={worker}
							workspace={workspace}
							lines={lines}
							isConnected={isConnected}
							logError={logError}
							logContainerRef={logContainerRef}
						/>
					)}
					{activeTab === "tokens" && (
						<TokensTab worker={worker} workspace={workspace} />
					)}
					{activeTab === "git" && (
						<GitTab workspace={workspace} />
					)}
					{activeTab === "commands" && (
						<CommandsTab lines={lines} />
					)}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

// =============================================================================
// Overview Tab
// =============================================================================

interface OverviewTabProps {
	worker: WorkerInfo;
	workspace?: WorkspaceSummary;
	lines: string[];
	isConnected: boolean;
	logError: string | null;
	logContainerRef: React.RefObject<HTMLDivElement | null>;
}

function OverviewTab({
	worker,
	workspace,
	lines,
	isConnected,
	logError,
	logContainerRef,
}: OverviewTabProps) {
	// Idle / hang detection — derived from workspace.updatedAt
	const now = Date.now();
	const lastActivityTs = workspace?.updatedAt ?? workspace?.startedAt ?? null;
	const idleSeconds =
		lastActivityTs != null ? Math.floor((now - lastActivityTs) / 1000) : null;
	const idleMinutes =
		idleSeconds != null ? Math.floor(idleSeconds / 60) : null;

	let idleWarning: string | null = null;
	if (idleMinutes != null && idleMinutes > 3) {
		idleWarning = `⚠ No output for ${idleMinutes}m`;
	}
	if (idleMinutes != null && idleMinutes > 10) {
		idleWarning = `⚠ Worker may be hung`;
	}

	return (
		<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
			{/* Metadata */}
			<div className="text-xs space-y-1 text-gray-400 mb-3 shrink-0">
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

				{/* Last activity */}
				{idleSeconds != null && (
					<DetailRow
						label="Last activity"
						value={`${idleSeconds}s ago`}
					/>
				)}

				{/* Idle / hang warning */}
				{idleWarning && (
					<div
						className={`mt-1 text-xs font-medium ${
							idleMinutes != null && idleMinutes > 10
								? "text-red-400"
								: "text-amber-400"
						}`}
					>
						{idleWarning}
					</div>
				)}

				{/* Error display */}
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
			<div className="flex-1 flex flex-col min-h-0 mt-2 border-t border-gray-700 pt-3">
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

// =============================================================================
// Tokens Tab
// =============================================================================

interface TokensTabProps {
	worker: WorkerInfo;
	workspace?: WorkspaceSummary;
}

function TokensTab({ worker, workspace }: TokensTabProps) {
	const ctxUsed = workspace?.contextUsed;
	const ctxLimit = workspace?.contextLimit;

	// If context data is unavailable, hide entirely (do not show 0%)
	if (ctxUsed === undefined || ctxLimit === undefined || ctxLimit === 0) {
		return null;
	}

	const pct = Math.round((ctxUsed / ctxLimit) * 100);
	const thresholdColor =
		pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500";

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h3 className="text-xs font-semibold text-gray-300 mb-2">Context Window</h3>
				<div className="text-xs text-gray-400 mb-1">
					Context: {formatCount(ctxUsed)} / {formatCount(ctxLimit)} ({pct}%)
				</div>
				<div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
					<div
						className={`h-full rounded-full transition-all duration-500 ${thresholdColor}`}
						style={{ width: `${Math.min(pct, 100)}%` }}
					/>
				</div>
			</div>
		</div>
	);
}

// =============================================================================
// Git Tab
// =============================================================================

interface GitTabProps {
	workspace?: WorkspaceSummary;
}

function GitTab({ workspace }: GitTabProps) {
	const branch = workspace?.gitBranch;
	const dirty = workspace?.gitDirty;
	const commits = workspace?.gitCommits;

	if (!branch && !dirty && (!commits || commits.length === 0)) {
		return (
			<div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
				Git data unavailable
			</div>
		);
	}

	return (
		<div className="text-xs space-y-3">
			{branch && <DetailRow label="Branch" value={branch} />}
			{dirty !== undefined && (
				<DetailRow
					label="Working tree"
					value={dirty ? "Dirty" : "Clean"}
				/>
			)}
			{commits && commits.length > 0 && (
				<div>
					<span className="text-gray-500 text-xs block mb-1">
						Recent commits:
					</span>
					<div className="space-y-0.5">
						{commits.map((c, i) => (
							<div key={i} className="text-gray-300 font-mono truncate">
								{c}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// =============================================================================
// Commands Tab
// =============================================================================

interface CommandsTabProps {
	lines: string[];
}

function CommandsTab({ lines }: CommandsTabProps) {
	const commandLines = lines.filter(
		(line) =>
			line.startsWith("$ ") ||
			line.includes("tool_call") ||
			line.includes("tool_use") ||
			line.includes("<function=") ||
			line.includes("function_call"),
	);

	if (commandLines.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
				No commands detected yet
			</div>
		);
	}

	return (
		<div className="flex-1 bg-gray-900 rounded border border-gray-700 p-2 overflow-y-auto font-mono text-xs text-gray-300 min-h-0">
			{commandLines.map((line, i) => (
				<div key={i} className="whitespace-pre-wrap break-words">
					{line}
				</div>
			))}
		</div>
	);
}

// =============================================================================
// Helpers
// =============================================================================

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-gray-500 w-20 shrink-0">{label}:</span>
			<span className="text-gray-200 truncate">{value}</span>
		</div>
	);
}

function formatCount(n: number): string {
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${m.toFixed(m % 1 === 0 ? 0 : 1)}M`;
	}
	if (n >= 1_000) {
		const k = n / 1_000;
		return `${k.toFixed(k % 1 === 0 ? 0 : 1)}k`;
	}
	return String(n);
}
