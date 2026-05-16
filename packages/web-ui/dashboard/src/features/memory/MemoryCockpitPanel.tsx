/**
 * MemoryCockpitPanel — Dashboard surface for organic memory health,
 * indexed sources, retrieval quality, provenance, token savings,
 * stale memories, and safe management actions.
 *
 * P11.Q — Memory Cockpit UI
 *
 * Acceptance Criteria:
 * 1. Memory Cockpit renders health metrics and source breakdowns.
 * 2. Users can inspect memory provenance without exposing forbidden content.
 * 3. Memory management actions are policy-gated and auditable.
 * 4. Loading, empty, error, stale, and blocked-source states are implemented.
 */

import { useCallback, useState } from "react";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	Archive,
	CheckCircle2,
	Clock,
	Database,
	FileText,
	Filter,
	Info,
	Loader2,
	RefreshCw,
	Search,
	Trash2,
	XCircle,
} from "lucide-react";
import { useMemoryHealth, useMemoryProvenance, useMemoryAction, useMemoryAuditEvents } from "../../hooks/useMemoryMetrics";
import type { MemorySource, MemoryProvenance, MemoryAuditEvent } from "../../types";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const STALE_BG = "bg-stone-100 dark:bg-stone-800/30";
const STALE_TXT = "text-stone-400 dark:text-stone-500";

// ─── Helper components ───────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
	const colors: Record<string, string> = {
		active: "bg-emerald-500",
		stale: "bg-amber-400",
		blocked: "bg-red-500",
		error: "bg-red-500",
		idle: "bg-stone-400",
		running: "bg-blue-500",
		completed: "bg-emerald-500",
		failed: "bg-red-500",
	};
	return (
		<span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-stone-400"}`} />
	);
}

function StatCard({ icon, label, value, sub, loading, error }: {
	icon: React.ReactNode;
	label: string;
	value: string | number | null | undefined;
	sub?: string;
	loading?: boolean;
	error?: boolean;
}) {
	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-1 min-h-[80px]`}>
			<div className="flex items-center gap-1.5">
				<span className="text-stone-400 dark:text-stone-500">{icon}</span>
				<span className={`text-[11px] font-medium uppercase tracking-wider ${MUT}`}>{label}</span>
			</div>
			{loading ? (
				<div className="flex items-center gap-2">
					<Loader2 size={14} className="animate-spin text-stone-400" />
					<span className={`text-sm ${MUT}`}>Loading...</span>
				</div>
			) : error ? (
				<div className="flex items-center gap-1.5">
					<AlertCircle size={14} className={ERR_TXT} />
					<span className={`text-sm ${ERR_TXT}`}>Error</span>
				</div>
			) : (
				<>
					<div className={`text-lg font-semibold ${TXT}`}>
						{value != null ? value : "\u2014"}
					</div>
					{sub && <div className={`text-[11px] ${MUT}`}>{sub}</div>}
				</>
			)}
		</div>
	);
}

function Badge({ children, variant = "default" }: {
	children: React.ReactNode;
	variant?: "default" | "warning" | "error" | "success" | "info";
}) {
	const variants: Record<string, string> = {
		default: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
		warning: "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300",
		error: "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300",
		success: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300",
		info: "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300",
	};
	return (
		<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${variants[variant]}`}>
			{children}
		</span>
	);
}

