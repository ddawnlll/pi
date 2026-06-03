import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
	Loader2,
	Layers,
	AlertTriangle,
	Play,
	Clock,
	CheckCircle2,
	XCircle,
	LayoutGrid,
	List,
	Search,
} from "lucide-react";
import type { WorkspaceSummary } from "../../types";
import { WorkerCard } from "./WorkerCard";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface WorkersGridProps {
	workspaces: WorkspaceSummary[];
	loading?: boolean;
	onStop?: (workspaceId: string) => void;
	onRetry?: (workspaceId: string) => void;
	className?: string;
}

type FilterTab = "all" | "active" | "pending" | "blocked" | "complete" | "failed";

// ─── Filter definitions ────────────────────────────────────────────────────

interface FilterDef {
	id: FilterTab;
	label: string;
	icon: typeof AlertTriangle;
	color: string;
	bg: string;
	border: string;
}

const FILTERS: FilterDef[] = [
	{ id: "all", label: "All", icon: LayoutGrid, color: "text-stone-600 dark:text-stone-300", bg: "bg-stone-100 dark:bg-stone-800", border: "border-stone-200 dark:border-stone-700" },
	{ id: "active", label: "Running", icon: Play, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-200 dark:border-blue-800" },
	{ id: "pending", label: "Ready", icon: Clock, color: "text-stone-500", bg: "bg-stone-50 dark:bg-stone-800/50", border: "border-stone-200 dark:border-stone-700" },
	{ id: "blocked", label: "Blocked", icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-800" },
	{ id: "complete", label: "Completed", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-200 dark:border-emerald-800" },
	{ id: "failed", label: "Failed", icon: XCircle, color: "text-red-500", bg: "bg-red-50 dark:bg-red-900/20", border: "border-red-200 dark:border-red-800" },
];

// ─── Group order for unfiltered view ───────────────────────────────────────

type GroupId = "active" | "pending" | "blocked" | "complete" | "failed";

const GROUP_ORDER: GroupId[] = ["active", "blocked", "pending", "complete", "failed"];

interface GroupDef {
	id: GroupId;
	label: string;
	icon: typeof AlertTriangle;
	color: string;
}

const GROUP_DEFS: GroupDef[] = [
	{ id: "active", label: "Running", icon: Play, color: "text-blue-400" },
	{ id: "blocked", label: "Blocked", icon: AlertTriangle, color: "text-amber-400" },
	{ id: "pending", label: "Ready", icon: Clock, color: "text-stone-400 dark:text-stone-500" },
	{ id: "complete", label: "Completed", icon: CheckCircle2, color: "text-emerald-400" },
	{ id: "failed", label: "Failed", icon: XCircle, color: "text-red-400" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function WorkersGrid({ workspaces, loading = false, onStop, onRetry, className = "" }: WorkersGridProps) {
	const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

	// Filter workspaces
	const filteredWorkspaces = useMemo(() => {
		let result = workspaces;
		if (activeFilter !== "all") {
			result = result.filter((w) => w.stage === activeFilter);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter((w) => w.id.toLowerCase().includes(q));
		}
		return result;
	}, [workspaces, activeFilter, searchQuery]);

	// Group for unfiltered view
	const grouped = useMemo(() => {
		if (activeFilter !== "all") return null;
		const groups: Record<GroupId, WorkspaceSummary[]> = {
			active: [],
			pending: [],
			blocked: [],
			complete: [],
			failed: [],
		};
		for (const w of filteredWorkspaces) {
			switch (w.stage) {
				case "active":
					groups.active.push(w);
					break;
				case "pending":
					groups.pending.push(w);
					break;
				case "blocked":
					groups.blocked.push(w);
					break;
				case "complete":
					groups.complete.push(w);
					break;
				case "failed":
					groups.failed.push(w);
					break;
				default:
					groups.pending.push(w);
				}
		}
		return groups;
	}, [filteredWorkspaces, activeFilter]);

	// Count per filter
	const counts = useMemo(() => {
		return {
			all: workspaces.length,
			active: workspaces.filter((w) => w.stage === "active").length,
			pending: workspaces.filter((w) => w.stage === "pending").length,
			blocked: workspaces.filter((w) => w.stage === "blocked").length,
			complete: workspaces.filter((w) => w.stage === "complete").length,
			failed: workspaces.filter((w) => w.stage === "failed").length,
		};
	}, [workspaces]);

	if (loading) {
		return (
			<div className={`flex flex-col items-center justify-center gap-4 py-20 ${className}`}>
				<motion.div
					animate={{ rotate: 360 }}
					transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
				>
					<Loader2 size={28} className="text-blue-400" />
				</motion.div>
				<p className="text-sm text-stone-400 dark:text-stone-500">Loading workers...</p>
			</div>
		);
	}

	if (workspaces.length === 0) {
		return (
			<motion.div
				initial={{ opacity: 0, y: 20 }}
				animate={{ opacity: 1, y: 0 }}
				className={`flex flex-col items-center justify-center gap-4 py-20 ${className}`}
			>
				<div className="w-16 h-16 rounded-2xl bg-stone-100 dark:bg-[#2A2A2A] flex items-center justify-center">
					<Layers size={28} className="text-stone-300 dark:text-stone-600" />
				</div>
				<p className="text-sm font-medium text-stone-500 dark:text-stone-400">No workers yet</p>
				<p className="text-xs text-stone-400 dark:text-stone-500 max-w-xs text-center">
					Workers will appear here as the plan executes. Upload a plan to get started.
				</p>
			</motion.div>
		);
	}

	const gridCols = viewMode === "grid"
		? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
		: "grid-cols-1";

	return (
		<div className={`flex flex-col h-full ${className}`}>
			{/* ── Filter bar ── */}
			<div className="shrink-0 px-4 py-3 border-b border-[#E8E6E1] dark:border-[#333]">
				<div className="flex flex-col sm:flex-row sm:items-center gap-3">
					{/* Filter pills */}
					<div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-hide">
						{FILTERS.map((filter) => {
							const isActive = activeFilter === filter.id;
							const count = counts[filter.id];
							const Icon = filter.icon;
							return (
								<motion.button
									key={filter.id}
									onClick={() => setActiveFilter(filter.id)}
									whileHover={{ scale: 1.05 }}
									whileTap={{ scale: 0.95 }}
									className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
										transition-colors duration-200 whitespace-nowrap
										${isActive
											? `${filter.bg} ${filter.color} ${filter.border} border`
											: "text-stone-500 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
										}`}
								>
									<Icon size={12} />
									<span>{filter.label}</span>
									{count > 0 && (
										<span className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs font-bold
											${isActive ? "bg-white/50 dark:bg-white/10" : "bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
											{count}
										</span>
									)}
									{isActive && (
										<motion.div
											layoutId="activeFilter"
											className="absolute inset-0 rounded-lg border-2 border-blue-500/30 dark:border-blue-400/30"
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										/>
									)}
								</motion.button>
							);
						})}
					</div>

					{/* Search + View toggle */}
					<div className="flex items-center gap-2 ml-auto">
						<div className="relative">
							<Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
							<input
								type="text"
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search workers..."
								className="pl-8 pr-3 py-1.5 rounded-lg text-xs bg-stone-100 dark:bg-[#2A2A2A] border border-transparent
									focus:border-blue-500/30 focus:outline-none text-stone-700 dark:text-stone-300
									placeholder:text-stone-400 w-40 transition-all focus:w-52"
							/>
						</div>
						<div className="flex items-center bg-stone-100 dark:bg-[#2A2A2A] rounded-lg p-0.5">
							<button
								onClick={() => setViewMode("grid")}
								className={`p-1.5 rounded-md transition-colors ${viewMode === "grid" ? "bg-white dark:bg-[#1E1E1E] shadow-sm" : ""}`}
							>
								<LayoutGrid size={13} className={viewMode === "grid" ? "text-stone-700 dark:text-stone-300" : "text-stone-400"} />
							</button>
							<button
								onClick={() => setViewMode("list")}
								className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-white dark:bg-[#1E1E1E] shadow-sm" : ""}`}
							>
								<List size={13} className={viewMode === "list" ? "text-stone-700 dark:text-stone-300" : "text-stone-400"} />
							</button>
						</div>
					</div>
				</div>
			</div>

			{/* ── Content ── */}
			<div className="flex-1 min-h-0 overflow-y-auto p-4">
				{filteredWorkspaces.length === 0 ? (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						className="flex flex-col items-center justify-center gap-3 py-16"
					>
						<Search size={24} className="text-stone-300 dark:text-stone-600" />
						<p className="text-sm text-stone-400 dark:text-stone-500">No workers match your filter</p>
					</motion.div>
				) : activeFilter === "all" && grouped ? (
					// Grouped view
					<div className="space-y-6">
						{GROUP_ORDER.map((groupId) => {
							const groupWorkspaces = grouped[groupId];
							if (groupWorkspaces.length === 0) return null;
							const groupDef = GROUP_DEFS.find((g) => g.id === groupId)!;
							const Icon = groupDef.icon;

							return (
								<motion.div
									key={groupId}
									initial={{ opacity: 0, y: 10 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.3 }}
								>
									{/* Group header */}
									<div className="flex items-center gap-2 mb-3 px-1">
										<Icon size={14} className={groupDef.color} />
										<h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
											{groupDef.label}
										</h3>
										<span className="text-xs text-stone-400 dark:text-stone-500">
											{groupWorkspaces.length}
										</span>
									</div>

									{/* Grid */}
									<div className={`grid ${gridCols} gap-3`}>
										<AnimatePresence mode="popLayout">
											{groupWorkspaces.map((workspace, i) => (
												<WorkerCard
													key={workspace.id}
													workspace={workspace}
													index={i}
													onStop={onStop}
													onRetry={onRetry}
												/>
											))}
										</AnimatePresence>
									</div>
								</motion.div>
							);
						})}
					</div>
				) : (
					// Flat filtered view
					<div className={`grid ${gridCols} gap-3`}>
						<AnimatePresence mode="popLayout">
							{filteredWorkspaces.map((workspace, i) => (
								<WorkerCard
									key={workspace.id}
									workspace={workspace}
									index={i}
									onStop={onStop}
									onRetry={onRetry}
								/>
							))}
						</AnimatePresence>
					</div>
				)}
			</div>

			{/* ── Footer stats ── */}
			<div className="shrink-0 px-4 py-2 border-t border-[#E8E6E1] dark:border-[#333] flex items-center gap-4 text-xs text-stone-400 dark:text-stone-500">
				<span>{workspaces.length} total workers</span>
				{counts.active > 0 && <span className="text-blue-400">{counts.active} running</span>}
				{counts.blocked > 0 && <span className="text-amber-400">{counts.blocked} blocked</span>}
				{counts.failed > 0 && <span className="text-red-400">{counts.failed} failed</span>}
			</div>
		</div>
	);
}
