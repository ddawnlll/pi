/**
 * LeadAgentDashboard — Main dashboard for the Read-Only Lead Agent (P8.G / P11).
 *
 * Displays the proposal inbox with evidence, status, and approval requirements.
 * Provides a "Run Analysis" button to manually trigger lead agent analysis and
 * a live transcript stream to watch its thinking in real-time.
 *
 * Features:
 * - Proposals list with status filters
 * - Manual trigger with target paths and plan selection
 * - Real-time thinking transcript SSE stream with file_read events
 * - Pause / Resume / Stop controls
 *
 * Acceptance Criteria:
 * - Displays proposal evidence and status (AC1)
 * - Dashboard cannot directly mutate protected systems or queue state (AC2)
 * - Makes approval requirements clear (AC3)
 * - Manual trigger + live transcript (P11.N)
 * - Pause/Stop analysis (P11.N)
 * - Target folder/file and plan execution analysis (P11.N)
 * - Shows which files are being read during analysis (P11.N)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	AlertCircle,
	Bot,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	File,
	FileText,
	Filter,
	Folder,
	FolderOpen,
	Loader2,
	Pause,
	Play,
	RefreshCw,
	Square,
	Terminal,
	XCircle,
} from "lucide-react";
import { useProposals } from "../hooks/useProposals";
import { usePlanExecutions } from "../hooks/usePlanExecutions";
import { ProposalCard } from "./ProposalCard";
import { ProposalDetailPanel } from "./ProposalDetailPanel";

// ---------------------------------------------------------------------------
// Styling tokens (matching App.tsx)
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Status filter tabs
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "pending", label: "Pending" },
	{ key: "approved", label: "Approved" },
	{ key: "rejected", label: "Rejected" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptEvent {
	type: "status" | "analysis" | "thought" | "complete" | "file_read";
	content: string;
	timestamp: number;
	files?: string[];
	counts?: Record<string, number>;
	issues?: Record<string, number>;
	lines?: number;
	sizeKB?: string;
}

type AnalysisState = "idle" | "running" | "paused" | "stopped";

// ---------------------------------------------------------------------------
// Live transcript hook
// ---------------------------------------------------------------------------

function useLeadAgentStream(onComplete?: () => void) {
	const [transcript, setTranscript] = useState<TranscriptEvent[]>([]);
	const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
	const [hasStarted, setHasStarted] = useState(false);
	const eventSourceRef = useRef<EventSource | null>(null);

	const connect = async () => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
		}

		setAnalysisState("running");
		setHasStarted(true);

		const es = new EventSource("/api/orchestrator/lead-agent/stream");
		eventSourceRef.current = es;

		es.onmessage = (e) => {
			try {
				const data: TranscriptEvent = JSON.parse(e.data);
				setTranscript((prev) => [...prev, data]);

				if (data.type === "complete") {
					setAnalysisState("stopped");
					es.close();
					eventSourceRef.current = null;
					onComplete?.();
				}
			} catch {
				// Ignore malformed events
			}
		};

		es.onerror = () => {
			es.close();
			eventSourceRef.current = null;
			setAnalysisState("stopped");
		};
	};

	const pause = async () => {
		await fetch("/api/orchestrator/lead-agent/control", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "pause" }),
		});
		setAnalysisState("paused");
	};

	const resume = async () => {
		await fetch("/api/orchestrator/lead-agent/control", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "resume" }),
		});
		setAnalysisState("running");
	};

	const stop = async () => {
		await fetch("/api/orchestrator/lead-agent/control", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "stop" }),
		});
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}
		setAnalysisState("stopped");
	};

	useEffect(() => {
		return () => {
			if (eventSourceRef.current) {
				eventSourceRef.current.close();
				eventSourceRef.current = null;
			}
		};
	}, []);

	return { transcript, analysisState, hasStarted, connect, pause, resume, stop };
}

// ---------------------------------------------------------------------------
// File picker sub-component (simple tree browser)
// ---------------------------------------------------------------------------

interface FileNode {
	name: string;
	path: string;
	type: "file" | "directory";
	children?: FileNode[];
	expanded?: boolean;
}

function FileTreeItem({
	node,
	selectedPaths,
	onToggle,
	depth = 0,
}: {
	node: FileNode;
	selectedPaths: string[];
	onToggle: (path: string) => void;
	depth?: number;
}) {
	const isSelected = selectedPaths.includes(node.path);
	const isDir = node.type === "directory";

	return (
		<div>
			<button
				onClick={() => {
					if (isDir) {
						onToggle(node.path); // select/deselect directory
					} else {
						onToggle(node.path);
					}
				}}
				className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-left transition-colors ${
					isSelected ? `${ACC_BG} ${ACC_TXT}` : `${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`
				}`}
				style={{ paddingLeft: `${12 + depth * 14}px` }}
			>
				{isDir ? (
					isSelected ? (
						<FolderOpen size={11} className="shrink-0 text-amber-500" />
					) : (
						<Folder size={11} className="shrink-0 text-amber-500" />
					)
				) : (
					<FileText size={11} className="shrink-0 text-blue-500" />
				)}
				<span className="truncate">{node.name}</span>
				{isSelected && <span className="ml-auto text-[8px] opacity-60">selected</span>}
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LeadAgentDashboardProps {
	className?: string;
}

export function LeadAgentDashboard({ className = "" }: LeadAgentDashboardProps) {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
	const [triggerError, setTriggerError] = useState<string | null>(null);

	// File tree browser
	const [fileTreeOpen, setFileTreeOpen] = useState(false);
	const [targetPaths, setTargetPaths] = useState<string[]>([]);

	// Plan execution browser
	const [planDropdownOpen, setPlanDropdownOpen] = useState(false);
	const [planExecId, setPlanExecId] = useState("");

	const transcriptEndRef = useRef<HTMLDivElement>(null);
	const { data: proposals = [], isLoading, error, refetch } = useProposals(
		statusFilter === "all" ? undefined : { status: statusFilter },
	);

	// Fetch latest executions for plan picker (no project context = legacy mode)
	const { data: executions = [] } = usePlanExecutions("");

	const { transcript, analysisState, hasStarted, connect, pause, resume, stop } = useLeadAgentStream(() => {
		setTimeout(() => refetch(), 500);
	});

	// Derive selected proposal from the list
	const selectedProposal = useMemo(
		() => proposals.find((p) => p.id === selectedProposalId) ?? null,
		[proposals, selectedProposalId],
	);

	// Clear selectedProposalId when filter removes the proposal from view
	if (selectedProposalId !== null) {
		if (!proposals.find((p) => p.id === selectedProposalId)) {
			setTimeout(() => setSelectedProposalId(null), 0);
		}
	}

	// Auto-scroll transcript
	useEffect(() => {
		if (transcriptEndRef.current) {
			transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [transcript]);

	// Counts for filter tabs
	const counts = useMemo(() => {
		const all = proposals.length;
		const pending = proposals.filter((p) => p.status === "pending").length;
		const approved = proposals.filter((p) => p.status === "approved").length;
		const rejected = proposals.filter((p) => p.status === "rejected").length;
		return { all, pending, approved, rejected };
	}, [proposals]);

	// Derive file tree from available packages (simple static tree)
	const fileTree: FileNode[] = useMemo(() => [
		{
			name: "packages",
			path: "packages",
			type: "directory",
			children: [
				{ name: "web-server/", path: "packages/web-server", type: "directory" },
				{ name: "  src/", path: "packages/web-server/src", type: "directory" },
				{ name: "  index.ts", path: "packages/web-server/src/index.ts", type: "file" },
				{ name: "  orchestrator-routes.ts", path: "packages/web-server/src/orchestrator-routes.ts", type: "file" },
				{ name: "  proposal-routes.ts", path: "packages/web-server/src/proposal-routes.ts", type: "file" },
				{ name: "coding-agent/", path: "packages/coding-agent", type: "directory" },
				{ name: "  src/", path: "packages/coding-agent/src", type: "directory" },
				{ name: "  main.ts", path: "packages/coding-agent/src/main.ts", type: "file" },
				{ name: "  orchestrator/", path: "packages/coding-agent/src/orchestrator", type: "directory" },
				{ name: "web-ui/", path: "packages/web-ui", type: "directory" },
				{ name: "  dashboard/", path: "packages/web-ui/dashboard", type: "directory" },
				{ name: "    components/", path: "packages/web-ui/dashboard/src/components", type: "directory" },
			],
		},
	], []);

	const togglePath = (path: string) => {
		setTargetPaths((prev) =>
			prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
		);
	};

	// Trigger lead agent analysis
	const handleRunAnalysis = async () => {
		setTriggerError(null);
		try {
			const body: Record<string, unknown> = { scanKind: targetPaths.length > 0 ? "targeted" : "full" };
			if (targetPaths.length > 0) body.targetPaths = targetPaths;
			if (planExecId) body.planExecutionId = planExecId;

			const res = await fetch("/api/orchestrator/run-lead-agent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.success) {
				setTriggerError(data.error ?? "Failed to trigger analysis");
			} else {
				await connect();
			}
		} catch (e) {
			setTriggerError(String(e));
		}
	};

	// Count file read events
	const fileReadEventCount = useMemo(
		() => transcript.filter((e) => e.type === "file_read").length,
		[transcript],
	);

	// Helper: type icon for transcript events
	const renderEvent = (ev: TranscriptEvent, i: number) => {
		if (ev.type === "file_read") {
			return (
				<div key={i} className="flex items-start gap-2 text-[10px] leading-relaxed">
					<span className="shrink-0 mt-0.5 text-blue-400"><File size={10} /></span>
					<div className="flex-1 min-w-0">
						<p className="text-blue-600 dark:text-blue-300 font-mono text-[10px]">
							{ev.content}
						</p>
						{ev.issues && (
							<p className={`text-[9px] ${MUT} mt-0.5`}>
								{ev.issues.any ? `${ev.issues.any}x any ` : ""}
								{ev.issues.todo ? `${ev.issues.todo}x TODO ` : ""}
								{ev.issues.console ? `${ev.issues.console}x console.log` : ""}
							</p>
						)}
						{ev.lines && (
							<p className={`text-[9px] ${MUT}`}>{ev.lines} lines</p>
						)}
						{ev.files && ev.files.length > 0 && (
							<div className="flex flex-wrap gap-1 mt-0.5">
								{ev.files.slice(0, 5).map((f, fi) => (
									<span key={fi} className="text-[8px] px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300">
										{f.split("/").pop()}
									</span>
								))}
								{ev.files.length > 5 && (
									<span className="text-[8px] text-stone-400">+{ev.files.length - 5} more</span>
								)}
							</div>
						)}
					</div>
				</div>
			);
		}

		return (
			<div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
				<span className="shrink-0 mt-0.5">
					{ev.type === "status" && <span className="text-blue-500">●</span>}
					{ev.type === "analysis" && <span className="text-amber-500">🔍</span>}
					{ev.type === "thought" && <span className="text-emerald-500">💭</span>}
					{ev.type === "complete" && <span className="text-green-500">✓</span>}
				</span>
				<div className="flex-1 min-w-0">
					<p
						className={`${
							ev.type === "status"
								? "text-blue-600 dark:text-blue-300 font-medium"
								: ev.type === "thought"
									? "text-emerald-700 dark:text-emerald-300 italic"
									: ev.type === "complete"
										? "text-green-600 dark:text-green-400 font-medium"
										: TXT
						}`}
					>
						{ev.content}
					</p>
					<p className={`text-[9px] ${MUT} mt-0.5`}>
						{new Date(ev.timestamp).toLocaleTimeString()}
					</p>
				</div>
			</div>
		);
	};

	// Loading state
	if (isLoading) {
		return (
			<div className={`flex items-center justify-center h-full ${BG} ${className}`}>
				<div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
					<Loader2 size={16} className="animate-spin" /> Loading proposals...
				</div>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className={`flex items-center justify-center h-full ${BG} ${className}`}>
				<div className="flex flex-col items-center gap-3 text-sm text-red-600 dark:text-red-400">
					<AlertCircle size={24} strokeWidth={1.5} />
					<p>Failed to load proposals</p>
					<p className={`text-xs ${MUT}`}>{String(error)}</p>
					<button
						onClick={() => refetch()}
						className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
					>
						<RefreshCw size={12} /> Retry
					</button>
				</div>
			</div>
		);
	}

	const isIdle = analysisState === "idle";

	return (
		<div className={`flex h-full overflow-hidden ${BG} ${className}`}>
			{/* Left: Proposal list + config */}
			<div className={`w-72 shrink-0 border-r ${BORD} ${SURF} flex flex-col overflow-hidden`}>
				{/* Header */}
				<div className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD}`}>
					<Bot size={14} strokeWidth={1.8} className={ACC_TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>Lead Agent Proposals</span>
					<div className="flex-1" />
					<button
						onClick={() => refetch()}
						className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
						title="Refresh proposals"
					>
						<RefreshCw size={13} strokeWidth={1.8} />
					</button>
				</div>

				{/* Status filter tabs */}
				<div className={`shrink-0 flex items-center border-b ${BORD} px-2 gap-1 h-10`}>
					{STATUS_FILTERS.map((f) => (
						<button
							key={f.key}
							onClick={() => { setStatusFilter(f.key); setSelectedProposalId(null); }}
							className={`flex items-center gap-1 h-7 px-2.5 rounded text-[10px] font-medium transition-colors ${
								statusFilter === f.key
									? `${ACC_BG} ${ACC_TXT}`
									: `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
							}`}
						>
							{f.key === "pending" && <AlertCircle size={10} className="text-amber-500" />}
							{f.key === "approved" && <CheckCircle size={10} className="text-emerald-500" />}
							{f.key === "rejected" && <XCircle size={10} className="text-red-500" />}
							{f.key === "all" && <Filter size={10} />}
							{f.label}
							{counts[f.key] > 0 && (
								<span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
									statusFilter === f.key
										? "bg-white/50 dark:bg-black/20"
										: "bg-stone-100 dark:bg-[#2A2A2A]"
								}`}>
									{counts[f.key]}
								</span>
							)}
						</button>
					))}
				</div>

				{/* Configuration panel (only when idle) */}
				{isIdle && (
					<div className={`shrink-0 border-b ${BORD}`}>
						{/* File/Folder picker */}
						<div>
							<button
								onClick={() => setFileTreeOpen(!fileTreeOpen)}
								className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-medium ${ACC_TXT} hover:opacity-80`}
							>
								{fileTreeOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
								<FolderOpen size={11} />
								{targetPaths.length > 0
									? `${targetPaths.length} paths selected`
									: "Select files / folders"}
							</button>
							{fileTreeOpen && (
								<div className="max-h-40 overflow-y-auto border-t border-[#E8E6E1] dark:border-[#333] pb-1">
									{fileTree.map((node) => (
										<FileTreeItem
											key={node.path}
											node={node}
											selectedPaths={targetPaths}
											onToggle={togglePath}
										/>
									))}
								</div>
							)}
						</div>

						{/* Plan execution picker */}
						<div>
							<button
								onClick={() => setPlanDropdownOpen(!planDropdownOpen)}
								className={`w-full flex items-center gap-2 px-3 py-2 text-[10px] font-medium ${ACC_TXT} hover:opacity-80`}
							>
								{planDropdownOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
								<Bot size={11} />
								{planExecId ? `Plan: ${planExecId.slice(0, 12)}...` : "Select plan execution"}
							</button>
							{planDropdownOpen && (
								<div className="max-h-32 overflow-y-auto border-t border-[#E8E6E1] dark:border-[#333] pb-1">
									<button
										onClick={() => { setPlanExecId(""); setPlanDropdownOpen(false); }}
										className={`w-full text-left px-3 py-1.5 text-[10px] ${MUT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
									>
										None
									</button>
									{executions.slice(0, 10).map((ex) => (
										<button
											key={ex.id}
											onClick={() => { setPlanExecId(ex.id); setPlanDropdownOpen(false); }}
											className={`w-full text-left px-3 py-1.5 text-[10px] truncate ${
												planExecId === ex.id ? `${ACC_BG} ${ACC_TXT}` : TXT
											} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
										>
											{ex.id.slice(0, 12)} — {ex.title ?? ex.status}
										</button>
									))}
									{executions.length === 0 && (
										<p className={`px-3 py-2 text-[10px] ${MUT}`}>No plan executions found</p>
									)}
								</div>
							)}
						</div>
					</div>
				)}

				{/* Empty state */}
				{proposals.length === 0 ? (
					<div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
						<Bot size={32} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
						<p className={`text-sm ${MUT}`}>No proposals found</p>
						<p className={`text-xs ${MUT} text-center max-w-xs`}>
							Select files/folders or a plan execution above, then click "Run Analysis".
						</p>
					</div>
				) : (
					/* Proposal list */
					<div className="flex-1 min-h-0 overflow-y-auto">
						{proposals.map((p) => (
							<ProposalCard
								key={p.id}
								proposal={p}
								selected={p.id === selectedProposalId}
								onClick={() => setSelectedProposalId(p.id)}
							/>
						))}
					</div>
				)}

				{/* Bottom: Run / Pause / Stop controls */}
				<div className={`shrink-0 border-t ${BORD} p-3 space-y-2`}>
					{isIdle ? (
						<button
							onClick={handleRunAnalysis}
							className={`w-full flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium transition-colors ${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1A3A5A]`}
						>
							<Play size={13} strokeWidth={2} />
							Run Analysis
							{targetPaths.length > 0 && ` (${targetPaths.length} targets)`}
							{planExecId && " + plan"}
						</button>
					) : (
						<div className="flex gap-2">
							{analysisState === "running" && (
								<button
									onClick={pause}
									className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:opacity-80"
								>
									<Pause size={12} /> Pause
								</button>
							)}
							{analysisState === "paused" && (
								<button
									onClick={resume}
									className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:opacity-80"
								>
									<Play size={12} /> Resume
								</button>
							)}
							<button
								onClick={stop}
								className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[10px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:opacity-80"
							>
								<Square size={12} /> Stop
							</button>
						</div>
					)}

					{/* Status indicator */}
					{!isIdle && (
						<div className="flex items-center justify-center gap-1.5">
							<span className={`w-1.5 h-1.5 rounded-full ${
								analysisState === "running"
									? "bg-emerald-500 animate-pulse"
									: analysisState === "paused"
										? "bg-amber-500"
										: "bg-stone-400"
							}`} />
							<span className={`text-[9px] font-medium ${
								analysisState === "running"
									? "text-emerald-600 dark:text-emerald-400"
									: analysisState === "paused"
										? "text-amber-600 dark:text-amber-400"
										: MUT
							}`}>
								{analysisState === "running" && "Running"}
								{analysisState === "paused" && "Paused"}
								{analysisState === "stopped" && "Complete"}
							</span>
							{transcript.length > 0 && (
								<span className={`text-[9px] ${MUT}`}>
									{transcript.length} events
									{fileReadEventCount > 0 && ` (${fileReadEventCount} files)`}
								</span>
							)}
						</div>
					)}

					{triggerError && (
						<p className="text-[10px] text-red-500 text-center">{triggerError}</p>
					)}
				</div>
			</div>

			{/* Center: Live Transcript */}
			<div className={`w-80 shrink-0 border-r ${BORD} ${SURF} flex flex-col overflow-hidden`}>
				<div className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD}`}>
					<Terminal size={14} strokeWidth={1.8} className={ACC_TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>Live Transcript</span>
					<div className="flex-1" />
					{analysisState === "running" && (
						<span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
							Live
						</span>
					)}
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
					{!hasStarted ? (
						<div className="flex flex-col items-center justify-center h-full gap-2 text-center">
							<Terminal size={24} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
							<p className={`text-xs ${MUT}`}>
								Click "Run Analysis" to watch the lead agent think.
							</p>
						</div>
					) : transcript.length === 0 && analysisState === "running" ? (
						<div className="flex items-center justify-center h-full gap-2">
							<Loader2 size={14} className="animate-spin text-stone-400" />
							<span className={`text-xs ${MUT}`}>Connecting to analysis stream...</span>
						</div>
					) : transcript.length === 0 && analysisState === "stopped" ? (
						<p className={`text-xs ${MUT} text-center`}>Stream ended. No events received.</p>
					) : (
						transcript.map((ev, i) => renderEvent(ev, i))
					)}
					<div ref={transcriptEndRef} />
				</div>

				{/* Pause/Stop footer in transcript panel */}
				{analysisState === "running" && (
					<div className={`shrink-0 border-t ${BORD} p-2 flex gap-2`}>
						<button onClick={pause} className="flex-1 flex items-center justify-center gap-1 h-7 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:opacity-80">
							<Pause size={11} /> Pause
						</button>
						<button onClick={stop} className="flex-1 flex items-center justify-center gap-1 h-7 rounded text-[10px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:opacity-80">
							<Square size={11} /> Stop
						</button>
					</div>
				)}
				{analysisState === "paused" && (
					<div className={`shrink-0 border-t ${BORD} p-2 flex gap-2`}>
						<button onClick={resume} className="flex-1 flex items-center justify-center gap-1 h-7 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:opacity-80">
							<Play size={11} /> Resume
						</button>
						<button onClick={stop} className="flex-1 flex items-center justify-center gap-1 h-7 rounded text-[10px] font-medium bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:opacity-80">
							<Square size={11} /> Stop
						</button>
					</div>
				)}
			</div>

			{/* Right: Proposal detail */}
			<div className="flex-1 min-w-0 overflow-hidden">
				{selectedProposal ? (
					<ProposalDetailPanel
						proposal={selectedProposal}
						onProposalUpdated={() => refetch()}
					/>
				) : proposals.length > 0 ? (
					<div className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}>
						<Bot size={28} strokeWidth={1.2} />
						<p className="text-sm">Select a proposal to view details</p>
					</div>
				) : hasStarted && (analysisState === "running" || analysisState === "paused") ? (
					<div className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}>
						<Loader2 size={20} className="animate-spin text-stone-400" />
						<p className="text-sm">Analysis running — proposals will appear here when complete.</p>
					</div>
				) : (
					<div className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}>
						<Bot size={32} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
						<p className="text-sm">No proposal selected</p>
					</div>
				)}
			</div>
		</div>
	);
}
