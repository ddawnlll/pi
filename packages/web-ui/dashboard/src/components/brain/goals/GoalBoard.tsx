/**
 * GoalBoard — Main dashboard component for managing goals (P15.G).
 *
 * Displays a grid of goal cards with status/priority filters,
 * a drift alert badge, and the ability to add/edit/complete/delete goals.
 *
 * Data Flow:
 *   GoalBoard loads from GET /api/brain/goals
 *   -> Displays GoalCards in grid
 *   -> Each GoalCard shows priority badge, status, milestone progress
 *   -> Click card -> GoalDetail with full milestone list
 *   -> GoalForm via Add/Edit button
 *   -> DriftAlertBadge reads from GET /api/brain/goals/drift
 */

import { useCallback, useMemo, useState } from "react";
import { Plus, Loader2, AlertCircle, RefreshCw, Target } from "lucide-react";
import {
	useGoals,
	useDriftReports,
	useCreateGoal,
	useUpdateGoal,
	useCompleteGoal,
	useDeleteGoal,
	type GoalRecord,
	type GoalStatus,
	type GoalPriority,
	type Milestone,
} from "../../../hooks/useGoals";
import { GoalCard } from "./GoalCard";
import { GoalDetail } from "./GoalDetail";
import { GoalForm, type GoalFormValues } from "./GoalForm";
import { StatusFilterBar, PriorityFilterBar, type StatusFilterValue, type PriorityFilterValue } from "./GoalFilters";
import { DriftAlertBadge } from "./DriftAlertBadge";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Form mode
// ---------------------------------------------------------------------------

type FormMode = "closed" | "create" | { type: "edit"; goal: GoalRecord };

function isFormClosed(mode: FormMode): mode is "closed" {
	return mode === "closed";
}

function isFormCreate(mode: FormMode): mode is "create" {
	return mode === "create";
}

