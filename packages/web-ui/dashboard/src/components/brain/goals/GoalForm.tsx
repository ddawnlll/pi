/**
 * GoalForm — Add/Edit goal form for the Goal Board.
 *
 * Supports both creating and editing goals with fields for title,
 * description, priority, category, target date, and milestones.
 */

import { useState, useCallback, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { GoalCreateInput, GoalRecord, GoalPriority, GoalStatus, Milestone } from "../../../hooks/useGoals";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const INPUT = "bg-white dark:bg-[#252525] border-[#E8E6E1] dark:border-[#444] rounded-lg px-3 py-2 text-[12px]";

// ---------------------------------------------------------------------------
// Priority + Status options
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS: { value: GoalPriority; label: string }[] = [
	{ value: "critical", label: "Critical" },
	{ value: "high", label: "High" },
	{ value: "normal", label: "Normal" },
	{ value: "low", label: "Low" },
];

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "paused", label: "Paused" },
	{ value: "completed", label: "Completed" },
	{ value: "cancelled", label: "Cancelled" },
	{ value: "needs_review", label: "Needs Review" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTempId(): string {
	return `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GoalFormValues {
	title: string;
	description: string;
	priority: GoalPriority;
	status: GoalStatus;
	category: string;
	targetDate: string;
	milestones: Array<{
		id: string;
		title: string;
		description: string;
		completed: boolean;
		order: number;
	}>;
}

interface GoalFormProps {
	/** Existing goal to edit (null/undefined = create mode) */
	goal?: GoalRecord | null;
	/** Called with form values on submit */
	onSubmit: (values: GoalFormValues) => void;
	/** Called when the form is dismissed */
	onCancel: () => void;
	/** Whether the form is submitting */
	isSubmitting?: boolean;
	/** Error message to display */
	error?: string | null;
	className?: string;
}

/**
 * GoalForm — Modal/slide-over form for creating or editing a goal.
 */
export function GoalForm({ goal, onSubmit, onCancel, isSubmitting = false, error, className = "" }: GoalFormProps) {
	const isEditing = !!goal;
	const todayStr = new Date().toISOString().slice(0, 10);

	const [title, setTitle] = useState(goal?.title ?? "");
	const [description, setDescription] = useState(goal?.description ?? "");
	const [priority, setPriority] = useState<GoalPriority>(goal?.priority ?? "normal");
	const [status, setStatus] = useState<GoalStatus>(goal?.status ?? "active");
	const [category, setCategory] = useState(goal?.category ?? "");
	const [targetDate, setTargetDate] = useState(goal?.targetDate?.slice(0, 10) ?? "");
	const [milestones, setMilestones] = useState(
		(goal?.milestones ?? []).map((m) => ({
			id: m.id,
			title: m.title,
			description: m.description ?? "",
			completed: m.completed,
			order: m.order,
		})),
	);

	const [titleError, setTitleError] = useState(false);

	const addMilestone = useCallback(() => {
		setMilestones((prev) => [
			...prev,
			{ id: generateTempId(), title: "", description: "", completed: false, order: prev.length },
		]);
	}, []);

	const removeMilestone = useCallback((id: string) => {
		setMilestones((prev) =>
			prev
				.filter((m) => m.id !== id)
				.map((m, i) => ({ ...m, order: i })),
		);
	}, []);

	const updateMilestone = useCallback((id: string, field: string, value: string | boolean) => {
		setMilestones((prev) =>
			prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
		);
	}, []);

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!title.trim()) {
			setTitleError(true);
			return;
		}
		setTitleError(false);

		onSubmit({
			title: title.trim(),
			description: description.trim(),
			priority,
			status,
			category: category.trim(),
			targetDate,
			milestones: milestones
				.filter((m) => m.title.trim())
				.map((m, i) => ({ ...m, order: i })),
		});
	};

	return (
		<div className={`flex flex-col overflow-hidden ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center gap-3 px-4 py-3 border-b ${BORD} ${SURF}`}>
				<h2 className={`text-sm font-bold ${TXT}`}>
					{isEditing ? "Edit Goal" : "New Goal"}
				</h2>
				<div className="flex-1" />
				<button
					onClick={onCancel}
					className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
				>
					<X size={14} />
				</button>
			</div>

			{/* Form body */}
			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				<form id="goal-form" onSubmit={handleSubmit} className="space-y-4">
					{/* Title */}
					<div>
						<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
							Title <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							value={title}
							onChange={(e) => { setTitle(e.target.value); setTitleError(false); }}
							placeholder="What do you want to achieve?"
							className={`w-full ${INPUT} ${TXT} ${titleError ? "border-red-400 dark:border-red-500" : ""}`}
							autoFocus
						/>
						{titleError && (
							<p className="text-[10px] text-red-500 mt-1">Title is required.</p>
						)}
					</div>

					{/* Description */}
					<div>
						<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
							Description
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Describe the goal in more detail..."
							rows={3}
							className={`w-full ${INPUT} ${TXT} resize-none`}
						/>
					</div>

					{/* Priority + Status row */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
								Priority
							</label>
							<select
								value={priority}
								onChange={(e) => setPriority(e.target.value as GoalPriority)}
								className={`w-full ${INPUT} ${TXT}`}
							>
								{PRIORITY_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>{opt.label}</option>
								))}
							</select>
						</div>
						<div>
							<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
								Status
							</label>
							<select
								value={status}
								onChange={(e) => setStatus(e.target.value as GoalStatus)}
								className={`w-full ${INPUT} ${TXT}`}
							>
								{STATUS_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>{opt.label}</option>
								))}
							</select>
						</div>
					</div>

					{/* Category + Target Date row */}
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
								Category
							</label>
							<input
								type="text"
								value={category}
								onChange={(e) => setCategory(e.target.value)}
								placeholder="e.g. project, learning"
								className={`w-full ${INPUT} ${TXT}`}
							/>
						</div>
						<div>
							<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
								Target Date
							</label>
							<input
								type="date"
								value={targetDate}
								onChange={(e) => setTargetDate(e.target.value)}
								min={todayStr}
								className={`w-full ${INPUT} ${TXT}`}
							/>
						</div>
					</div>

					{/* Milestones */}
					<div>
						<div className="flex items-center gap-2 mb-2">
							<label className={`block text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>
								Milestones
							</label>
							<button
								type="button"
								onClick={addMilestone}
								className={`flex items-center gap-1 text-[10px] font-medium ${ACC_TXT} hover:opacity-80`}
							>
								<Plus size={11} /> Add milestone
							</button>
						</div>

						{milestones.length === 0 && (
							<p className={`text-[10px] italic ${MUT} py-1`}>
								No milestones yet. Add checkpoints to track progress.
							</p>
						)}

						<div className="space-y-2">
							{milestones.map((m, idx) => (
								<div key={m.id} className={`flex items-start gap-2 p-2 rounded-lg border ${BORD} ${BG}`}>
									<span className={`mt-2 shrink-0 text-[9px] font-mono font-bold ${MUT} w-4 text-center`}>
										{idx + 1}
									</span>
									<div className="flex-1 min-w-0 space-y-1.5">
										<input
											type="text"
											value={m.title}
											onChange={(e) => updateMilestone(m.id, "title", e.target.value)}
											placeholder="Milestone title"
											className={`w-full ${INPUT} ${TXT} text-[11px]`}
										/>
										<input
											type="text"
											value={m.description}
											onChange={(e) => updateMilestone(m.id, "description", e.target.value)}
											placeholder="Optional description"
											className={`w-full ${INPUT} ${TXT} text-[10px]`}
										/>
										<label className="flex items-center gap-1.5 cursor-pointer">
											<input
												type="checkbox"
												checked={m.completed}
												onChange={(e) => updateMilestone(m.id, "completed", e.target.checked)}
												className="w-3 h-3 rounded border-stone-300 dark:border-stone-600"
											/>
											<span className={`text-[10px] ${MUT}`}>Completed</span>
										</label>
									</div>
									<button
										type="button"
										onClick={() => removeMilestone(m.id)}
										className={`shrink-0 mt-1.5 p-1 rounded ${MUT} hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20`}
									>
										<Trash2 size={11} />
									</button>
								</div>
							))}
						</div>
					</div>
				</form>
			</div>

			{/* Footer: actions */}
			<div className={`shrink-0 border-t ${BORD} ${SURF} p-3 flex items-center gap-2`}>
				{error && (
					<p className={`text-[10px] text-red-500 flex-1`}>{error}</p>
				)}
				<div className="flex-1" />
				<button
					onClick={onCancel}
					className="h-8 px-3 rounded-lg text-[10px] font-medium text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors"
					disabled={isSubmitting}
				>
					Cancel
				</button>
				<button
					type="submit"
					form="goal-form"
					disabled={isSubmitting || !title.trim()}
					className={`h-8 px-4 rounded-lg text-[10px] font-semibold transition-colors ${
						isSubmitting
							? `${ACC_BG} ${ACC_TXT} opacity-60 cursor-not-allowed`
							: `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1A3A5A]`
					}`}
				>
					{isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Goal"}
				</button>
			</div>
		</div>
	);
}
