import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DrawerProvider } from "./components/drawers/DrawerContext";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

// ─── Stores ───────────────────────────────────────────────────────────────
import { useSelectionStore } from "./stores/selectionStore";
import { useUIStore } from "./stores/uiStore";

// ─── API ──────────────────────────────────────────────────────────────────
import { sendControlCommand, sendRerunCommand } from "./api/control";

// ─── Navigation ───────────────────────────────────────────────────────────
import { NavigationProvider, useNavigation, DEFAULT_ROUTE } from "./navigation/NavigationState";
import { buildRunBreadcrumbs } from "./navigation/BreadcrumbModel";
import type { NavigationRoute } from "./navigation/NavigationState";
import type { TopbarV3BrainMode } from "./components/topbar/TopbarV3";

// ─── Hooks ────────────────────────────────────────────────────────────────
import { useTheme } from "./hooks/useTheme";
import { useProjects } from "./hooks/useProjects";
import { usePlanExecutions, usePlanExecutionDetail } from "./hooks/usePlanExecutions";
import { usePlanEvents } from "./hooks/usePlanEvents";
import { useUnreadCount } from "./hooks/useUnreadCount";

// ─── Shell ────────────────────────────────────────────────────────────────
import { AppShell } from "./components/shell/AppShell";
import { TopbarV3 } from "./components/topbar/TopbarV3";
import { TaskRunSidebar } from "./components/sidebar/TaskRunSidebar";
import { RightSidebar } from "./components/right-sidebar";
import type { AlertEntry } from "./components/right-sidebar";

// ─── Overlays ─────────────────────────────────────────────────────────────
import { ChatPanel } from "./components/ChatPanel";
import { BrainContextPanel } from "./components/BrainContextPanel";
import { ArtifactBrowser } from "./components/ArtifactBrowser";

// ─── Dialogs ──────────────────────────────────────────────────────────────
import { OpenProjectDialog } from "./components/OpenProjectDialog";
import { PlanUploadDialog } from "./components/PlanUploadDialog";
import { TaskCreationStudio } from "./components/TaskCreationStudio";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExecutionLogViewer } from "./components/ExecutionLogViewer";
import { RerunDialog } from "./components/RerunDialog";
import { ForceKillDialog } from "./components/ForceKillDialog";

// ─── Route components ─────────────────────────────────────────────────────
import { RunRoute } from "./routes/RunRoute";
import { PlatformRoute } from "./routes/PlatformRoute";
import { TaskRoute } from "./routes/TaskRoute";
import { WorkspaceDetailRoute } from "./routes/WorkspaceDetailRoute";
import { EmptyRoute } from "./routes/EmptyRoute";
import { LegacyRoute } from "./routes/LegacyRoute";

// ─── Tokens ───────────────────────────────────────────────────────────────
import { BG, SURF, BORD } from "./tokens";

// ─── Types ────────────────────────────────────────────────────────────────
import type { ContextRef } from "./components/ChatPanel";
import type { MultiPhaseTask } from "./types";

// ─── localStorage helpers for navigation ──────────────────────────────────

const SELECTED_VIEW_KEY = "pi_selected_view";

