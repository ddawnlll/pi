/**
 * Sidebar — P22.A Project-Centric Sidebar & Navigation
 *
 * Replaces the old 4-tab system with a project-centric hierarchy:
 * - Project selector at top (current project name + dropdown to switch)
 * - Brain section (per-project brain navigation)
 * - Tasks section (per-project task list)
 * - Runs section (per-project run history)
 * - Platform items at bottom (settings gear)
 *
 * Each section is collapsible with a chevron indicator.
 */

import { useState, useCallback } from "react";
import {
	Activity,
	Archive,
	ChevronDown,
	ChevronRight,
	Cpu,
	Database,
	Eye,
	FileText,
	Filter,
	FolderOpen,
	History,
	Lightbulb,
	ListOrdered,
	Moon,
	Pencil,
	Plus,
	Puzzle,
	Settings,
	Shield,
	Target,
	Upload,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Project, PlanExecution, MultiPhaseTask } from "../../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarItem {
	id: string;
	label: string;
	icon?: LucideIcon;
	badge?: number;
	isActive?: boolean;
	onClick?: () => void;
}

export interface SidebarSection {
	id: string;
	title: string;
	type: "brain" | "tasks" | "runs" | "platform";
	items: SidebarItem[];
	isExpanded?: boolean;
	/** If true, items are dynamically populated (from API) rather than static */
	isDynamic?: boolean;
}

// ---------------------------------------------------------------------------
// Style tokens (matching App.tsx conventions)
// ---------------------------------------------------------------------------

const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const SURF = "bg-white dark:bg-[#1E1E1E]";

// ---------------------------------------------------------------------------
// Brain section data (static, per-project)
// ---------------------------------------------------------------------------

export const BRAIN_ITEMS: SidebarItem[] = [
	{ id: "brain_state", label: "State / Overview", icon: Activity },
	{ id: "brain_memory", label: "Memory Explorer", icon: Database },
	{ id: "brain_reflections", label: "Reflections", icon: Lightbulb },
	{ id: "brain_overnight", label: "Overnight", icon: Moon },
	{ id: "brain_goals", label: "Goals", icon: Target },
	{ id: "brain_trust", label: "Trust", icon: Eye },
];

// ---------------------------------------------------------------------------
// Platform items (shown at bottom)
// ---------------------------------------------------------------------------

