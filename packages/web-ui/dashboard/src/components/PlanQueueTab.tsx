import { useState, useCallback, useRef } from "react";
import {
	Play, Pause, Square, SkipForward, Trash2, ArrowUpToLine,
	GripVertical, Loader2, Upload, Clock, AlertCircle, CheckCircle2,
	ChevronUp, ChevronDown, Ban,
} from "lucide-react";
import { usePlanQueue, type PlanQueueEntry } from "../hooks/usePlanQueue";
import { StatusBadge } from "./StatusBadge";
import { SectionHeader, Divider } from "./SectionHeader";

// ── constants ──────────────────────────────────────────────────────────────

const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ── helpers ────────────────────────────────────────────────────────────────

function formatTime(ts: number | null): string {
	if (!ts) return "—";
	const d = new Date(ts);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function statusColor(status: PlanQueueEntry["status"]): string {
	switch (status) {
		case "active": return "text-emerald-600 dark:text-emerald-400";
		case "pending": return "text-stone-500 dark:text-stone-400";
		case "complete": return "text-blue-600 dark:text-blue-400";
		case "failed": return "text-red-600 dark:text-red-400";
		case "skipped": return "text-orange-500 dark:text-orange-400";
		case "blocked": return "text-amber-600 dark:text-amber-400";
	}
}

function statusBg(status: PlanQueueEntry["status"]): string {
	switch (status) {
		case "active": return "bg-emerald-50 dark:bg-emerald-950/30";
		case "pending": return "bg-stone-50 dark:bg-stone-800/30";
		case "complete": return "bg-blue-50 dark:bg-blue-950/30";
		case "failed": return "bg-red-50 dark:bg-red-950/30";
		case "skipped": return "bg-orange-50 dark:bg-orange-950/30";
		case "blocked": return "bg-amber-50 dark:bg-amber-950/30";
	}
}

// ── QueueEntryRow ──────────────────────────────────────────────────────────

interface QueueEntryRowProps {
	entry: PlanQueueEntry;
	index: number;
	isFirst: boolean;
	isLast: boolean;
	isDragging: boolean;
	isDragOver: boolean;
	onDragStart: (e: React.DragEvent, entryId: string) => void;
	onDragOver: (e: React.DragEvent, index: number) => void;
	onDragEnd: () => void;
	onSkip: (entryId: string) => void;
	onRemove: (entryId: string) => void;
	onMoveToTop: (entryId: string) => void;
	onMoveUp: (entryId: string) => void;
	onMoveDown: (entryId: string) => void;
}

function QueueEntryRow({
	entry,
	index,
	isFirst,
	isLast,
	isDragging,
	isDragOver,
	onDragStart,
	onDragOver,
	onDragEnd,
	onSkip,
	onRemove,
	onMoveToTop,
	onMoveUp,
	onMoveDown,
}: QueueEntryRowProps) {
	const isActive = entry.status === "active";
	const isTerminal = entry.status === "complete" || entry.status === "failed" || entry.status === "skipped";
	const canDrag = entry.status === "pending";

	return (
		<div
			draggable={canDrag}
			onDragStart={(e) => onDragStart(e, entry.entryId)}
			onDragOver={(e) => onDragOver(e, index)}
			onDragEnd={onDragEnd}
			className={`
				flex items-center gap-2 px-3 py-2 border-b ${BORD} transition-all duration-150 select-none
				${isDragging ? "opacity-50 scale-[0.98]" : ""}
				${isDragOver ? "border-t-2 border-t-blue-400 dark:border-t-blue-500" : ""}
				${statusBg(entry.status)}
			`}
		>
			{/* Drag handle */}
			<div className={`shrink-0 ${canDrag ? "cursor-grab" : "cursor-default opacity-30"}`}>
				<GripVertical size={14} className={MUT} />
			</div>

			{/* Position number */}
			<span className={`text-[10px] font-mono ${MUT} w-5 text-center shrink-0`}>{index + 1}</span>

			{/* Status indicator */}
			<span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 ${statusColor(entry.status)}`}>
				{entry.status}
			</span>

			{/* Title */}
			<span className={`flex-1 min-w-0 text-xs font-medium truncate ${isActive ? "text-emerald-700 dark:text-emerald-300" : TXT}`}>
				{entry.title}
			</span>

			{/* Time info */}
			<span className={`text-[10px] ${MUT} shrink-0 tabular-nums`}>
				{entry.startedAt ? formatTime(entry.startedAt) : formatTime(entry.queuedAt)}
			</span>

			{/* Error */}
			{entry.error && (
				<span className="text-[10px] text-red-500 dark:text-red-400 truncate max-w-[100px]" title={entry.error}>
					{entry.error}
				</span>
			)}

			{/* Action buttons */}
			<div className="flex items-center gap-0.5 shrink-0">
				{!isActive && entry.status === "pending" && (
					<>
						<button
							onClick={() => onMoveToTop(entry.entryId)}
							disabled={isFirst}
							title="Move to top"
							className={`h-6 w-6 inline-flex items-center justify-center rounded transition-colors
								${isFirst ? "text-stone-200 dark:text-stone-700 cursor-default" : "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-700 dark:hover:text-stone-300"}`}
						>
							<ArrowUpToLine size={12} />
						</button>
						<button
							onClick={() => onMoveUp(entry.entryId)}
							disabled={isFirst}
							title="Move up"
							className={`h-6 w-6 inline-flex items-center justify-center rounded transition-colors
								${isFirst ? "text-stone-200 dark:text-stone-700 cursor-default" : "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-700 dark:hover:text-stone-300"}`}
						>
							<ChevronUp size={12} />
						</button>
						<button
							onClick={() => onMoveDown(entry.entryId)}
							disabled={isLast}
							title="Move down"
							className={`h-6 w-6 inline-flex items-center justify-center rounded transition-colors
								${isLast ? "text-stone-200 dark:text-stone-700 cursor-default" : "text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-700 dark:hover:text-stone-300"}`}
						>
							<ChevronDown size={12} />
						</button>
					</>
				)}
				{!isActive && !isTerminal && (
					<button
						onClick={() => onSkip(entry.entryId)}
						title="Skip"
						className="h-6 w-6 inline-flex items-center justify-center rounded text-stone-400 dark:text-stone-500 hover:bg-orange-50 dark:hover:bg-orange-950/50 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
					>
						<SkipForward size={12} />
					</button>
				)}
				{!isActive && entry.status !== "complete" && (
					<button
						onClick={() => onRemove(entry.entryId)}
						title="Remove"
						className="h-6 w-6 inline-flex items-center justify-center rounded text-stone-400 dark:text-stone-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 transition-colors"
					>
						<Trash2 size={12} />
					</button>
				)}
				{isActive && (
					<span className="flex items-center gap-1 text-[10px] text-emerald-500 dark:text-emerald-400">
						<Loader2 size={10} className="animate-spin" /> running
					</span>
				)}
			</div>
		</div>
	);
}

// ── MultiPlanUpload ────────────────────────────────────────────────────────

interface MultiPlanUploadProps {
	onEnqueue: (plans: Array<{ planContent: string; planFileName?: string }>) => void;
	isEnqueueing: boolean;
}

function MultiPlanUpload({ onEnqueue, isEnqueueing }: MultiPlanUploadProps) {
	const [plans, setPlans] = useState<Array<{ content: string; fileName: string }>>([
		{ content: "", fileName: "plan-1.md" },
	]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addPlanSlot = () => {
		setPlans((prev) => [
			...prev,
			{ content: "", fileName: `plan-${prev.length + 1}.md` },
		]);
	};

	const removePlanSlot = (index: number) => {
		setPlans((prev) => prev.filter((_, i) => i !== index));
	};

	const updatePlanContent = (index: number, content: string) => {
		setPlans((prev) =>
			prev.map((p, i) => (i === index ? { ...p, content } : p)),
		);
	};

	const updatePlanFileName = (index: number, fileName: string) => {
		setPlans((prev) =>
			prev.map((p, i) => (i === index ? { ...p, fileName } : p)),
		);
	};

	const handleFileUpload = (index: number) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".md,.json,.txt";
		input.onchange = (e) => {
			const file = (e.target as HTMLInputElement).files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (evt) => {
				const content = evt.target?.result as string;
				updatePlanContent(index, content);
				updatePlanFileName(index, file.name);
			};
			reader.readAsText(file);
		};
		input.click();
	};

	const handleEnqueue = () => {
		const validPlans = plans
			.filter((p) => p.content.trim().length > 0)
			.map((p) => ({ planContent: p.content, planFileName: p.fileName }));
		if (validPlans.length === 0) return;
		onEnqueue(validPlans);
		// Reset
		setPlans([{ content: "", fileName: "plan-1.md" }]);
	};

	const totalChars = plans.reduce((sum, p) => sum + p.content.length, 0);

	return (
		<div className={`${SURF} border ${BORD} rounded-lg p-3 space-y-3`}>
			<div className="flex items-center justify-between">
				<span className={`text-xs font-semibold ${TXT}`}>Add Plans to Queue</span>
				<span className={`text-[10px] ${MUT}`}>{plans.length} plan{plans.length !== 1 ? "s" : ""} · {totalChars} chars</span>
			</div>

			{plans.map((plan, index) => (
				<div key={index} className="space-y-1">
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={plan.fileName}
							onChange={(e) => updatePlanFileName(index, e.target.value)}
							className={`flex-1 text-xs px-2 py-1 ${SURF} border ${BORD} rounded ${TXT} placeholder:text-stone-400`}
							placeholder="Filename"
						/>
						<button
							onClick={() => handleFileUpload(index)}
							className={`text-[10px] px-2 py-1 rounded ${SURF} border ${BORD} ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`}
						>
							<Upload size={10} className="inline mr-1" /> File
						</button>
						{plans.length > 1 && (
							<button
								onClick={() => removePlanSlot(index)}
								className={`text-[10px] px-1.5 py-1 rounded text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors`}
							>
								<Trash2 size={10} />
							</button>
						)}
					</div>
					<textarea
						value={plan.content}
						onChange={(e) => updatePlanContent(index, e.target.value)}
						placeholder="Paste plan content here..."
						className={`w-full min-h-[80px] px-2 py-1.5 text-xs font-mono ${SURF} border ${BORD} rounded ${TXT} placeholder:text-stone-400 resize-y focus:outline-none focus:border-blue-400`}
						spellCheck={false}
					/>
				</div>
			))}

			<div className="flex items-center gap-2">
				<button
					onClick={addPlanSlot}
					className={`text-xs px-2.5 py-1.5 rounded border ${BORD} ${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors`}
				>
					+ Add another plan
				</button>
				<div className="flex-1" />
				<button
					onClick={handleEnqueue}
					disabled={isEnqueueing || plans.every((p) => !p.content.trim())}
					className={`text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
				>
					{isEnqueueing ? (
						<>
							<Loader2 size={10} className="animate-spin inline mr-1" /> Adding...
						</>
					) : (
						<>
							<Upload size={10} className="inline mr-1" /> Enqueue {plans.filter((p) => p.content.trim()).length} plan{plans.filter((p) => p.content.trim()).length !== 1 ? "s" : ""}
						</>
					)}
				</button>
			</div>
		</div>
	);
}

// ── PlanQueueTab ────────────────────────────────────────────────────────────

interface PlanQueueTabProps {
	/** Currently selected project ID */
	projectId: string | null;
}

/**
 * Plan Queue Tab — interactive management of queued plan executions.
 *
 * Features:
 * - View all queued entries with status indicators
 * - Drag-and-drop reordering of pending entries
 * - Move-to-top, move-up, move-down buttons
 * - Skip, remove, move-to-top controls per entry
 * - Queue-level controls: run-next, pause, resume, stop-after-current
 * - Multi-plan upload form
 * - Active/running plan cannot be moved
 */
export function PlanQueueTab({ projectId }: PlanQueueTabProps) {
	const {
		queue,
		isLoading,
		enqueue,
		isEnqueueing,
		reorder,
		skip,
		remove,
		moveToTop,
		runNext,
		pause,
		resume,
		stopAfterCurrent: stopAfterCurrentFn,
	} = usePlanQueue(projectId);

	// Drag-and-drop state
	const [dragEntryId, setDragEntryId] = useState<string | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

	const handleDragStart = useCallback(
		(_e: React.DragEvent, entryId: string) => {
			const entry = queue.entries.find((e) => e.entryId === entryId);
			if (!entry || entry.status !== "pending") return;
			setDragEntryId(entryId);
		},
		[queue.entries],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent, index: number) => {
			e.preventDefault();
			setDragOverIndex(index);
		},
		[],
	);

	const handleDragEnd = useCallback(() => {
		if (dragEntryId && dragOverIndex !== null) {
			// Reorder: extract pending IDs in their new order
			const pendingEntries = queue.entries.filter((e) => e.status === "pending");
			const dragOldIndex = pendingEntries.findIndex((e) => e.entryId === dragEntryId);
			if (dragOldIndex === -1 || dragOldIndex === dragOverIndex) {
				setDragEntryId(null);
				setDragOverIndex(null);
				return;
			}

			// Compute new pending order
			const reordered = [...pendingEntries];
			const [moved] = reordered.splice(dragOldIndex, 1);
			// Insert at the new position within pending entries
			const insertAt = Math.min(dragOverIndex, reordered.length);
			reordered.splice(insertAt, 0, moved);

			reorder(reordered.map((e) => e.entryId));
		}
		setDragEntryId(null);
		setDragOverIndex(null);
	}, [dragEntryId, dragOverIndex, queue.entries, reorder]);

	// Move up/down within pending entries
	const handleMoveUp = useCallback(
		(entryId: string) => {
			const pendingEntries = queue.entries.filter((e) => e.status === "pending");
			const idx = pendingEntries.findIndex((e) => e.entryId === entryId);
			if (idx <= 0) return;
			const reordered = [...pendingEntries];
			[reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
			reorder(reordered.map((e) => e.entryId));
		},
		[queue.entries, reorder],
	);

	const handleMoveDown = useCallback(
		(entryId: string) => {
			const pendingEntries = queue.entries.filter((e) => e.status === "pending");
			const idx = pendingEntries.findIndex((e) => e.entryId === entryId);
			if (idx < 0 || idx >= pendingEntries.length - 1) return;
			const reordered = [...pendingEntries];
			[reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
			reorder(reordered.map((e) => e.entryId));
		},
		[queue.entries, reorder],
	);

	const handleEnqueue = useCallback(
		(plans: Array<{ planContent: string; planFileName?: string }>) => {
			enqueue(plans);
		},
		[enqueue],
	);

	// ── render ────────────────────────────────────────────────────────────

	if (!projectId) {
		return (
			<div className={`flex flex-col items-center justify-center h-full gap-3 ${MUT} p-8`}>
				<Clock size={32} strokeWidth={1.2} />
				<p className="text-sm">Select a project to view its queue</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className={`flex items-center justify-center h-32 ${MUT}`}>
				<Loader2 size={16} className="animate-spin" /> Loading queue...
			</div>
		);
	}

	const { entries, isPaused, stopAfterCurrent: willStopAfterCurrent } = queue;
	const pendingEntries = entries.filter((e) => e.status === "pending");
	const activeEntry = entries.find((e) => e.status === "active");
	const terminalEntries = entries.filter(
		(e) => e.status === "complete" || e.status === "failed" || e.status === "skipped",
	);
	const blockedEntries = entries.filter((e) => e.status === "blocked");

	return (
		<div className="flex flex-col h-full">
			{/* Queue controls bar */}
			<div className={`shrink-0 flex items-center gap-1.5 px-3 py-2 border-b ${BORD} ${SURF}`}>
				<StatusBadge status={isPaused ? "paused" : activeEntry ? "running" : "pending"} />
				{willStopAfterCurrent && (
					<span className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">
						stop after current
					</span>
				)}
				<div className="flex-1" />
				<button
					onClick={() => runNext()}
					disabled={isPaused || !!activeEntry || pendingEntries.length === 0}
					title="Run next queued plan"
					className={`h-7 px-2 rounded text-[10px] font-medium inline-flex items-center gap-1 transition-colors
						bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800
						hover:bg-emerald-100 dark:hover:bg-emerald-950/50 disabled:opacity-40 disabled:cursor-not-allowed`}
				>
					<Play size={10} /> Run Next
				</button>
				<button
					onClick={() => pause()}
					disabled={isPaused || !activeEntry}
					title="Pause queue"
					className={`h-7 px-2 rounded text-[10px] font-medium inline-flex items-center gap-1 transition-colors
						bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800
						hover:bg-amber-100 dark:hover:bg-amber-950/50 disabled:opacity-40 disabled:cursor-not-allowed`}
				>
					<Pause size={10} /> Pause
				</button>
				<button
					onClick={() => resume()}
					disabled={!isPaused}
					title="Resume queue"
					className={`h-7 px-2 rounded text-[10px] font-medium inline-flex items-center gap-1 transition-colors
						bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800
						hover:bg-emerald-100 dark:hover:bg-emerald-950/50 disabled:opacity-40 disabled:cursor-not-allowed`}
				>
					<Play size={10} /> Resume
				</button>
				<button
					onClick={() => stopAfterCurrentFn()}
					disabled={willStopAfterCurrent || !activeEntry}
					title="Stop after current plan finishes"
					className={`h-7 px-2 rounded text-[10px] font-medium inline-flex items-center gap-1 transition-colors
						bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800
						hover:bg-orange-100 dark:hover:bg-orange-950/50 disabled:opacity-40 disabled:cursor-not-allowed`}
				>
					<Square size={10} /> Stop After
				</button>
			</div>

			{/* Scrollable content area */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* Multi-plan upload */}
				<div className={`p-3 border-b ${BORD}`}>
					<MultiPlanUpload onEnqueue={handleEnqueue} isEnqueueing={isEnqueueing} />
				</div>

				{/* Active entry */}
				{activeEntry && (
					<>
						<SectionHeader title="Active" />
						<QueueEntryRow
							entry={activeEntry}
							index={0}
							isFirst={true}
							isLast={pendingEntries.length === 0}
							isDragging={false}
							isDragOver={false}
							onDragStart={() => {}}
							onDragOver={() => {}}
							onDragEnd={() => {}}
							onSkip={() => {}}
							onRemove={() => {}}
							onMoveToTop={() => {}}
							onMoveUp={() => {}}
							onMoveDown={() => {}}
						/>
					</>
				)}

				{/* Blocked entries */}
				{blockedEntries.length > 0 && (
					<>
						<SectionHeader title="Blocked" />
						{blockedEntries.map((entry, i) => {
							const globalPendingIdx = activeEntry ? 1 + i : i;
							return (
								<QueueEntryRow
									key={entry.entryId}
									entry={entry}
									index={globalPendingIdx}
									isFirst={i === 0}
									isLast={i === blockedEntries.length - 1 && pendingEntries.length === 0}
									isDragging={false}
									isDragOver={false}
									onDragStart={() => {}}
									onDragOver={() => {}}
									onDragEnd={() => {}}
									onSkip={(id) => skip(id)}
									onRemove={(id) => remove(id)}
									onMoveToTop={() => {}}
									onMoveUp={() => {}}
									onMoveDown={() => {}}
								/>
							);
						})}
					</>
				)}

				{/* Pending entries */}
				{pendingEntries.length > 0 && (
					<>
						<SectionHeader title={`Pending (${pendingEntries.length})`} />
						{pendingEntries.map((entry, i) => {
							const globalIdx = (activeEntry ? 1 : 0) + blockedEntries.length + i;
							return (
								<QueueEntryRow
									key={entry.entryId}
									entry={entry}
									index={globalIdx}
									isFirst={i === 0}
									isLast={i === pendingEntries.length - 1}
									isDragging={dragEntryId === entry.entryId}
									isDragOver={dragOverIndex === i}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDragEnd={handleDragEnd}
									onSkip={(id) => skip(id)}
									onRemove={(id) => remove(id)}
									onMoveToTop={(id) => moveToTop(id)}
									onMoveUp={handleMoveUp}
									onMoveDown={handleMoveDown}
								/>
							);
						})}
					</>
				)}

				{/* Terminal entries */}
				{terminalEntries.length > 0 && (
					<>
						<Divider />
						<SectionHeader title={`History (${terminalEntries.length})`} />
						{terminalEntries.map((entry, i) => (
							<div
								key={entry.entryId}
								className={`flex items-center gap-2 px-3 py-2 border-b ${BORD} ${statusBg(entry.status)}`}
							>
								<span className={`text-[10px] font-semibold uppercase tracking-wider shrink-0 ${statusColor(entry.status)}`}>
									{entry.status === "complete" ? <CheckCircle2 size={10} className="inline mr-1" /> :
									 entry.status === "failed" ? <AlertCircle size={10} className="inline mr-1" /> :
									 <Ban size={10} className="inline mr-1" />}
									{entry.status}
								</span>
								<span className={`flex-1 min-w-0 text-xs font-medium truncate ${MUT}`}>
									{entry.title}
								</span>
								<span className={`text-[10px] ${MUT} shrink-0 tabular-nums`}>
									{formatTime(entry.completedAt)}
								</span>
							</div>
						))}
					</>
				)}

				{/* Empty state */}
				{entries.length === 0 && (
					<div className={`flex flex-col items-center justify-center py-12 gap-3 ${MUT}`}>
						<Clock size={28} strokeWidth={1.2} />
						<p className="text-xs">No plans in queue</p>
						<p className="text-[10px] max-w-[200px] text-center">
							Upload plans above to add them to the execution queue.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
