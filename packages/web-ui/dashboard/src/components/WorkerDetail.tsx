import { useEffect, useRef, useState } from "react";
import type { WorkerInfo, WorkspaceSummary } from "../types";
import { useWorkspaceLogStream } from "../hooks/useWorkspaceLogStream";

type TabId = "overview" | "tokens" | "git" | "commands";

interface WorkerDetailProps {
	worker: WorkerInfo;
	planExecId: string | null;
	workspace?: WorkspaceSummary;
}

const TABS: { id: TabId; label: string }[] = [
	{ id: "overview", label: "Overview" },
	{ id: "tokens", label: "Tokens" },
	{ id: "git", label: "Git" },
	{ id: "commands", label: "Commands" },
];

export function WorkerDetail({ worker, planExecId, workspace }: WorkerDetailProps) {
	const [activeTab, setActiveTab] = useState<TabId>("overview");
	const { lines, isConnected, isReconnecting, error: logError } = useWorkspaceLogStream(planExecId, worker.id);
	const logContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (logContainerRef.current) {
			logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
		}
	}, [lines]);

	const statusIndicator = worker.stage === "active"
		? "bg-emerald-500"
		: worker.stage === "failed"
			? "bg-red-500"
			: worker.stage === "blocked"
				? "bg-amber-500"
				: "bg-stone-300";

	return (
		<div className="border-b border-[#E8E6E1] p-4 flex flex-col flex-1 min-h-0 bg-white">
			<h2 className="text-sm font-semibold text-stone-700 tracking-wide mb-2 shrink-0 flex items-center gap-2">
				<span className={`inline-block w-2 h-2 rounded-full ${statusIndicator}`} />
				{worker.id}
			</h2>

			<div className="flex gap-1 mb-3 shrink-0 border-b border-[#E8E6E1]">
				{TABS.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
							activeTab === tab.id
								? "bg-[#EBF2FF] text-blue-700 border-b-2 border-blue-500"
								: "text-stone-400 hover:text-stone-600 hover:bg-stone-50"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			<div
					key={activeTab}
					className="flex-1 flex flex-col min-h-0"
				>
					{activeTab === "overview" && (
						<OverviewTab
							worker={worker}
							workspace={workspace}
							lines={lines}
							isConnected={isConnected}
							isReconnecting={isReconnecting}
							logError={logError}
							logContainerRef={logContainerRef}
						/>
					)}
					{activeTab === "tokens" && <TokensTab workspace={workspace} />}
					{activeTab === "git" && <GitTab workspace={workspace} />}
					{activeTab === "commands" && <CommandsTab lines={lines} />}
			</div>
		</div>
	);
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({
	worker,
	workspace,
	lines,
	isConnected,
	isReconnecting,
	logError,
	logContainerRef,
}: {
	worker: WorkerInfo;
	workspace?: WorkspaceSummary;
	lines: string[];
	isConnected: boolean;
	isReconnecting: boolean;
	logError: string | null;
	logContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
	const now = Date.now();
	const lastActivityTs = workspace?.updatedAt ?? workspace?.startedAt ?? null;
	const idleSeconds = lastActivityTs != null ? Math.floor((now - lastActivityTs) / 1000) : null;
	const idleMinutes = idleSeconds != null ? Math.floor(idleSeconds / 60) : null;

	let idleWarning: string | null = null;
	if (idleMinutes != null && idleMinutes > 3) idleWarning = `No output for ${idleMinutes}m`;
	if (idleMinutes != null && idleMinutes > 10) idleWarning = `Worker may be hung`;

	return (
		<div className="flex flex-col flex-1 min-h-0">
			<div className="text-xs space-y-1 text-stone-500 mb-3 shrink-0">
				<DetailRow label="ID" value={worker.id} />
				<DetailRow label="Stage" value={worker.stage} />
				<DetailRow label="Attempts" value={String(worker.attempt)} />
				<DetailRow label="Retries" value={String(worker.retries)} />
				{worker.snapshotPath && <DetailRow label="Snapshot" value={worker.snapshotPath} />}
				{worker.reportPath && <DetailRow label="Report" value={worker.reportPath} />}
				{idleSeconds != null && <DetailRow label="Last activity" value={`${idleSeconds}s ago`} />}

				{idleWarning && (
					<div className={`mt-1 text-xs font-medium ${idleMinutes != null && idleMinutes > 10 ? "text-red-600" : "text-amber-600"}`}>
						{idleWarning}
					</div>
				)}

				{worker.error && (
					<div className="mt-3 pt-3 border-t border-[#E8E6E1]">
						<div className="text-red-600 font-semibold mb-1">Error:</div>
						<div className="text-red-700 bg-red-50 p-2 rounded border border-red-200 whitespace-pre-wrap break-words">
							{worker.error}
						</div>
					</div>
				)}
			</div>

			<div className="flex-1 flex flex-col min-h-0 mt-2 border-t border-[#E8E6E1] pt-3 overflow-hidden">
				<div className="flex items-center justify-between mb-2 shrink-0">
					<h3 className="text-sm font-semibold text-stone-600">Live Logs</h3>
					<div className="flex items-center gap-2">
						{isConnected && (
							<span className="text-xs text-emerald-600 flex items-center gap-1">
								<span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
								Connected
							</span>
						)}
						{isReconnecting && (
							<span className="text-xs text-amber-600 flex items-center gap-1">
								<span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
								Reconnecting...
							</span>
						)}
						{!isConnected && !isReconnecting && !logError && lines.length > 0 && (
							<span className="text-xs text-stone-400">Disconnected</span>
						)}
						{!isConnected && !isReconnecting && !logError && lines.length === 0 && (
							<span className="text-xs text-stone-400">Connecting...</span>
						)}
						{logError && !isReconnecting && <span className="text-xs text-red-500">{logError}</span>}
					</div>
				</div>
				<div
					ref={logContainerRef as React.RefObject<HTMLDivElement>}
					className="flex-1 bg-stone-50 rounded border border-[#E8E6E1] p-2 overflow-y-auto font-mono text-xs text-stone-700 min-h-0"
				>
					{lines.length === 0 && <div className="text-stone-400 italic">No logs yet...</div>}
					{lines.map((line, index) => (
						<div key={index} className="whitespace-pre-wrap break-words">{line}</div>
					))}
				</div>
			</div>
		</div>
	);
}

// ── Tokens Tab ────────────────────────────────────────────────────────────────

function TokensTab({ workspace }: { workspace?: WorkspaceSummary }) {
	const ctxUsed = workspace?.contextUsed;
	const ctxLimit = workspace?.contextLimit;

	if (ctxUsed === undefined || ctxLimit === undefined || ctxLimit === 0) return null;

	const pct = Math.round((ctxUsed / ctxLimit) * 100);
	const thresholdColor = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";

	return (
		<div>
			<h3 className="text-xs font-semibold text-stone-600 mb-2">Context Window</h3>
			<div className="text-xs text-stone-500 mb-1">
				Context: {formatCount(ctxUsed)} / {formatCount(ctxLimit)} ({pct}%)
			</div>
			<div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-500 ${thresholdColor}`}
					style={{ width: `${Math.min(pct, 100)}%` }}
				/>
			</div>
		</div>
	);
}

// ── Git Tab ───────────────────────────────────────────────────────────────────

function GitTab({ workspace }: { workspace?: WorkspaceSummary }) {
	const branch = workspace?.gitBranch;
	const dirty = workspace?.gitDirty;
	const commits = workspace?.gitCommits;

	if (!branch && !dirty && (!commits || commits.length === 0)) {
		return <div className="flex-1 flex items-center justify-center text-stone-400 text-xs">Git data unavailable</div>;
	}

	return (
		<div className="text-xs space-y-3 text-stone-600">
			{branch && <DetailRow label="Branch" value={branch} />}
			{dirty !== undefined && <DetailRow label="Working tree" value={dirty ? "Dirty" : "Clean"} />}
			{commits && commits.length > 0 && (
				<div>
					<span className="text-stone-400 text-xs block mb-1">Recent commits:</span>
					<div className="space-y-0.5">
						{commits.map((c, i) => (
							<div key={i} className="text-stone-600 font-mono truncate">{c}</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Commands Tab ──────────────────────────────────────────────────────────────

function CommandsTab({ lines }: { lines: string[] }) {
	const commandLines = lines.filter(
		(line) =>
			line.startsWith("$ ") ||
			line.includes("tool_call") ||
			line.includes("tool_use") ||
			line.includes("<function=") ||
			line.includes("function_call"),
	);

	if (commandLines.length === 0) {
		return <div className="flex-1 flex items-center justify-center text-stone-400 text-xs">No commands detected yet</div>;
	}

	return (
		<div className="flex-1 bg-stone-50 rounded border border-[#E8E6E1] p-2 overflow-y-auto font-mono text-xs text-stone-700 min-h-0">
			{commandLines.map((line, i) => (
				<div key={i} className="whitespace-pre-wrap break-words">{line}</div>
			))}
		</div>
	);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-stone-400 w-20 shrink-0">{label}:</span>
			<span className="text-stone-700 truncate">{value}</span>
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