function SectionHeader({ icon, title, count, action }: {
	icon: React.ReactNode;
	title: string;
	count?: number;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex items-center gap-2 mb-3">
			<span className="text-stone-400 dark:text-stone-500">{icon}</span>
			<h3 className={`text-sm font-semibold ${TXT}`}>{title}</h3>
			{count != null && (
				<span className={`text-[11px] font-medium ${MUT}`}>({count})</span>
			)}
			{action && <div className="ml-auto">{action}</div>}
		</div>
	);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MemoryHealthOverview({ metrics, loading, error, stale }: {
	metrics: NonNullable<ReturnType<typeof useMemoryHealth>["metrics"]>;
	loading: boolean;
	error: Error | null;
	stale: boolean;
}) {
	const m = metrics?.metrics;

	return (
		<div className="space-y-3">
			{/* Stale banner */}
			{stale && (
				<div className={`${WARN_BG} rounded-lg px-3 py-2 flex items-center gap-2`}>
					<Clock size={14} className={WARN_TXT} />
					<span className={`text-xs ${WARN_TXT}`}>
						Data may be stale. Last successful fetch may not reflect current state.
					</span>
				</div>
			)}

			{/* Error banner */}
			{error && (
				<div className={`${ERR_BG} rounded-lg px-3 py-2 flex items-center gap-2`}>
					<AlertCircle size={14} className={ERR_TXT} />
					<span className={`text-xs ${ERR_TXT}`}>
						{error.message || "Failed to load memory health data"}
					</span>
				</div>
			)}

			{/* Health stat cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
				<StatCard
					icon={<Database size={14} />}
					label="Total Memories"
					value={m?.totalMemories}
					loading={loading}
					error={!!error && !m}
				/>
				<StatCard
					icon={<Activity size={14} />}
					label="Retrieval Hit Rate"
					value={m?.retrievalHitRate != null ? `${(m.retrievalHitRate * 100).toFixed(1)}%` : "unknown"}
					loading={loading}
					error={!!error && !m}
				/>
				<StatCard
					icon={<Archive size={14} />}
					label="Token Savings"
					value={m?.tokenSavings != null ? `${(m.tokenSavings / 1000).toFixed(1)}k` : "unknown"}
					sub={m?.tokenSavings != null ? `${m.tokenSavings.toLocaleString()} tokens` : undefined}
					loading={loading}
					error={!!error && !m}
				/>
				<StatCard
					icon={<AlertTriangle size={14} />}
					label="Stale Memories"
					value={m?.staleMemoryCount ?? 0}
					loading={loading}
					error={!!error && !m}
				/>
			</div>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
				<StatCard
					icon={<Filter size={14} />}
					label="Active Sources"
					value={m?.activeSources ?? 0}
					sub={`of ${m?.totalSources ?? 0} total`}
					loading={loading}
				/>
				<StatCard
					icon={<XCircle size={14} />}
					label="Blocked Sources"
					value={m?.blockedSources ?? 0}
					loading={loading}
				/>
				<StatCard
					icon={<AlertTriangle size={14} />}
					label="Conflicts"
					value={m?.conflictCount ?? 0}
					loading={loading}
				/>
				<StatCard
					icon={<RefreshCw size={14} />}
					label="Pruning"
					value={m?.pruningStatus ?? "idle"}
					sub={m?.lastPrunedAt ? new Date(m.lastPrunedAt).toLocaleDateString() : undefined}
					loading={loading}
				/>
			</div>
		</div>
	);
}

function SourceBreakdown({ sources, loading }: {
	sources: MemorySource[];
	loading: boolean;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={16} className="animate-spin text-stone-400" />
				<span className={`ml-2 text-sm ${MUT}`}>Loading sources...</span>
			</div>
		);
	}

	if (sources.length === 0) {
		return (
			<div className={`${STALE_BG} rounded-lg p-6 text-center`}>
				<Database size={24} className={`mx-auto mb-2 ${MUT}`} />
				<p className={`text-sm ${MUT}`}>No memory sources indexed yet.</p>
				<p className={`text-xs mt-1 ${MUT}`}>
					Sources appear here once the memory pipeline (P11.L) indexes them.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{sources.map((source, i) => {
				const statusColor: Record<string, string> = {
					active: "text-emerald-600 dark:text-emerald-400",
					stale: "text-amber-600 dark:text-amber-400",
					blocked: "text-red-600 dark:text-red-400",
					error: "text-red-600 dark:text-red-400",
				};
				const statusLabel: Record<string, string> = {
					active: "Active",
					stale: "Stale",
					blocked: "Blocked",
					error: "Error",
				};
				return (
					<div key={i} className={`${SURF} rounded border ${BORD} px-3 py-2 flex items-center gap-3`}>
						<StatusDot status={source.status} />
						<div className="flex-1 min-w-0">
							<div className={`text-sm font-medium ${TXT} truncate`}>
								{source.type}
								{source.project && <span className={`ml-1 text-xs ${MUT}`}>in {source.project}</span>}
							</div>
							<div className={`text-xs ${MUT}`}>
								{source.count} {source.count === 1 ? "memory" : "memories"}
								{source.lastIndexedAt && (
									<> &middot; Last indexed: {new Date(source.lastIndexedAt).toLocaleDateString()}</>
								)}
							</div>
						</div>
						<Badge variant={source.status === "active" ? "success" : source.status === "stale" ? "warning" : "error"}>
							{statusLabel[source.status] ?? source.status}
						</Badge>
					</div>
				);
			})}

			{/* Show blocked source message if any blocked sources */}
			{sources.some((s) => s.status === "blocked") && (
				<div className={`${WARN_BG} rounded-lg px-3 py-2 mt-2 flex items-start gap-2`}>
					<AlertTriangle size={14} className={`mt-0.5 ${WARN_TXT}`} />
					<div>
						<p className={`text-xs font-medium ${WARN_TXT}`}>Blocked Sources</p>
						<p className={`text-[11px] mt-0.5 ${WARN_TXT}`}>
							Some sources are blocked. Reindex them or check the pipeline configuration.
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function ProvenanceList({ memories, loading, error }: {
	memories: MemoryProvenance[];
	loading: boolean;
	error: Error | null;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={16} className="animate-spin text-stone-400" />
				<span className={`ml-2 text-sm ${MUT}`}>Loading provenance...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`${ERR_BG} rounded-lg p-4`}>
				<div className="flex items-center gap-2">
					<AlertCircle size={14} className={ERR_TXT} />
					<span className={`text-sm ${ERR_TXT}`}>{error.message}</span>
				</div>
			</div>
		);
	}

	if (memories.length === 0) {
		return (
			<div className={`${STALE_BG} rounded-lg p-6 text-center`}>
				<Search size={24} className={`mx-auto mb-2 ${MUT}`} />
				<p className={`text-sm ${MUT}`}>No memory provenance records found.</p>
				<p className={`text-xs mt-1 ${MUT}`}>
					Provenance data appears once the memory pipeline is active.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{memories.map((mem) => (
				<div key={mem.id} className={`${SURF} rounded border ${BORD} p-3 space-y-1.5`}>
					<div className="flex items-start justify-between gap-2">
						<div className="flex-1 min-w-0">
							<div className={`text-sm font-medium ${TXT} truncate`}>{mem.summary}</div>
							<div className={`text-xs ${MUT} mt-0.5`}>
								From: {mem.source} ({mem.sourceType})
								{mem.project && <> &middot; Project: {mem.project}</>}
							</div>
						</div>
						{mem.confidence != null && (
							<Badge variant={mem.confidence > 0.7 ? "success" : mem.confidence > 0.4 ? "warning" : "default"}>
								{`${(mem.confidence * 100).toFixed(0)}%`}
							</Badge>
						)}
					</div>

					{/* Why-used explanation */}
					{mem.whyUsed && (
						<div className={`${ACC_BG} rounded px-2 py-1`}>
							<p className={`text-[11px] ${ACC_TXT}`}>
								<span className="font-medium">Why used: </span>
								{mem.whyUsed}
							</p>
						</div>
					)}

					<div className={`flex items-center gap-3 text-[11px] ${MUT}`}>
						<span>Created: {new Date(mem.createdAt).toLocaleDateString()}</span>
						{mem.lastAccessedAt && (
							<span>Last accessed: {new Date(mem.lastAccessedAt).toLocaleDateString()}</span>
						)}
					</div>

					{/* Associated IDs - show without exposing forbidden content */}
					{(mem.associatedPlanId || mem.associatedProposalId) && (
						<div className={`flex items-center gap-2 text-[11px] ${MUT}`}>
							{mem.associatedPlanId && (
								<span className="inline-flex items-center gap-1">
									<FileText size={10} />
									Plan: {mem.associatedPlanId.slice(0, 8)}...
								</span>
							)}
							{mem.associatedProposalId && (
								<span className="inline-flex items-center gap-1">
									<FileText size={10} />
									Proposal: {mem.associatedProposalId.slice(0, 8)}...
								</span>
							)}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

function AuditTimeline({ events, loading }: {
	events: MemoryAuditEvent[];
	loading: boolean;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<Loader2 size={16} className="animate-spin text-stone-400" />
				<span className={`ml-2 text-sm ${MUT}`}>Loading audit events...</span>
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div className={`${STALE_BG} rounded-lg p-6 text-center`}>
				<Info size={24} className={`mx-auto mb-2 ${MUT}`} />
				<p className={`text-sm ${MUT}`}>No memory audit events yet.</p>
				<p className={`text-xs mt-1 ${MUT}`}>
					Memory management actions appear here once performed.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-1.5">
			{events.slice(-20).reverse().map((event) => {
				const policyColor: Record<string, string> = {
					allowed: "text-emerald-600 dark:text-emerald-400",
					denied: "text-red-600 dark:text-red-400",
					pending_approval: "text-amber-600 dark:text-amber-400",
				};
				const policyBg: Record<string, string> = {
					allowed: "bg-emerald-50 dark:bg-emerald-900/20",
					denied: "bg-red-50 dark:bg-red-900/20",
					pending_approval: "bg-amber-50 dark:bg-amber-900/20",
				};
				return (
					<div key={event.id} className={`${SURF} rounded border ${BORD} px-3 py-2 flex items-center gap-3`}>
						<span className={`inline-block w-2 h-2 rounded-full ${policyColor[event.policyResult]}`} />
						<div className="flex-1 min-w-0">
							<div className={`text-sm ${TXT}`}>
								<span className="font-medium capitalize">{event.action}</span>
								<span className={MUT}> by </span>
								<span className="font-medium">{event.actor}</span>
								{event.target && event.target !== "all" && (
									<span className={MUT}> on {event.target}</span>
								)}
							</div>
							<div className={`text-xs ${MUT}`}>
								{new Date(event.timestamp).toLocaleString()}
							</div>
						</div>
						<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${policyColor[event.policyResult]} ${policyBg[event.policyResult]}`}>
							{event.policyResult === "pending_approval" ? "Pending" : event.policyResult === "allowed" ? "Allowed" : "Denied"}
						</span>
					</div>
				);
			})}
		</div>
	);
}

// ─── Action Buttons ──────────────────────────────────────────────────────────

function ActionButton({ label, icon, action, target, onResult, disabled }: {
	label: string;
	icon: React.ReactNode;
	action: "reindex" | "compact" | "prune" | "forget";
	target?: string;
	onResult: (result: { success: boolean; message: string; policyDenied?: boolean }) => void;
	disabled?: boolean;
}) {
	const { execute, pending } = useMemoryAction();
	const [localPending, setLocalPending] = useState(false);

	const handleClick = useCallback(async () => {
		setLocalPending(true);
		try {
			const result = await execute(action, target);
			onResult({
				success: result.success,
				message: result.result?.message ?? result.error ?? "Action completed",
				policyDenied: result.policyDenied,
			});
		} finally {
			setLocalPending(false);
		}
	}, [execute, action, target, onResult]);

	const isPending = pending || localPending;

	return (
		<button
			onClick={handleClick}
			disabled={isPending || disabled}
			className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
				${isPending
					? "bg-stone-100 dark:bg-stone-800 text-stone-400 cursor-not-allowed"
					: "bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
				}
				${disabled ? "opacity-50 cursor-not-allowed" : ""}
			`}
		>
			{isPending ? <Loader2 size={12} className="animate-spin" /> : icon}
			{isPending ? "Processing..." : label}
		</button>
	);
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface MemoryCockpitPanelProps {
	className?: string;
}

export function MemoryCockpitPanel({ className }: MemoryCockpitPanelProps) {
	const { metrics, loading, error, stale, refetch: refetchHealth } = useMemoryHealth(30_000);
	const { memories, loading: memoriesLoading, error: memoriesError, refetch: refetchProvenance } = useMemoryProvenance();
	const { events, loading: eventsLoading, refetch: refetchAudit } = useMemoryAuditEvents();
	const [actionMessage, setActionMessage] = useState<{
		success: boolean;
		message: string;
		policyDenied?: boolean;
	} | null>(null);
	const [showAudit, setShowAudit] = useState(false);
	const [showActionsFeedback, setShowActionsFeedback] = useState(true);

	const handleActionResult = useCallback((result: {
		success: boolean;
		message: string;
		policyDenied?: boolean;
	}) => {
		setActionMessage(result);
		setShowActionsFeedback(true);
		// Refresh data after action
		setTimeout(() => {
			refetchHealth();
			refetchAudit();
			refetchProvenance();
		}, 500);
		// Clear message after 5s
		setTimeout(() => {
			setActionMessage(null);
		}, 5000);
	}, [refetchHealth, refetchAudit, refetchProvenance]);

	const sources = metrics?.sources ?? [];
	const healthMetrics = metrics?.metrics;

	return (
		<div className={`overflow-y-auto ${className ?? ""}`}>
			<div className="p-4 space-y-4">
				{/* ── Header ── */}
				<div className="flex items-center justify-between">
					<div>
						<h2 className={`text-lg font-semibold ${TXT}`}>Memory Cockpit</h2>
						<p className={`text-xs ${MUT} mt-0.5`}>
							Organic memory health, indexed sources, retrieval quality, and management
						</p>
					</div>
					<button
						onClick={() => { refetchHealth(); refetchProvenance(); refetchAudit(); }}
						disabled={loading}
						className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors
							${SURF} border ${BORD} ${TXT} hover:bg-stone-50 dark:hover:bg-stone-800
							${loading ? "opacity-50 cursor-not-allowed" : ""}
						`}
					>
						<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
						Refresh
					</button>
				</div>

				{/* ── Action Feedback ── */}
				{actionMessage && showActionsFeedback && (
					<div className={`rounded-lg px-3 py-2 flex items-center gap-2 ${
						actionMessage.policyDenied
							? WARN_BG
							: actionMessage.success
								? GOOD_BG
								: ERR_BG
					}`}>
						{actionMessage.policyDenied ? (
							<AlertTriangle size={14} className={WARN_TXT} />
						) : actionMessage.success ? (
							<CheckCircle2 size={14} className={GOOD_TXT} />
						) : (
							<AlertCircle size={14} className={ERR_TXT} />
						)}
						<span className={`text-xs ${
							actionMessage.policyDenied
								? WARN_TXT
								: actionMessage.success
									? GOOD_TXT
									: ERR_TXT
						}`}>
							{actionMessage.policyDenied
								? `Policy Gate: ${actionMessage.message}`
								: actionMessage.success
									? `Success: ${actionMessage.message}`
									: `Error: ${actionMessage.message}`
							}
							{actionMessage.policyDenied && (
								<span className="ml-1 opacity-75">Action is pending approval.</span>
							)}
						</span>
						<button
							onClick={() => setActionMessage(null)}
							className="ml-auto text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
						>
							<XCircle size={12} />
						</button>
					</div>
				)}

				{/* ── Section 1: Memory Health Overview ── */}
				<div className={`${SURF} rounded-lg border ${BORD} p-4`}>
					<SectionHeader
						icon={<Activity size={16} />}
						title="Health Overview"
					/>
					<MemoryHealthOverview
						metrics={metrics ?? {
							success: false,
							metrics: null,
							sources: [],
						}}
						loading={loading}
						error={error}
						stale={stale}
					/>
				</div>

				{/* ── Section 2: Source Breakdown ── */}
				<div className={`${SURF} rounded-lg border ${BORD} p-4`}>
					<SectionHeader
						icon={<Database size={16} />}
						title="Indexed Sources"
						count={sources.length}
					/>
					<SourceBreakdown sources={sources} loading={loading} />
				</div>

				{/* ── Section 3: Memory Provenance ── */}
				<div className={`${SURF} rounded-lg border ${BORD} p-4`}>
					<SectionHeader
						icon={<Search size={16} />}
						title="Memory Provenance"
						count={memories.length}
					/>
					<ProvenanceList
						memories={memories}
						loading={memoriesLoading}
						error={memoriesError}
					/>
				</div>

				{/* ── Section 4: Memory Management Actions ── */}
				<div className={`${SURF} rounded-lg border ${BORD} p-4`}>
					<SectionHeader
						icon={<RefreshCw size={16} />}
						title="Management Actions"
					/>
					<p className={`text-xs ${MUT} mb-3`}>
						{/* eslint-disable-next-line react/no-unescaped-entities */}
						Memory actions are policy-gated and audited. Destructive actions (compact, prune, forget) require approval.
					</p>
					<div className="flex flex-wrap gap-2">
						<ActionButton
							label="Reindex"
							icon={<RefreshCw size={12} />}
							action="reindex"
							onResult={handleActionResult}
						/>
						<ActionButton
							label="Compact"
							icon={<Archive size={12} />}
							action="compact"
							onResult={handleActionResult}
						/>
						<ActionButton
							label="Prune Stale"
							icon={<Trash2 size={12} />}
							action="prune"
							onResult={handleActionResult}
						/>
						{/* Forget all is NOT provided as a bulk action - requires explicit approval */}
					</div>
					<div className={`mt-3 flex items-center gap-2 text-[11px] ${MUT}`}>
						{healthMetrics?.compactionStatus === "running" && (
							<span className="flex items-center gap-1">
								<Loader2 size={10} className="animate-spin" />
								Compaction in progress...
							</span>
						)}
						{healthMetrics?.pruningStatus === "running" && (
							<span className="flex items-center gap-1">
								<Loader2 size={10} className="animate-spin" />
								Pruning in progress...
							</span>
						)}
						{healthMetrics?.compactionStatus === "completed" && (
							<Badge variant="success">Compaction completed</Badge>
						)}
						{healthMetrics?.pruningStatus === "completed" && (
							<Badge variant="success">Pruning completed</Badge>
						)}
					</div>
				</div>

				{/* ── Section 5: Audit Timeline ── */}
				<div className={`${SURF} rounded-lg border ${BORD} p-4`}>
					<SectionHeader
						icon={<Info size={16} />}
						title="Audit Timeline"
						count={events.length}
						action={
							<button
								onClick={() => setShowAudit(!showAudit)}
								className={`text-xs font-medium ${ACC_TXT} hover:underline`}
							>
								{showAudit ? "Hide" : "Show All"}
							</button>
						}
					/>
					{showAudit ? (
						<AuditTimeline events={events} loading={eventsLoading} />
					) : (
						<AuditTimeline events={events.slice(-5)} loading={eventsLoading} />
					)}
				</div>
			</div>
		</div>
	);
}