export const PLATFORM_ITEMS: SidebarItem[] = [
	{ id: "autonomy", label: "Autonomy", icon: Cpu },
	{ id: "plan_intake", label: "Plan Intake", icon: Upload },
	{ id: "extensions_skills", label: "Extensions & Skills", icon: Puzzle },
	{ id: "proposal_inbox", label: "Proposals", icon: FileText },
	{ id: "registry_settings", label: "Registry Settings", icon: Shield },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActiveClass(isActive: boolean): string {
	return isActive
		? `${ACC_BG} ${ACC_TXT}`
		: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`;
}

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

export interface SidebarProps {
	/** Currently selected project, or null */
	project: Project | null;
	/** All available projects */
	projects: Project[];
	/** Currently selected view item ID */
	activeItem: string | null;
	/** Navigate to a sidebar item */
	onNavigate: (item: string) => void;
	/** Select a project */
	onSelectProject: (projectId: string) => void;
	/** Create a new project */
	onCreateProject: () => void;
	/** Delete a project */
	onDeleteProject: (projectId: string) => void;
	/** Rename a project */
	onRenameProject: (projectId: string, name: string) => void;
	/** Open settings dialog */
	onOpenSettings: () => void;
	/** Upload a plan */
	onUploadPlan: () => void;
	/** Whether brain is enabled for this project */
	brainEnabled: boolean;
	/** Toggle brain enabled */
	onToggleBrain: (enabled: boolean) => void;
	/** Executions for the current project (for Runs section) */
	executions?: PlanExecution[];
	/** Tasks for the current project (for Tasks section) */
	tasks?: MultiPhaseTask[];
	/** Loading state for executions */
	executionsLoading?: boolean;
	/** Loading state for tasks */
	tasksLoading?: boolean;
	/** Select an execution */
	onSelectExecution?: (execId: string) => void;
	/** Select a task */
	onSelectTask?: (taskId: string) => void;
	/** Create a new task */
	onCreateTask?: () => void;
	/** Default-expand sections */
	defaultExpanded?: Record<string, boolean>;
	/** Whether to include archived plans in the runs list (P22.E) */
	includeArchived?: boolean;
	/** Toggle archived plan visibility (P22.E) */
	onToggleArchived?: () => void;
}

export function Sidebar({
	project,
	projects,
	activeItem,
	onNavigate,
	onSelectProject,
	onCreateProject,
	onDeleteProject,
	onRenameProject,
	onOpenSettings,
	onUploadPlan,
	brainEnabled,
	onToggleBrain,
	executions = [],
	tasks = [],
	executionsLoading = false,
	tasksLoading = false,
	onSelectExecution,
	onSelectTask,
	onCreateTask,
	defaultExpanded,
	includeArchived = false,
	onToggleArchived,
}: SidebarProps) {
	// Track collapsed state per section
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
		brain: defaultExpanded?.brain ?? true,
		// P22.E: Rename/archive state
		renamingExecId: null as string | null,
		renameValue: "",
	}));

	// ── Plan rename/archive state (P22.E) ──
	const [renamingExecId, setRenamingExecId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
		tasks: defaultExpanded?.tasks ?? true,
		runs: defaultExpanded?.runs ?? true,
		platform: defaultExpanded?.platform ?? false,
	}));

	// Project dropdown state
	const [showProjectDropdown, setShowProjectDropdown] = useState(false);
	const [renamingProject, setRenamingProject] = useState(false);
	const [renameValue, setRenameValue] = useState("");
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

	const toggleSection = useCallback((sectionId: string) => {
		setExpanded((prev) => ({
			...prev,
			[sectionId]: !prev[sectionId],
		}));
	}, []);

	const Chevron = ({ sectionId }: { sectionId: string }) => {
		const isExpanded = expanded[sectionId] ?? true;
		const Icon = isExpanded ? ChevronDown : ChevronRight;
		return <Icon size={12} strokeWidth={2} className={`shrink-0 transition-transform duration-200 ${MUT}`} />;
	};

	const renderItem = useCallback(
		(item: SidebarItem) => {
			const Icon = item.icon;
			const isActive = activeItem === item.id;
			return (
				<button
					key={item.id}
					onClick={item.onClick ?? (() => onNavigate(item.id))}
					className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left w-full ${isActiveClass(isActive)}`}
				>
					{Icon && (
						<Icon
							size={15}
							strokeWidth={1.6}
							className={`shrink-0 ${isActive ? ACC_TXT : MUT}`}
						/>
					)}
					<div className="min-w-0 flex-1">
						<div
							className={`text-[12px] font-medium leading-tight ${
								isActive ? ACC_TXT : TXT
							}`}
						>
							{item.label}
							{item.badge != null && item.badge > 0 && (
								<span className="ml-2 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
									{item.badge}
								</span>
							)}
						</div>
					</div>
				</button>
			);
		},
		[activeItem, onNavigate],
	);

	// ── Project Selector ──

	const renderProjectSelector = () => (
		<div className="shrink-0 px-3 py-3 border-b border-[#E8E6E1] dark:border-[#333]">
			<div className="relative">
				<button
					onClick={() => setShowProjectDropdown(!showProjectDropdown)}
					className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors ${SURF} border ${BORD} hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}
				>
					<FolderOpen size={14} strokeWidth={1.6} className={TXT} />
					<span className={`flex-1 truncate text-left ${TXT}`}>
						{project ? project.name || project.id : "No project selected"}
					</span>
					<ChevronDown size={12} strokeWidth={2} className={MUT} />
				</button>

				{/* Dropdown */}
				{showProjectDropdown && (
					<>
						<div className="fixed inset-0 z-10" onClick={() => setShowProjectDropdown(false)} />
						<div className={`absolute left-0 right-0 top-full mt-1 z-20 ${SURF} border ${BORD} rounded-lg shadow-lg max-h-60 overflow-y-auto`}>
							{projects.length === 0 && (
								<div className={`px-3 py-2 text-xs ${MUT}`}>No projects yet</div>
							)}
							{projects.map((p) => (
								<div key={p.id} className="relative group">
									{confirmDelete === p.id ? (
										<div className={`px-3 py-2 flex items-center gap-2 text-xs ${MUT}`}>
											<span className="flex-1">Remove "{p.name || p.id}" from dashboard?</span>
											<button
												onClick={(e) => {
													e.stopPropagation();
													onDeleteProject(p.id);
													setConfirmDelete(null);
												}}
												className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium"
											>
												Remove
											</button>
											<button
												onClick={() => setConfirmDelete(null)}
												className="hover:text-stone-700 dark:hover:text-stone-300"
											>
												<X size={12} />
											</button>
										</div>
									) : (
										<button
											onClick={() => {
												onSelectProject(p.id);
												setShowProjectDropdown(false);
											}}
											className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors ${
												project?.id === p.id
													? `${ACC_BG} ${ACC_TXT}`
													: `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
											}`}
										>
											<FolderOpen size={12} strokeWidth={1.6} className="shrink-0" />
											<span className="flex-1 truncate">{p.name || p.id}</span>
											{/* Rename / Delete (only on hover, for non-active) */}
											<span className="hidden group-hover:flex items-center gap-1">
												<button
													onClick={(e) => {
														e.stopPropagation();
														setRenamingProject(true);
														setRenameValue(p.name || p.id);
														setShowProjectDropdown(false);
													}}
													className={`text-[10px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
													title="Rename"
												>
													✎
												</button>
												<button
													onClick={(e) => {
														e.stopPropagation();
														setConfirmDelete(p.id);
													}}
													className={`text-[10px] ${MUT} hover:text-red-600 dark:hover:text-red-400`}
													title="Remove from dashboard"
												>
													<X size={10} />
												</button>
											</span>
										</button>
									)}
								</div>
							))}
							<div className={`border-t ${BORD}`}>
								<button
									onClick={() => {
										setShowProjectDropdown(false);
										onCreateProject();
									}}
									className={`flex items-center gap-2 w-full px-3 py-2 text-xs ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
								>
									<Plus size={12} strokeWidth={2} />
									<span>New project...</span>
								</button>
							</div>
						</div>
					</>
				)}
			</div>

			{/* Rename inline form */}
			{renamingProject && project && (
				<div className="mt-2 flex items-center gap-1">
					<input
						autoFocus
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && renameValue.trim()) {
								onRenameProject(project.id, renameValue.trim());
								setRenamingProject(false);
							} else if (e.key === "Escape") {
								setRenamingProject(false);
							}
						}}
						className={`flex-1 px-2 py-1 text-xs rounded border ${BORD} bg-transparent ${TXT} outline-none focus:border-blue-500`}
						placeholder="Project name"
					/>
					<button
						onClick={() => setRenamingProject(false)}
						className={`text-[10px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
					>
						Cancel
					</button>
				</div>
			)}
		</div>
	);

	// ── Section renderer ──

	const renderSection = useCallback(
		(section: SidebarSection) => {
			const isExpanded = expanded[section.id] ?? true;

			return (
				<div key={section.id} className="mb-1">
					{/* Section header */}
					<button
						onClick={() => toggleSection(section.id)}
						className={`flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md transition-colors hover:bg-stone-100 dark:hover:bg-[#2A2A2A] ${
							section.type === "brain"
								? "text-sm font-medium text-blue-500 dark:text-blue-400"
								: "text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400"
						}`}
						aria-expanded={isExpanded}
					>
						{section.type === "brain" && (
							<span className="shrink-0 text-base" aria-hidden="true">
								🧠
							</span>
						)}
						<span className="flex-1 truncate">
							{section.type === "brain" && project
								? `${project.name || project.id} Brain`
								: section.title}
						</span>
						{section.type === "brain" && project && (
							<button
								onClick={(e) => {
									e.stopPropagation();
									onToggleBrain(!brainEnabled);
								}}
								className={`text-[10px] px-1.5 py-0.5 rounded ${
									brainEnabled
										? "text-emerald-600 dark:text-emerald-400"
										: MUT
								}`}
								title={brainEnabled ? "Disable brain" : "Enable brain"}
							>
								{brainEnabled ? "ON" : "OFF"}
							</button>
						)}
						<Chevron sectionId={section.id} />
					</button>

					{/* Items (collapsible) */}
					<div
						className={`overflow-hidden transition-all duration-200 ${
							isExpanded ? "max-h-[999px] opacity-100" : "max-h-0 opacity-0"
						}`}
					>
						<div className="flex flex-col gap-0.5 px-1 pt-0.5">
							{/* Dynamic sections: tasks, runs */}
							{section.id === "tasks" && (
								<>
									{/* Create task CTA */}
									<button
										onClick={onCreateTask}
										className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] w-full text-left`}
									>
										<Plus size={13} strokeWidth={2} />
										<span>Create task</span>
									</button>
									{/* Task list */}
									{tasksLoading ? (
										<div className={`px-3 py-2 text-xs ${MUT}`}>Loading...</div>
									) : tasks.length === 0 ? (
										<div className={`px-3 py-2 text-xs ${MUT}`}>No tasks yet</div>
									) : (
										tasks.map((t) => (
											<button
												key={t.id}
												onClick={() => onSelectTask?.(t.id)}
												className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left w-full ${
													activeItem === t.id
														? `${ACC_BG} ${ACC_TXT}`
														: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
												}`}
											>
												<ListOrdered size={13} strokeWidth={1.6} className="shrink-0" />
												<span className={`truncate ${activeItem === t.id ? ACC_TXT : TXT}`}>
													{t.title || `Task ${t.id.slice(0, 6)}`}
												</span>
												<span className={`text-[10px] ml-auto ${
													t.status === "complete"
														? "text-emerald-600 dark:text-emerald-400"
														: t.status === "running"
															? "text-blue-600 dark:text-blue-400"
															: MUT
												}`}>
													{t.status}
												</span>
											</button>
										))
									)}
								</>
							)}

							{section.id === "runs" && (
								<>
									{/* Upload plan CTA */}
									<button
										onClick={onUploadPlan}
										className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] w-full text-left`}
									>
										<Upload size={13} strokeWidth={2} />
										<span>Upload plan...</span>
									</button>

									{/* Archive toggle (P22.E) */}
									{onToggleArchived && (
										<button
											onClick={onToggleArchived}
											className={`flex items-center gap-2 px-3 py-1.5 rounded text-[10px] w-full text-left ${
												includeArchived
													? `${ACC_BG} ${ACC_TXT}`
													: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
											}`}
										>
											<Filter size={11} strokeWidth={1.5} />
											<span>{includeArchived ? "Showing all runs" : "Show archived runs"}</span>
										</button>
									)}

									{/* Execution list */}
									{executionsLoading ? (
										<div className={`px-3 py-2 text-xs ${MUT}`}>Loading...</div>
									) : executions.length === 0 ? (
										<div className={`px-3 py-2 text-xs ${MUT}`}>No runs yet</div>
									) : (
										executions.map((ex) => (
											<div key={ex.id} className="group relative">
												{renamingExecId === ex.id ? (
													<div className="flex items-center gap-1 px-2 py-1">
														<input
															autoFocus
															value={renameValue}
															onChange={(e) => setRenameValue(e.target.value)}
															onKeyDown={(e) => {
																if (e.key === "Enter" && renameValue.trim() && project) {
																	fetch(`/api/projects/${project.id}/plans/${ex.id}/rename`, {
																		method: "PATCH",
																		headers: { "Content-Type": "application/json" },
																		body: JSON.stringify({ title: renameValue.trim() }),
																	}).catch(() => {});
																	setRenamingExecId(null);
																} else if (e.key === "Escape") {
																	setRenamingExecId(null);
																}
															}}
															onBlur={() => setRenamingExecId(null)}
															className="flex-1 min-w-0 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
															placeholder="Rename plan..."
														/>
													</div>
												) : (
													<>
														<button
															onClick={() => onSelectExecution?.(ex.id)}
															className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left w-full pr-16 ${
																activeItem === ex.id
																	? `${ACC_BG} ${ACC_TXT}`
																	: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
															}`}
														>
															<History size={13} strokeWidth={1.6} className="shrink-0" />
															<span className={`flex-1 truncate ${activeItem === ex.id ? ACC_TXT : TXT}`}>
																{(ex as any).phaseTitle || ex.title || ex.phase || `Run ${ex.id.slice(0, 6)}`}
															</span>
															<span className={`text-[10px] ${
																ex.status === "complete"
																	? "text-emerald-600 dark:text-emerald-400"
																	: ex.status === "running"
																		? "text-blue-600 dark:text-blue-400"
																		: ex.status === "failed"
																			? "text-red-600 dark:text-red-400"
																			: MUT
															}`}>
																{ex.status}
															</span>
														</button>
														{/* Rename / Archive controls (P22.E) */}
														<span className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
															<button
																onClick={(e) => {
																	e.stopPropagation();
																	setRenamingExecId(ex.id);
																	setRenameValue(ex.title || "");
																}}
																className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
																title="Rename"
															>
																<Pencil size={10} />
															</button>
															<button
																onClick={(e) => {
																	e.stopPropagation();
																	if (project) {
																		fetch(`/api/projects/${project.id}/plans/${ex.id}/archive`, {
																			method: "PATCH",
																			headers: { "Content-Type": "application/json" },
																			body: JSON.stringify({ archived: !ex.archived }),
																		}).catch(() => {});
																	}
																}}
																className={`p-0.5 rounded ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
																title={ex.archived ? "Unarchive" : "Archive"}
															>
																<Archive size={10} />
															</button>
														</span>
													</>
												)}
											</div>
										))
									)}
								</>
							)}

							{/* Static sections: brain & platform */}
							{section.id !== "tasks" && section.id !== "runs" &&
								section.items.map((item) => 
									section.id === "brain" && !brainEnabled
										? null
										: renderItem(item)
								)
							}
						</div>
					</div>
				</div>
			);
		},
		[
			expanded,
			toggleSection,
			renderItem,
			project,
			brainEnabled,
			onToggleBrain,
			onCreateTask,
			onSelectTask,
			onUploadPlan,
			onSelectExecution,
			activeItem,
			tasks,
			tasksLoading,
			executions,
			executionsLoading,
			includeArchived,
			onToggleArchived,
			renamingExecId,
			renameValue,
			setRenamingExecId,
			setRenameValue,
		],
	);

	// ── Build sections ──

	const brainSection: SidebarSection = {
		id: "brain",
		title: "Brain",
		type: "brain",
		isExpanded: expanded.brain ?? true,
		items: brainEnabled ? BRAIN_ITEMS : [],
	};

	const tasksSection: SidebarSection = {
		id: "tasks",
		title: "Tasks",
		type: "tasks",
		isExpanded: expanded.tasks ?? true,
		items: [],
		isDynamic: true,
	};

	const runsSection: SidebarSection = {
		id: "runs",
		title: "Runs",
		type: "runs",
		isExpanded: expanded.runs ?? true,
		items: [],
		isDynamic: true,
	};

	const platformSection: SidebarSection = {
		id: "platform",
		title: "Platform",
		type: "platform",
		isExpanded: expanded.platform ?? false,
		items: PLATFORM_ITEMS,
	};

	return (
		<div className="flex flex-col h-full" role="navigation" aria-label="Sidebar navigation">
			{/* Project selector */}
			{renderProjectSelector()}

			{/* Scrollable section list */}
			<div className="flex-1 overflow-y-auto py-2 px-1">
				{/* If no project selected, show minimal state */}
				{!project ? (
					<div className={`flex flex-col items-center gap-3 px-4 py-8 text-center ${MUT}`}>
						<FolderOpen size={24} strokeWidth={1.2} />
						<p className="text-xs">Select or create a project</p>
						<button
							onClick={onCreateProject}
							className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium ${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors`}
						>
							<Plus size={13} strokeWidth={2} />
							Create project
						</button>
					</div>
				) : (
					<>
						{renderSection(brainSection)}
						<div className={`mx-3 my-1 border-t ${BORD}`} />
						{renderSection(tasksSection)}
						<div className={`mx-3 my-1 border-t ${BORD}`} />
						{renderSection(runsSection)}
						<div className={`mx-3 my-1 border-t ${BORD}`} />
						{renderSection(platformSection)}
					</>
				)}
			</div>

			{/* Bottom settings gear */}
			{project && (
				<div className={`shrink-0 border-t ${BORD} px-2 py-2`}>
					<button
						onClick={onOpenSettings}
						className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs transition-colors ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
					>
						<Settings size={14} strokeWidth={1.6} />
						<span>Project settings</span>
					</button>
				</div>
			)}
		</div>
	);
}
