/**
 * MemoryCockpit — P11.Q (Memory Cockpit UI)
 *
 * Dashboard surface for organic memory health, indexed sources,
 * retrieval quality, provenance, token savings, stale memories,
 * and safe management actions.
 */

import {
	Brain,
	Database,
	Loader2,
	RefreshCw,
	Search,
	Trash2,
	AlertTriangle,
	CheckCircle,
	XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACCENT = "text-stone-600 dark:text-stone-400";
const OK = "text-green-500";
const WARN = "text-amber-500";
const ERR = "text-red-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryHealthMetrics {
	totalMemories: number;
	semanticCount: number;
	episodicCount: number;
	proceduralCount: number;
	decisionCount: number;
	failureCount: number;
	fixCount: number;
	proposalCount: number;
	planCount: number;
	validationCount: number;
	indexedSources: number;
	retrievalHitRate: number;
	tokenSavings: number;
	staleMemoryCount: number;
	blockedSourceCount: number;
	conflictCount: number;
	lastCompactionAt: string | null;
	lastPruneAt: string | null;
}

interface MemorySource {
	name: string;
	type: string;
	count: number;
	lastIndexedAt: string | null;
	blocked: boolean;
}

interface ProvenanceEntry {
	memoryId: string;
	content: string;
	source: string;
	type: string;
	confidence: number;
	freshness: "fresh" | "stale" | "superseded";
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MemoryCockpitProps {
	className?: string;
}

export const MemoryCockpit: FC<MemoryCockpitProps> = ({ className = "" }) => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [metrics, setMetrics] = useState<MemoryHealthMetrics | null>(null);
	const [sources, setSources] = useState<MemorySource[]>([]);
	const [provenance, setProvenance] = useState<ProvenanceEntry[]>([]);
	const [activeTab, setActiveTab] = useState<"overview" | "sources" | "provenance" | "actions">("overview");
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const resp = await fetch("/api/memory/health", {
				signal: AbortSignal.timeout(5000),
			});
			if (resp.ok) {
				const data = await resp.json();
				setMetrics(data.metrics);
				setSources(data.sources ?? []);
				setProvenance(data.provenance ?? []);
			} else {
				// Demo mode
				setMetrics(null);
				setSources([]);
				setProvenance([]);
			}
		} catch {
			setMetrics(null);
			setSources([]);
			setProvenance([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const performAction = useCallback(async (action: string) => {
		setActionLoading(action);
		try {
			await fetch(`/api/memory/${action}`, { method: "POST" });
			await fetchData();
		} catch {
			// Ignore
		} finally {
			setActionLoading(null);
		}
	}, [fetchData]);

	if (loading) {
		return (
			<div className={`${SURF} h-full flex items-center justify-center gap-3 ${className}`}>
				<Loader2 size={18} className="animate-spin text-stone-400" />
				<span className={`text-xs ${MUT}`}>Loading memory data...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
				<XCircle size={28} className={ERR} />
				<p className={`text-xs ${MUT}`}>{error}</p>
				<button
					onClick={fetchData}
					className={`text-xs px-3 py-1.5 rounded-lg border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					Retry
				</button>
			</div>
		);
	}

	// Empty state
	if (!metrics) {
		return (
			<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
				<div className={`w-16 h-16 rounded-2xl ${SURF} border ${BORD} flex items-center justify-center`}>
					<Brain size={28} strokeWidth={1.2} className={MUT} />
				</div>
				<div className="text-center">
					<h2 className={`text-sm font-semibold ${TXT}`}>Memory Cockpit</h2>
					<p className={`text-xs ${MUT} mt-1 max-w-xs`}>
						Memory indexing has not been configured. Upload plans and run
						executions to populate organic memory.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className={`${SURF} h-full flex flex-col ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b ${BORD}">
				<div className="flex items-center gap-2">
					<Brain size={16} className={ACCENT} />
					<h3 className={`text-xs font-semibold ${TXT}`}>Memory Cockpit</h3>
				</div>
				<button
					onClick={fetchData}
					className={`text-xs px-2 py-1 rounded border ${BORD} ${ACCENT} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					<RefreshCw size={12} />
				</button>
			</div>

			{/* Tabs */}
			<div className="flex border-b ${BORD} px-4">
				{(["overview", "sources", "provenance", "actions"] as const).map((tab) => (
					<button
						key={tab}
						onClick={() => setActiveTab(tab)}
						className={`text-xs px-3 py-2 border-b-2 transition-colors ${
							activeTab === tab
								? `${ACCENT} border-stone-600 dark:border-stone-400`
								: `${MUT} border-transparent hover:${ACCENT}`
						}`}
					>
						{tab.charAt(0).toUpperCase() + tab.slice(1)}
					</button>
				))}
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-4 space-y-3">
				{activeTab === "overview" && (
					<>
						{/* Health metrics grid */}
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Health
							</h4>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<span className={`text-[10px] ${MUT}`}>Total Memories</span>
									<p className={`text-sm font-semibold ${TXT}`}>{metrics.totalMemories}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Indexed Sources</span>
									<p className={`text-sm font-semibold ${TXT}`}>{metrics.indexedSources}</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Retrieval Hit Rate</span>
									<p className={`text-sm font-semibold ${metrics.retrievalHitRate > 0.5 ? OK : WARN}`}>
										{(metrics.retrievalHitRate * 100).toFixed(1)}%
									</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Token Savings</span>
									<p className={`text-sm font-semibold ${OK}`}>
										{metrics.tokenSavings.toLocaleString()}
									</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Stale Memories</span>
									<p className={`text-sm font-semibold ${metrics.staleMemoryCount > 0 ? WARN : OK}`}>
										{metrics.staleMemoryCount}
									</p>
								</div>
								<div>
									<span className={`text-[10px] ${MUT}`}>Blocked Sources</span>
									<p className={`text-sm font-semibold ${metrics.blockedSourceCount > 0 ? WARN : MUT}`}>
										{metrics.blockedSourceCount}
									</p>
								</div>
							</div>
						</div>

						{/* Memory type breakdown */}
						<div className={`p-3 rounded-lg border ${BORD}`}>
							<h4 className={`text-[10px] font-medium ${MUT} uppercase tracking-wider mb-2`}>
								Memory Type Breakdown
							</h4>
							<div className="space-y-1.5">
								{[
									{ label: "Semantic", value: metrics.semanticCount, color: "bg-blue-500" },
									{ label: "Episodic", value: metrics.episodicCount, color: "bg-green-500" },
									{ label: "Procedural", value: metrics.proceduralCount, color: "bg-purple-500" },
									{ label: "Decision", value: metrics.decisionCount, color: "bg-amber-500" },
									{ label: "Failure", value: metrics.failureCount, color: "bg-red-500" },
									{ label: "Fix", value: metrics.fixCount, color: "bg-emerald-500" },
									{ label: "Proposal", value: metrics.proposalCount, color: "bg-indigo-500" },
									{ label: "Plan", value: metrics.planCount, color: "bg-cyan-500" },
									{ label: "Validation", value: metrics.validationCount, color: "bg-teal-500" },
								].map((m) => (
									<div key={m.label} className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className={`w-2 h-2 rounded-full ${m.color}`} />
											<span className={`text-xs ${TXT}`}>{m.label}</span>
										</div>
										<span className={`text-xs ${MUT}`}>{m.value}</span>
									</div>
								))}
							</div>
						</div>
					</>
				)}

				{activeTab === "sources" && (
					<>
						{sources.length === 0 && (
							<div className="flex flex-col items-center justify-center gap-2 py-8">
								<Database size={24} className={MUT} />
								<p className={`text-xs ${MUT}`}>No sources indexed.</p>
							</div>
						)}
						{sources.map((src, i) => (
							<div key={i} className={`p-2.5 rounded-lg border ${BORD} flex items-center justify-between`}>
								<div>
									<p className={`text-xs font-medium ${TXT}`}>{src.name}</p>
									<span className={`text-[10px] ${MUT}`}>
										{src.type} &middot; {src.count} memories
									</span>
								</div>
								<div className="flex items-center gap-2">
									{src.blocked && (
										<AlertTriangle size={12} className={WARN} />
									)}
									<span className={`text-[10px] ${MUT}`}>
										{src.lastIndexedAt
											? new Date(src.lastIndexedAt).toLocaleDateString()
											: "Never"}
									</span>
								</div>
							</div>
						))}
					</>
				)}

				{activeTab === "provenance" && (
					<>
						{provenance.length === 0 && (
							<div className="flex flex-col items-center justify-center gap-2 py-8">
								<Search size={24} className={MUT} />
								<p className={`text-xs ${MUT}`}>No provenance data available.</p>
							</div>
						)}
						{provenance.map((entry, i) => (
							<div key={i} className={`p-2.5 rounded-lg border ${BORD}`}>
								<div className="flex items-start justify-between gap-2">
									<div className="flex-1 min-w-0">
										<p className={`text-xs ${TXT} truncate`}>{entry.content.slice(0, 120)}</p>
										<div className="flex items-center gap-2 mt-1">
											<span className={`text-[10px] ${MUT}`}>{entry.source}</span>
											<span className={`text-[10px] ${MUT}`}>{entry.type}</span>
											<span className={`text-[10px] ${
												entry.freshness === "fresh" ? OK : entry.freshness === "stale" ? WARN : ERR
											}`}>
												{entry.freshness}
											</span>
										</div>
									</div>
									<span className={`text-[10px] ${MUT} shrink-0`}>
										{(entry.confidence * 100).toFixed(0)}%
									</span>
								</div>
							</div>
						))}
					</>
				)}

				{activeTab === "actions" && (
					<div className="space-y-2">
						<button
							onClick={() => performAction("reindex")}
							disabled={actionLoading === "reindex"}
							className={`w-full p-2.5 rounded-lg border ${BORD} flex items-center gap-2 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50`}
						>
							<RefreshCw size={14} className={`${actionLoading === "reindex" ? "animate-spin" : ""} ${ACCENT}`} />
							<div className="text-left">
								<p className={`text-xs font-medium ${TXT}`}>Reindex All Sources</p>
								<p className={`text-[10px] ${MUT}`}>Re-scan and re-index all memory sources</p>
							</div>
						</button>

						<button
							onClick={() => performAction("compact")}
							disabled={actionLoading === "compact"}
							className={`w-full p-2.5 rounded-lg border ${BORD} flex items-center gap-2 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50`}
						>
							<Database size={14} className={`${actionLoading === "compact" ? "animate-spin" : ""} ${ACCENT}`} />
							<div className="text-left">
								<p className={`text-xs font-medium ${TXT}`}>Compact &amp; Prune</p>
								<p className={`text-[10px] ${MUT}`}>Remove stale and superseded memories</p>
							</div>
						</button>

						<button
							onClick={() => performAction("prune")}
							disabled={actionLoading === "prune"}
							className={`w-full p-2.5 rounded-lg border ${BORD} flex items-center gap-2 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50`}
						>
							<Trash2 size={14} className={`${actionLoading === "prune" ? "animate-spin" : ""} ${WARN}`} />
							<div className="text-left">
								<p className={`text-xs font-medium ${TXT}`}>Prune Stale Memories</p>
								<p className={`text-[10px] ${MUT}`}>
									{metrics.staleMemoryCount > 0
										? `${metrics.staleMemoryCount} stale memories will be removed`
										: "No stale memories to prune"}
								</p>
							</div>
						</button>
					</div>
				)}
			</div>
		</div>
	);
};