function saveSelectedView(view: NavigationRoute): void {
	try { localStorage.setItem(SELECTED_VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ }
}

// ─── App shell wiring ─────────────────────────────────────────────────────

function AppShellWiring() {
	const queryClient = useQueryClient();
	const { theme, setTheme } = useTheme();
	const nav = useNavigation();
	const { route } = nav;

	// Selection store
	const {
		selectedProjectId, selectedPlanExecId, selectedTaskId,
		setProjectId, setPlanExecId, setTaskId, setWorkerId,
	} = useSelectionStore();

	// UI store
	const ui = useUIStore();

	// Data fetching
	const { projects, isLoading: projectsLoading, createProject } = useProjects();
	const hasProjects = projects.length > 0;
	const [includeArchivedPlans, setIncludeArchivedPlans] = useState(false);
	const { data: executions = [], isLoading: executionsLoading } = usePlanExecutions(selectedProjectId, includeArchivedPlans);
	const { data: executionDetail } = usePlanExecutionDetail(selectedProjectId, selectedPlanExecId);
	const { events: planEvents } = usePlanEvents({
		projectId: selectedProjectId,
		planExecId: selectedPlanExecId,
	});
	const { observations, proposals, approvals } = useUnreadCount();

	// Brain mode
	const [brainMode, setBrainMode] = useState<TopbarV3BrainMode>("READ_ONLY");
	const cycleBrainMode = useCallback(() => {
		setBrainMode((prev) => {
			const modes: TopbarV3BrainMode[] = ["OFF", "READ_ONLY", "ADVISORY", "DRAFTING", "OPERATOR_READY"];
			return modes[(modes.indexOf(prev) + 1) % modes.length];
		});
	}, []);

	// Project tasks
	const [projectTasks, setProjectTasks] = useState<MultiPhaseTask[]>([]);
	const [tasksLoading, setTasksLoading] = useState(false);

	useEffect(() => {
		if (!selectedProjectId) { setProjectTasks([]); return; }
		let cancelled = false;
		setTasksLoading(true);
		fetch(`/api/projects/${encodeURIComponent(selectedProjectId)}/tasks`)
			.then((r) => r.json())
			.then((data) => { if (!cancelled) { setProjectTasks(data.tasks ?? []); setTasksLoading(false); } })
			.catch(() => { if (!cancelled) { setProjectTasks([]); setTasksLoading(false); } });
		return () => { cancelled = true; };
	}, [selectedProjectId]);

	// Auto-select first execution when executions load
	useEffect(() => {
		if (executions.length === 0) return;
		if (route.type !== "empty") return;
		if (selectedPlanExecId && executions.find((e) => e.id === selectedPlanExecId)) {
			nav.navigateToRun(selectedPlanExecId);
			return;
		}
		const running = executions.find((e) => e.status === "running");
		setPlanExecId(running?.id ?? executions[0].id);
		nav.navigateToRun(running?.id ?? executions[0].id);
	}, [executions, selectedPlanExecId, route.type, nav, setPlanExecId]);

	// Auto-select first project on startup
	useEffect(() => {
		if (!selectedProjectId && projects.length > 0) {
			const saved = localStorage.getItem("pi_selected_project_id");
			const target = saved && projects.find((p) => p.id === saved) ? saved : projects[0].id;
			setProjectId(target);
		}
	}, [projects, selectedProjectId, setProjectId]);

	// Persist navigation
	useEffect(() => { saveSelectedView(route); }, [route]);

	// Error banner auto-clear
	const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const showError = useCallback((msg: string) => {
		ui.setErrorBanner(msg);
		if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
		errorTimerRef.current = setTimeout(() => ui.setErrorBanner(null), 5000);
	}, [ui]);
	useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

	// Legacy mode
	const isLegacyMode = !hasProjects && !selectedProjectId;

	// Active plan status
	const activePlanStatus = isLegacyMode
		? (executionDetail?.status ?? "unknown")
		: (executionDetail?.status ?? "unknown");

	const canResume = activePlanStatus === "paused";
	const canPause = activePlanStatus === "running";
	const canStop = activePlanStatus === "running" || activePlanStatus === "paused";
	const canRerun = activePlanStatus === "failed" || activePlanStatus === "stopped" || activePlanStatus === "cancelled";
	const controlDisabled = !selectedPlanExecId || ui.controlActionInFlight;
	const canForceKill = activePlanStatus === "running" || activePlanStatus === "paused";

	// Control handlers
	const handleControl = useCallback(async (action: "pause" | "stop" | "cancel" | "resume") => {
		if (ui.controlActionInFlight || !selectedPlanExecId) return;
		ui.setControlActionInFlight(true);
		try {
			const res = await sendControlCommand(action, selectedPlanExecId);
			if (!res.success) showError(res.error || `Failed to ${action}`);
			queryClient.invalidateQueries({ queryKey: ["plan-execution-detail", selectedProjectId, selectedPlanExecId] });
			queryClient.invalidateQueries({ queryKey: ["plan-stats", selectedProjectId, selectedPlanExecId] });
			queryClient.invalidateQueries({ queryKey: ["plan-executions", selectedProjectId] });
		} finally {
			ui.setControlActionInFlight(false);
		}
	}, [ui, selectedPlanExecId, selectedProjectId, queryClient, showError]);

	const handleRerun = useCallback(async () => {
		if (!selectedProjectId || !selectedPlanExecId) return;
		ui.setRerunning(true);
		try {
			const res = await sendRerunCommand(selectedProjectId, selectedPlanExecId);
			if (!res.success) {
				showError(res.error || "Failed to rerun plan");
			} else if (res.planExecutionId) {
				setPlanExecId(res.planExecutionId);
				queryClient.invalidateQueries({ queryKey: ["plan-executions", selectedProjectId] });
			}
		} finally {
			ui.setRerunning(false);
			ui.setShowRerunDialog(false);
		}
	}, [selectedProjectId, selectedPlanExecId, showError, queryClient, setPlanExecId, ui]);

	const handleForceKill = useCallback(async () => {
		if (!selectedPlanExecId) return;
		ui.setShowForceKillConfirm(false);
		const res = await sendControlCommand("force-kill", selectedPlanExecId);
		if (!res.success) showError(res.error || "Failed to force kill workers");
	}, [selectedPlanExecId, showError, ui]);

	// Sidebar navigation
	const handleSidebarNavigate = useCallback((item: string) => {
		if (item.startsWith("brain_") || ["autonomy", "plan_intake", "extensions_skills", "registry_settings", "observability", "policy_audit", "pi_inbox"].includes(item)) {
			nav.navigateToPlatform(item);
		}
		ui.setMobileNav(null);
	}, [nav, ui]);

	const handleSelectExecution = useCallback((execId: string) => {
		setPlanExecId(execId);
		nav.navigateToRun(execId);
		ui.setMobileNav(null);
	}, [setPlanExecId, nav, ui]);

	const handleSelectTask = useCallback((taskId: string) => {
		setTaskId(taskId);
		nav.navigateToTask(taskId);
		ui.setMobileNav(null);
		fetch(`/api/projects/${encodeURIComponent(selectedProjectId ?? "")}/tasks/${encodeURIComponent(taskId)}`)
			.then((r) => r.json())
			.then(() => {})
			.catch(() => {});
	}, [setTaskId, nav, ui, selectedProjectId]);

	// Breadcrumbs
	const currentProject = projects.find((p) => p.id === selectedProjectId);
	const runTitle = (executionDetail as any)?.displayTitle ?? executionDetail?.title ?? null;
	const breadcrumbs = buildRunBreadcrumbs(
		currentProject?.name ?? null,
		selectedProjectId,
		null, // taskName
		null, // selectedTaskId
		runTitle,
		selectedPlanExecId,
		(route: string) => {
			if (route === "/") { setPlanExecId(null); nav.navigateToEmpty(); }
			else if (route.startsWith("/projects/")) {
				const parts = route.split("/").filter(Boolean);
				if (parts.length >= 2 && parts[0] === "projects") setProjectId(parts[1]);
			}
		},
	);

	// Status text
	const activeWorkspaces = executionDetail?.workspaces ?? [];
	const queue = {
		pending: activeWorkspaces.filter((w) => w.stage === "pending").length,
		active: activeWorkspaces.filter((w) => w.stage === "active").length,
		blocked: activeWorkspaces.filter((w) => w.stage === "blocked").length,
		complete: activeWorkspaces.filter((w) => w.stage === "complete").length,
		failed: activeWorkspaces.filter((w) => w.stage === "failed").length,
	};
	const statusText = queue ? `${queue.active} active${queue.blocked > 0 ? ` · ${queue.blocked} blocked` : ""}` : null;

	// Platform active item for sidebar highlight
	const platformActiveItem = route.type === "platform" ? (route.platformScreen as any) : null;

	// Chat context refs
	const chatContextRefs: ContextRef[] = [
		...(selectedProjectId ? [{ kind: "plan" as const, id: selectedProjectId, label: currentProject?.name ?? selectedProjectId }] : []),
		...(selectedPlanExecId ? [{ kind: "run" as const, id: selectedPlanExecId, label: (executionDetail as any)?.displayTitle ?? executionDetail?.title ?? `Run ${selectedPlanExecId.slice(0, 6)}` }] : []),
	];

	// Loading
	if (projectsLoading && !hasProjects) {
		return (
			<div className={`w-full h-screen flex items-center justify-center ${BG}`}>
				<div className="flex items-center gap-2.5 text-stone-400 dark:text-stone-500 text-sm">
					<svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
					Loading...
				</div>
			</div>
		);
	}

	// Route-based center content
	let centerContent: React.ReactNode;
	if (isLegacyMode) {
		centerContent = <LegacyRoute />;
	} else {
		switch (route.type) {
			case "run":
				centerContent = <RunRoute />;
				break;
			case "task":
				centerContent = <TaskRoute />;
				break;
			case "workspace-detail":
				centerContent = <WorkspaceDetailRoute />;
				break;
			case "platform":
				centerContent = <PlatformRoute />;
				break;
			case "empty":
			default:
				centerContent = <EmptyRoute />;
				break;
		}
	}

	return (
		<DrawerProvider drawer={ui.contextualDrawer} onDrawerChange={(v) => ui.setContextualDrawer(v)}>
		<AppShell
			breadcrumbs={breadcrumbs}
			topbar={
				<TopbarV3
					breadcrumbs={breadcrumbs}
					status={activePlanStatus !== "unknown" ? activePlanStatus : undefined}
					statusText={statusText}
					brainMode={brainMode}
					onCycleBrainMode={cycleBrainMode}
					canResume={canResume}
					canPause={canPause}
					canStop={canStop}
					controlDisabled={controlDisabled}
					onResume={() => handleControl("resume")}
					onPause={() => handleControl("pause")}
					onStop={() => handleControl("stop")}
					canRerun={!!selectedPlanExecId && canRerun}
					onRerun={() => ui.setShowRerunDialog(true)}
					canForceKill={canForceKill}
					onForceKill={() => ui.setShowForceKillConfirm(true)}
					onSettings={() => ui.setShowSettingsDialog(true)}
					onSearch={() => {}}
					onToggleMobileNav={() => ui.setMobileNav(ui.mobileNav === "left" ? null : "left")}
					onBrainMenu={() => nav.navigateToPlatform("brain_overview")}
					onToggleRightSidebar={() => ui.toggleRight()}
				/>
			}
			leftSidebar={
				<TaskRunSidebar
					project={currentProject ?? null}
					projects={projects}
					activeItem={selectedPlanExecId ?? selectedTaskId ?? platformActiveItem}
					onNavigate={handleSidebarNavigate}
					onSelectProject={setProjectId}
					onCreateProject={() => ui.setShowProjectDialog(true)}
					onUploadPlan={() => hasProjects ? ui.setShowPlanUploadDialog(true) : ui.setShowProjectDialog(true)}
					onCreateTask={() => ui.setShowTaskCreateDialog(true)}
					onOpenSettings={() => ui.setShowSettingsDialog(true)}
					brainMode={brainMode}
					onCycleBrainMode={cycleBrainMode}
					executions={executions}
					tasks={projectTasks}
					executionsLoading={executionsLoading}
					tasksLoading={tasksLoading}
					onSelectExecution={handleSelectExecution}
					onSelectTask={handleSelectTask}
					unreadCounts={{ observations, proposals, approvals }}
				/>
			}
			centerContent={centerContent}
	
			contextualDrawer={ui.contextualDrawer}
			onCloseDrawer={() => ui.setContextualDrawer(null)}
			errorBanner={ui.errorBanner}
			onClearError={() => ui.setErrorBanner(null)}
			leftSidebarOpen={ui.leftOpen}
			onToggleLeftSidebar={() => ui.toggleLeft()}
			leftSidebarWidth={230}
			mobileNav={ui.mobileNav}
			onMobileNavClose={() => ui.setMobileNav(null)}
						legacyRightSidebar={
				<RightSidebar
					events={planEvents}
					eventFilter={ui.eventFilter}
					onEventFilterChange={ui.setEventFilter}
					alertEntries={[
						...activeWorkspaces.filter((w) => w.stage === "failed").map((w) => ({ id: w.id, type: "failed" as const, workspaceId: w.id })),
						...activeWorkspaces.filter((w) => w.stage === "blocked").map((w) => ({ id: w.id, type: "blocked" as const, workspaceId: w.id })),
					]}
					totalAlertIssues={activeWorkspaces.filter((w) => w.stage === "failed").length + activeWorkspaces.filter((w) => w.stage === "blocked").length}
					projectId={selectedProjectId}
					planExecId={selectedPlanExecId}
				/>
			}
			legacyRightOpen={ui.rightOpen}
			overlays={
				<>
					<AnimatePresence>
						{ui.showBrainContext && (
							<motion.aside
								initial={{ width: 0, opacity: 0 }}
								animate={{ width: 320, opacity: 1 }}
								exit={{ width: 0, opacity: 0 }}
								transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
								className="shrink-0 overflow-hidden relative z-20"
							>
								<BrainContextPanel projectId={selectedProjectId} isOpen={ui.showBrainContext} onClose={() => ui.setShowBrainContext(false)} />
							</motion.aside>
						)}
					</AnimatePresence>
					<AnimatePresence>
						{ui.showArtifacts && (
							<motion.aside
								initial={{ width: 0, opacity: 0 }}
								animate={{ width: 480, opacity: 1 }}
								exit={{ width: 0, opacity: 0 }}
								transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
								className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden relative z-20`}
							>
								<div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}>
									<span className="text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">Artifacts</span>
									<button onClick={() => ui.setShowArtifacts(false)} className="text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"><X size={14} /></button>
								</div>
								<div className="flex-1 min-h-0 overflow-hidden">
									<ArtifactBrowser planExecId={selectedPlanExecId} />
								</div>
							</motion.aside>
						)}
					</AnimatePresence>
					<AnimatePresence>
						{ui.showChat && (
							<motion.aside
								initial={{ width: 0, opacity: 0 }}
								animate={{ width: 400, opacity: 1 }}
								exit={{ width: 0, opacity: 0 }}
								transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
								className="shrink-0 overflow-hidden relative z-20"
							>
								<ChatPanel
									isOpen={ui.showChat}
									projectId={selectedProjectId}
									onClose={() => ui.setShowChat(false)}
									contextRefs={chatContextRefs}
									onContextRefClick={(ref) => {
										if (ref.kind === "run") { setPlanExecId(ref.id); nav.navigateToRun(ref.id); }
										else if (ref.kind === "workspace") { setWorkerId(ref.id); }
									}}
								/>
							</motion.aside>
						)}
					</AnimatePresence>
				</>
			}
			dialogs={
				<>
					<OpenProjectDialog
						isOpen={ui.showProjectDialog}
						onClose={() => ui.setShowProjectDialog(false)}
						onCreate={createProject}
						projects={projects}
						onSelectExisting={(id) => setProjectId(id)}
					/>
					{ui.showPlanUploadDialog && (selectedProjectId || projects.length > 0) && (
						<PlanUploadDialog
							isOpen={ui.showPlanUploadDialog}
							onClose={() => ui.setShowPlanUploadDialog(false)}
							projectId={selectedProjectId ?? projects[0].id}
							onExecutionStarted={(id) => {
								setPlanExecId(id);
								nav.navigateToRun(id);
								ui.setShowPlanUploadDialog(false);
							}}
							onEnqueued={() => {
								if (selectedProjectId) {
									queryClient.invalidateQueries({ queryKey: ["plan-queue", selectedProjectId] });
								}
							}}
						/>
					)}
					{ui.showTaskCreateDialog && selectedProjectId && (
						<TaskCreationStudio
							isOpen={ui.showTaskCreateDialog}
							onClose={() => ui.setShowTaskCreateDialog(false)}
							projectId={selectedProjectId}
							onTaskCreated={(taskId) => {
								ui.setShowTaskCreateDialog(false);
								setTaskId(taskId);
								nav.navigateToTask(taskId);
								queryClient.invalidateQueries({ queryKey: ["tasks", selectedProjectId] });
							}}
						/>
					)}
					<SettingsDialog
						isOpen={ui.showSettingsDialog}
						onClose={() => ui.setShowSettingsDialog(false)}
						project={selectedProjectId ? projects.find((p) => p.id === selectedProjectId) ?? null : null}
					/>
					<ExecutionLogViewer planExecId={selectedPlanExecId} isOpen={ui.showExecutionLog} onClose={() => ui.setShowExecutionLog(false)} />
					<RerunDialog
						isOpen={ui.showRerunDialog}
						onClose={() => ui.setShowRerunDialog(false)}
						onConfirm={handleRerun}
						executionDetail={executionDetail ?? null}
						loading={ui.rerunning}
					/>
					<ForceKillDialog
						isOpen={ui.showForceKillConfirm}
						onClose={() => ui.setShowForceKillConfirm(false)}
						onConfirm={handleForceKill}
						executionTitle={(executionDetail as any)?.displayTitle ?? executionDetail?.title ?? null}
					/>
				</>
			}
		/>
		</DrawerProvider>
	);
}

// ─── Root export with providers ───────────────────────────────────────────

export function App() {
	return (
		<NavigationProvider>
			<AppShellWiring />
		</NavigationProvider>
	);
}
