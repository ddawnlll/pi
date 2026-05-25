import React from "react";
import { Brain, AlertCircle, Loader2, X, RotateCw } from "lucide-react";
import type { BrainSignal } from "../types-brain";
import { useProjectBrainContext } from "../hooks/useProjectBrainContext";
import { ProjectMemorySnippet } from "./digest/ProjectMemorySnippet";
import { ReflectionSnippet } from "./digest/ReflectionSnippet";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrainContextPanelProps {
	/** Project ID to scope brain context data */
	projectId: string | null;
	/** Whether the panel is visible */
	isOpen: boolean;
	/** Called when the panel is closed */
	onClose: () => void;
}

// ---------------------------------------------------------------------------
// Section divider
// ---------------------------------------------------------------------------

function SectionDivider() {
	return <div className={`h-px bg-[#E8E6E1] dark:bg-[#333] shrink-0`} />;
}

// ---------------------------------------------------------------------------
// Brain Context Panel
// ---------------------------------------------------------------------------

/**
 * BrainContextPanel — Displays brain context (memories, reflections, signals)
 * for the currently selected project.
 *
 * States:
 * - Loading: skeleton placeholders
 * - Error: message with retry button
 * - Empty: appropriate empty states per section
 * - Success: populated with memories, reflections, and signal counts
 */
export function BrainContextPanel({ projectId, isOpen, onClose }: BrainContextPanelProps) {
	const {
		memories,
		reflections,
		signals,
		memoryStats,
		loading,
		error,
		refresh,
	} = useProjectBrainContext(projectId);

	if (!isOpen) return null;

	return (
		<aside className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden h-full w-80`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<Brain size={14} strokeWidth={1.5} className={MUT} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Brain Context
					</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={refresh}
						className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors"
						title="Refresh brain context"
					>
						<RotateCw size={12} strokeWidth={1.5} />
					</button>
					<button
						onClick={onClose}
						className="p-1 rounded text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors"
						title="Close"
					>
						<X size={12} strokeWidth={1.5} />
					</button>
				</div>
			</div>

			{/* Scrollable content */}
			<div className="flex-1 overflow-y-auto">
				{/* Full loading state */}
				{loading && memories.length === 0 && reflections.length === 0 && (
					<div className="flex flex-col items-center justify-center h-full gap-3 p-6">
						<Loader2 size={18} className={`animate-spin ${MUT}`} />
						<p className={`text-xs ${MUT}`}>Loading brain context...</p>
					</div>
				)}

				{/* Full error state (no data at all) */}
				{error && memories.length === 0 && reflections.length === 0 && (
					<div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
						<AlertCircle size={20} className="text-red-400" />
						<p className="text-xs text-red-400 dark:text-red-500">{error}</p>
						<button
							onClick={refresh}
							className="px-3 py-1 text-[10px] font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
						>
							Retry
						</button>
					</div>
				)}

				{/* Inline error banner (data present but refresh failed) */}
				{error && (memories.length > 0 || reflections.length > 0) && (
					<div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-[10px] text-red-700 dark:text-red-300 flex items-center gap-2">
						<AlertCircle size={10} />
						<span className="flex-1">{error}</span>
						<button onClick={refresh} className="underline hover:no-underline">Retry</button>
					</div>
				)}

				{/* Signal summary bar */}
				{signals.length > 0 && (
					<>
						<div className="px-3 pt-3 pb-1">
							<div className="flex items-center gap-1.5">
								{signals.filter(s => s.severity === "critical").length > 0 && (
									<span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
										{signals.filter(s => s.severity === "critical").length} critical
									</span>
								)}
								{signals.filter(s => s.severity === "warning").length > 0 && (
									<span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
										{signals.filter(s => s.severity === "warning").length} warnings
									</span>
								)}
								{signals.filter(s => s.severity === "info").length > 0 && (
									<span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
										{signals.filter(s => s.severity === "info").length} info
									</span>
								)}
							</div>
						</div>
					</>
				)}

				{/* Memory stats summary */}
				{memoryStats && (
					<div className="px-3 pt-3 pb-1">
						<div className="flex items-center gap-3 text-[9px] text-stone-400">
							<span>{memoryStats.total} memories</span>
							<span>{(memoryStats.averageConfidence * 100).toFixed(0)}% avg. confidence</span>
						</div>
					</div>
				)}

				{/* Memories section */}
				<div className="px-3 pt-3">
					<h3 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
						Recent Memories
					</h3>
					<ProjectMemorySnippet
						memories={memories}
						loading={loading}
						error={error}
						onRefresh={refresh}
						maxItems={3}
					/>
				</div>

				{/* Reflections section */}
				<SectionDivider />
				<div className="px-3 pt-3 pb-4">
					<h3 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
						Recent Reflections
					</h3>
					<ReflectionSnippet
						reflections={reflections}
						loading={loading}
						error={error}
						onRefresh={refresh}
						maxItems={2}
					/>
				</div>
			</div>
		</aside>
	);
}