function isFormEdit(mode: FormMode): mode is { type: "edit"; goal: GoalRecord } {
	return typeof mode === "object" && mode.type === "edit";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GoalBoardProps {
	className?: string;
}

/**
 * GoalBoard — Full goal management dashboard with card grid, filters,
 * drift alerts, and CRUD via forms and detail panels.
 */
export function GoalBoard({ className = "" }: GoalBoardProps) {
	const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
	const [priorityFilter, setPriorityFilter] = useState<PriorityFilterValue>("all");
	const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
	const [formMode, setFormMode] = useState<FormMode>("closed");
	const [showDriftPanel, setShowDriftPanel] = useState(false);

	// ── Data ────────────────────────────────────────────────────────────────
	const goalsQueryFilters = useMemo(() => {
		const filters: { status?: GoalStatus; priority?: GoalPriority } = {};
		if (statusFilter !== "all") filters.status = statusFilter as GoalStatus;
		if (priorityFilter !== "all") filters.priority = priorityFilter as GoalPriority;
		return filters;
	}, [statusFilter, priorityFilter]);

	const { data: goals = [], isLoading: goalsLoading, error: goalsError, refetch: refetchGoals } = useGoals(goalsQueryFilters);
	const { data: driftReports = [], isLoading: driftLoading } = useDriftReports();

	const createGoalMutation = useCreateGoal();
	const updateGoalMutation = useUpdateGoal();
	const completeGoalMutation = useCompleteGoal();
	const deleteGoalMutation = useDeleteGoal();

	const isMutating =
		createGoalMutation.isPending ||
		updateGoalMutation.isPending ||
		completeGoalMutation.isPending ||
		deleteGoalMutation.isPending;

	// Selected goal from local list
	const selectedGoal = useMemo(
		() => (selectedGoalId ? goals.find((g) => g.id === selectedGoalId) ?? null : null),
		[goals, selectedGoalId],
	);

	// ── Filter counts ──────────────────────────────────────────────────────
	const filterCounts = useMemo(() => {
		const statusCounts: Record<string, number> = {};
		const priorityCounts: Record<string, number> = {};
		for (const g of goals) {
			statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
			priorityCounts[g.priority] = (priorityCounts[g.priority] ?? 0) + 1;
		}
		return { statusCounts, priorityCounts };
	}, [goals]);

	// ── Event handlers ─────────────────────────────────────────────────────
	const handleGoalClick = useCallback((id: string) => {
		setSelectedGoalId(id);
		setFormMode("closed");
	}, []);

	const handleCloseDetail = useCallback(() => {
		setSelectedGoalId(null);
	}, []);

	const handleEditGoal = useCallback((goal: GoalRecord) => {
		setFormMode({ type: "edit", goal });
		setSelectedGoalId(null);
	}, []);

	const handleFormSubmit = useCallback(
		(values: GoalFormValues) => {
			if (isFormCreate(formMode)) {
				createGoalMutation.mutate(
					{
						title: values.title,
						description: values.description,
						priority: values.priority,
						category: values.category || undefined,
						targetDate: values.targetDate || undefined,
						milestones: values.milestones
							.filter((m: { title: string }) => m.title.trim())
							.map((m: { title: string; description: string; completed: boolean; order: number }) => ({
								title: m.title,
								description: m.description || undefined,
								completed: m.completed,
								order: m.order,
							})),
					},
					{ onSuccess: () => setFormMode("closed") },
				);
			} else if (isFormEdit(formMode)) {
				const editGoal = formMode.goal;
				updateGoalMutation.mutate(
					{
						id: editGoal.id,
						input: {
							title: values.title,
							description: values.description,
							priority: values.priority,
							status: values.status,
							category: values.category || undefined,
							targetDate: values.targetDate || undefined,
							milestones: values.milestones
								.filter((m: { title: string }) => m.title.trim())
								.map((m: { id: string; title: string; description: string; completed: boolean; order: number }) => ({
									id: m.id,
									title: m.title,
									description: m.description || undefined,
									completed: m.completed,
									createdAt: editGoal.milestones.find((om: Milestone) => om.id === m.id)?.createdAt ?? new Date().toISOString(),
									order: m.order,
								})),
						},
					},
					{ onSuccess: () => setFormMode("closed") },
				);
			}
		},
		[formMode, createGoalMutation, updateGoalMutation],
	);

	const handleCompleteGoal = useCallback(
		(id: string) => {
			completeGoalMutation.mutate(id, {
				onSuccess: () => setSelectedGoalId(null),
			});
		},
		[completeGoalMutation],
	);

	const handleDeleteGoal = useCallback(
		(id: string) => {
			deleteGoalMutation.mutate(id, {
				onSuccess: () => setSelectedGoalId(null),
			});
		},
		[deleteGoalMutation],
	);

	// ── Drift reports ──────────────────────────────────────────────────────
	const openDriftReports = useMemo(
		() => driftReports.filter((r) => !r.resolvedAt),
		[driftReports],
	);

	// ══════════════════════════════════════════════════════════════════════
	// RENDER
	// ══════════════════════════════════════════════════════════════════════

	// If a form is open, show it
	if (!isFormClosed(formMode)) {
		const existingGoal = isFormEdit(formMode) ? formMode.goal : undefined;
		return (
			<div className={`flex h-full overflow-hidden ${BG} ${className}`}>
				<GoalForm
					goal={existingGoal}
					onSubmit={handleFormSubmit}
					onCancel={() => setFormMode("closed")}
					isSubmitting={isMutating}
					error={
						createGoalMutation.error
							? String(createGoalMutation.error)
							: updateGoalMutation.error
								? String(updateGoalMutation.error)
								: null
					}
					className="flex-1"
				/>
			</div>
		);
	}

	// Main board: goal list + optional detail panel
	return (
		<div className={`flex h-full overflow-hidden ${BG} ${className}`}>
			{/* Left: Goal list */}
			<div className="flex-1 flex flex-col overflow-hidden">
				{/* Header strip */}
				<div className={`shrink-0 flex items-center gap-3 px-4 py-3 border-b ${BORD} ${SURF}`}>
					<Target size={18} className={ACC_TXT} />
					<h1 className={`text-sm font-bold ${TXT}`}>Goal Board</h1>

					{/* Drift badge */}
					{!driftLoading && (
						<DriftAlertBadge
							reports={driftReports}
							onClick={() => setShowDriftPanel(!showDriftPanel)}
						/>
					)}

					<div className="flex-1" />

					{/* Add goal button */}
					<button
						onClick={() => setFormMode("create")}
						className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-[10px] font-semibold transition-colors ${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1A3A5A]`}
					>
						<Plus size={13} />
						Add Goal
					</button>

					<button
						onClick={() => refetchGoals()}
						className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
						title="Refresh goals"
					>
						<RefreshCw size={13} />
					</button>
				</div>

				{/* Filters */}
				<div className={`shrink-0 border-b ${BORD} ${SURF} px-3 py-2 space-y-2`}>
					<StatusFilterBar
						value={statusFilter}
						onChange={(v) => { setStatusFilter(v); setSelectedGoalId(null); }}
						counts={filterCounts.statusCounts}
					/>
					<PriorityFilterBar
						value={priorityFilter}
						onChange={(v) => { setPriorityFilter(v); setSelectedGoalId(null); }}
						counts={filterCounts.priorityCounts}
					/>
				</div>

				{/* Goal grid */}
				<div className="flex-1 overflow-y-auto p-3">
					{/* Loading state */}
					{goalsLoading && (
						<div className={`flex items-center justify-center py-12 gap-2 ${MUT}`}>
							<Loader2 size={16} className="animate-spin" />
							<span className="text-xs">Loading goals...</span>
						</div>
					)}

					{/* Error state */}
					{goalsError && !goalsLoading && (
						<div className={`flex flex-col items-center justify-center py-12 gap-3 ${MUT}`}>
							<AlertCircle size={24} className="text-red-400" />
							<p className="text-xs text-red-500">Failed to load goals</p>
							<p className="text-[10px]">{String(goalsError)}</p>
							<button
								onClick={() => refetchGoals()}
								className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
							>
								<RefreshCw size={11} /> Retry
							</button>
						</div>
					)}

					{/* Empty state */}
					{!goalsLoading && !goalsError && goals.length === 0 && (
						<div className={`flex flex-col items-center justify-center py-16 gap-3 ${MUT}`}>
							<Target size={40} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
							<p className="text-sm">No goals yet</p>
							<p className="text-xs max-w-xs text-center">
								Goals help Pi understand what you are optimizing for.
								Create your first goal to get started.
							</p>
							<button
								onClick={() => setFormMode("create")}
								className={`flex items-center gap-1.5 h-8 px-4 rounded-lg text-[11px] font-semibold transition-colors ${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1A3A5A]`}
							>
								<Plus size={13} /> Create Goal
							</button>
						</div>
					)}

					{/* Goal cards grid */}
					{!goalsLoading && !goalsError && goals.length > 0 && (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
							{goals.map((goal) => (
								<GoalCard
									key={goal.id}
									goal={goal}
									selected={goal.id === selectedGoalId}
									onClick={() => handleGoalClick(goal.id)}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Right: Goal detail panel */}
			{selectedGoal && (
				<div className={`w-96 shrink-0 border-l ${BORD} overflow-hidden`}>
					<GoalDetail
						goal={selectedGoal}
						onClose={handleCloseDetail}
						onEdit={handleEditGoal}
						onComplete={handleCompleteGoal}
						onDelete={handleDeleteGoal}
						isCompleting={completeGoalMutation.isPending}
						isDeleting={deleteGoalMutation.isPending}
						className="h-full"
					/>
				</div>
			)}

			{/* Right: Drift panel */}
			{showDriftPanel && !selectedGoal && (
				<div className={`w-96 shrink-0 border-l ${BORD} ${SURF} flex flex-col overflow-hidden`}>
					<div className={`shrink-0 flex items-center gap-2 px-4 py-3 border-b ${BORD}`}>
						<h2 className={`text-sm font-bold ${TXT}`}>Drift Alerts</h2>
						<div className="flex-1" />
						<button
							onClick={() => setShowDriftPanel(false)}
							className={`flex items-center justify-center h-7 w-7 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
						>
							<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
								<path d="M3 3L11 11M11 3L3 11" />
							</svg>
						</button>
					</div>

					<div className="flex-1 overflow-y-auto p-3 space-y-2">
						{driftLoading && (
							<div className={`flex items-center justify-center py-8 gap-2 ${MUT}`}>
								<Loader2 size={14} className="animate-spin" />
								<span className="text-xs">Loading drift reports...</span>
							</div>
						)}

						{!driftLoading && openDriftReports.length === 0 && (
							<div className={`flex flex-col items-center justify-center py-12 ${MUT}`}>
								<p className="text-sm">No drift alerts</p>
								<p className="text-[10px] mt-1">All goals are aligned with current activity.</p>
							</div>
						)}

						{!driftLoading && openDriftReports.map((report) => {
							const severityColors: Record<string, string> = {
								high: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300",
								medium: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300",
								low: "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300",
							};

							const severityDots: Record<string, string> = {
								high: "bg-red-500",
								medium: "bg-amber-400",
								low: "bg-yellow-400",
							};

							return (
								<div
									key={report.id}
									className={`p-3 rounded-lg border ${severityColors[report.severity] ?? severityColors.low}`}
								>
									<div className="flex items-center gap-2 mb-1.5">
										<span className={`w-2 h-2 rounded-full ${severityDots[report.severity] ?? severityDots.low}`} />
										<p className="text-[11px] font-semibold">{report.goalTitle}</p>
										<span className="text-[9px] font-medium uppercase ml-auto">{report.severity}</span>
									</div>
									{report.indicators.map((ind, i) => (
										<p key={i} className="text-[10px] leading-relaxed mt-0.5 opacity-80">
											{ind.details}
										</p>
									))}
									<p className="text-[9px] mt-1 opacity-60">
										{new Date(report.generatedAt).toLocaleString()}
									</p>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
