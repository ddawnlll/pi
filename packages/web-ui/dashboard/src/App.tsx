import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Track first mount for debug logging
let _appMounted = false;
import { AnimatePresence, motion } from "framer-motion";
import {
  Upload,
  AlertCircle, Plus, History, LayoutGrid, X, Cpu, Loader2, Activity,
  Filter, DollarSign, Zap, ListOrdered,
  FolderOpen,
} from "lucide-react";
import type { WorkerInfo, WorkspaceSummary, GitFilePatch } from "./types";
import type { PlatformNavItem } from "./components/LeftNav";
import type { TopbarBrainMode } from "./components/topbar/Topbar";
import { usePlanState } from "./hooks/usePlanState";
import { useJournalStream } from "./hooks/useJournalStream";
import { useProjects } from "./hooks/useProjects";
import { usePlanExecutions, usePlanExecutionDetail, usePlanStats } from "./hooks/usePlanExecutions";
import { usePlanEvents } from "./hooks/usePlanEvents";
import { useToolCallEvents } from "./hooks/useToolCallEvents";
import { useSettings } from "./hooks/useSettings";
import { useIntegrationQueueStatus } from "./hooks/useScaleStatus";

import { useTheme } from "./hooks/useTheme";
import { PlanSummary } from "./components/PlanSummary";
import { QueuePanel } from "./components/QueuePanel";
import { WorkerDetail } from "./components/WorkerDetail";
import { DiffViewer } from "./components/DiffViewer";
import { OpenProjectDialog } from "./components/OpenProjectDialog";
import { PlanUploadDialog } from "./components/PlanUploadDialog";
import { TaskCreateDialog } from "./components/TaskCreateDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExecutionLogViewer } from "./components/ExecutionLogViewer";
import { WarningBanner } from "./components/WarningBanner";
import { RerunDialog } from "./components/RerunDialog";
import { ForceKillDialog } from "./components/ForceKillDialog";
import { StatusBadge } from "./components/StatusBadge";
import { IconBtn, LabeledBtn } from "./components/IconBtn";
import { StatCard } from "./components/StatCard";

import { ChatPanel, type ContextRef } from "./components/ChatPanel";
import { BrainContextPanel } from "./components/BrainContextPanel";
import { RightSidebar, type AlertEntry } from "./components/right-sidebar";
import { useUnreadCount } from "./hooks/useUnreadCount";
import { CommandsPanel } from "./components/CommandsPanel";
import { ArtifactBrowser } from "./components/ArtifactBrowser";
import { formatTokens, formatCost, formatPercent, formatPercentOrUnknown } from "./utils/format";
import { TaskDetailView } from "./components/TaskDetailView";
import type { MultiPhaseTask } from "./types";
import { LiveLogTerminal } from "./components/LiveLogTerminal";
import { SchedulerStatusPanel } from "./components/SchedulerStatusPanel";

import { AutonomyCenter } from "./features/autonomy/AutonomyCenter";
import { ExtensionsManager } from "./components/ExtensionsManager";
import { SkillsManager } from "./components/SkillsManager";
import { Sidebar } from "./components/sidebar";
import { RegistrySettings } from "./features/settings/RegistrySettings";
import { PlanIntakePanel } from "./features/plan-intake/PlanIntakePanel";
import { PolicyAuditCenter } from "./features/policy-audit/PolicyAuditCenter";
import { TrustDashboard } from "./features/trust/TrustDashboard";
import { GoalBoard } from "./components/brain/goals/GoalBoard";
import { ProposalInbox } from "./features/proposal-inbox/ProposalInbox";
import { ObservabilityCockpit } from "./features/observability/ObservabilityCockpit";
import { PiInbox } from "./components/inbox/PiInbox";
import { Topbar, ContextualToolbar } from "./components/topbar/Topbar";
import { BrainStatePage } from "./pages/BrainStatePage";
import { BrainMemoryPage } from "./pages/BrainMemoryPage";
import { BrainReflectionsPage } from "./pages/BrainReflectionsPage";
import { BrainTrustPage } from "./pages/BrainTrustPage";
import { BrainOvernightPage } from "./pages/BrainOvernightPage";
import { DigestPage } from "./pages/DigestPage";
import { BrainInboxPage } from "./pages/BrainInboxPage";

// ─── ActiveView type ────────────────────────────────────────────────────
// Single source of truth for the center column view
type ActiveView =
  | { type: "run" }
  | { type: "task" }
  | { type: "platform"; screen: PlatformNavItem }
  | { type: "empty" };

// ─── Platform screen picker ─────────────────────────────────────────────
function platformScreen(s: PlatformNavItem): React.ReactNode | null {
  // Returns null so the caller can use its own className wrapping
  return null;
}

const API_BASE = "";

async function sendControlCommand(action: "pause" | "stop" | "cancel" | "resume" | "force-kill", planExecId: string | null) {
  try {
    const url = planExecId ? `${API_BASE}/api/executions/${planExecId}/control` : `${API_BASE}/api/control`;
    const body = planExecId ? { action } : { action, requestedAt: new Date().toISOString(), requestedBy: "dashboard" };
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.json() as Promise<{ success: boolean; error?: string }>;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

async function sendRerunCommand(projectId: string, planExecId: string): Promise<{ success: boolean; error?: string; planExecutionId?: string }> {
  try {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/plans/${planExecId}/rerun`, { method: "POST" });
    return r.json() as Promise<{ success: boolean; error?: string; planExecutionId?: string }>;
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ─── tokens ──────────────────────────────────────────────────────────────────

const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── sub-components ───────────────────────────────────────────────────────────

function WorkerCard({ worker, workspace, active, onClick, onStopWorker }: {
  worker: WorkerInfo; workspace?: WorkspaceSummary; active: boolean; onClick: () => void; onStopWorker: (id: string) => void;
}) {
  const stageMeta: Record<string, { color: string; bg: string; darkColor: string; darkBg: string }> = {
    active:   { color: "text-emerald-600", bg: "bg-emerald-50", darkColor: "dark:text-emerald-400", darkBg: "dark:bg-emerald-900/30" },
    pending:  { color: "text-stone-400",   bg: "bg-stone-100",  darkColor: "dark:text-stone-500",   darkBg: "dark:bg-stone-800/30" },
    blocked:  { color: "text-amber-600",   bg: "bg-amber-50",   darkColor: "dark:text-amber-400",   darkBg: "dark:bg-amber-900/30" },
    complete: { color: "text-blue-600",    bg: "bg-blue-50",    darkColor: "dark:text-blue-400",    darkBg: "dark:bg-blue-900/30" },
    failed:   { color: "text-red-600",     bg: "bg-red-50",     darkColor: "dark:text-red-400",     darkBg: "dark:bg-red-900/30" },
  };
  const m = stageMeta[worker.stage] ?? stageMeta.pending;
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b ${BORD} last:border-b-0 transition-colors ${active ? `${ACC_BG}` : `hover:bg-stone-50 dark:hover:bg-[#2A2A2A]`}`}
    >
      <span className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${m.bg} ${m.darkBg}`}>
        <LayoutGrid size={14} strokeWidth={1.8} className={`${m.color} ${m.darkColor}`} />
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${active ? ACC_TXT : `text-stone-700 dark:text-stone-300`}`}>{worker.id}</p>
        <p className={`text-[10px] ${MUT} mt-0.5`}>attempt {worker.attempt ?? 1}{workspace?.stage ? ` · ${workspace.stage}` : ""}</p>
      </div>
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${m.color} ${m.bg} ${m.darkColor} ${m.darkBg}`}>{worker.stage}</span>
    </button>
  );
}

function QueueStrip({ queue }: { queue: { pending: number; active: number; blocked: number; complete: number; failed: number } }) {
  const items = [
    { label: "Pending",  value: queue.pending,  color: "text-stone-500 dark:text-stone-400" },
    { label: "Active",   value: queue.active,   color: "text-emerald-600 dark:text-emerald-400" },
    { label: "Blocked",  value: queue.blocked,  color: "text-amber-600 dark:text-amber-400" },
    { label: "Done",     value: queue.complete, color: "text-blue-600 dark:text-blue-400" },
    { label: "Failed",   value: queue.failed,   color: "text-red-600 dark:text-red-400" },
  ];
  return (
    <div className={`flex shrink-0 border-b ${BORD} ${SURF} divide-x ${BORD}`}>
      {items.map(it => (
        <div key={it.label} className="flex-1 flex flex-col items-center py-2.5 gap-0.5">
          <span className={`text-sm font-semibold ${it.color}`}>{it.value}</span>
          <span className={`text-[9px] uppercase tracking-widest ${MUT} font-medium`}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function ExecutionStabilityPanel({
  status,
  queue,
  events,
  connectionStatus,
  lastEventAt,
  isEventStreamStale,
  lastError,
}: {
  status: string;
  queue: { pending: number; active: number; blocked: number; complete: number; failed: number };
  events: Array<{ type: string; timestamp: number; workspaceId?: string; data?: Record<string, unknown> }>;
  connectionStatus: string;
  lastEventAt: number | null;
  isEventStreamStale: boolean;
  lastError: string | null;
}) {
  const watched = new Set([
    "plan_stop_requested",
    "plan_stop_acknowledged",
    "plan_stop_draining_started",
    "plan_stop_drained",
    "continue_requested",
    "continue_rerun_started",
    "continue_rerun_completed",
    "continue_no_resettable_workspaces",
    "continue_failed_queue_missing",
    "stale_attempt_completion_ignored",
    "illegal_transition_prevented_before_router",
    "active_registry_db_mismatch",
    "completion_gate_blocked_visible",
    "runner_stopped_by_db_state",
  ]);
  const stabilityEvents = events.filter((event) => watched.has(event.type));
  const lastControl = stabilityEvents.find((event) => event.type.startsWith("plan_stop") || event.type.startsWith("continue_"));
  const issueEvents = stabilityEvents.filter((event) =>
    event.type.includes("failed") ||
    event.type.includes("missing") ||
    event.type.includes("stale") ||
    event.type.includes("mismatch") ||
    event.type.includes("blocked") ||
    event.type.includes("illegal")
  );
  const hasStopDraining = stabilityEvents.some((event) => event.type === "plan_stop_draining_started") &&
    !stabilityEvents.some((event) => event.type === "plan_stop_drained");
  const staleIgnored = stabilityEvents.filter((event) => event.type === "stale_attempt_completion_ignored").length;
  const updatedAt = lastEventAt ? new Date(lastEventAt).toLocaleTimeString() : "never";

  return (
    <div className={`shrink-0 p-3 border-b ${BORD} ${SURF}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">Execution Stability / Control Plane Health</div>
          <div className="text-[11px] text-stone-500 dark:text-stone-400">DB status: {status} · stream: {connectionStatus} · last event: {updatedAt}</div>
        </div>
        <div className={`text-[10px] px-2 py-1 rounded-full ${isEventStreamStale ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"}`}>
          {isEventStreamStale ? "stream stale" : "stream current"}
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px] mb-2">
        <span>ready {queue.pending}</span>
        <span>active {queue.active}</span>
        <span>blocked {queue.blocked}</span>
        <span>failed {queue.failed}</span>
        <span>complete {queue.complete}</span>
        <span>stale ignored {staleIgnored}</span>
      </div>
      <div className="space-y-1 text-[11px]">
        {hasStopDraining && <div className="text-amber-700 dark:text-amber-300">Stop is draining active workers.</div>}
        {lastControl && <div className="text-stone-600 dark:text-stone-300">Last control action: {lastControl.type}</div>}
        {lastError && <div className="text-red-700 dark:text-red-300">Last control error: {lastError}</div>}
        {issueEvents.slice(0, 3).map((event, index) => (
          <div key={`${event.type}-${event.timestamp}-${index}`} className="text-red-700 dark:text-red-300">
            {event.type}{event.workspaceId ? ` · ${event.workspaceId}` : ""}
          </div>
        ))}
        {issueEvents.length === 0 && !hasStopDraining && !lastError && (
          <div className="text-stone-500 dark:text-stone-400">No active control-plane stability issue reported.</div>
        )}
      </div>
    </div>
  );
}

// ─── localStorage keys ───────────────────────────────────────────────────

const SELECTED_PROJECT_KEY = "pi_selected_project_id";
const SELECTED_EXEC_KEY = "pi_selected_exec_id";
const SELECTED_VIEW_KEY = "pi_selected_view";
const SELECTED_TASK_KEY = "pi_selected_task_id";

function loadLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveLocal(key: string, value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function loadSelectedProjectId(): string | null {
  return loadLocal(SELECTED_PROJECT_KEY);
}

function saveSelectedProjectId(id: string | null): void {
  saveLocal(SELECTED_PROJECT_KEY, id);
}

function loadSelectedExecId(): string | null {
  return loadLocal(SELECTED_EXEC_KEY);
}

function saveSelectedExecId(id: string | null): void {
  saveLocal(SELECTED_EXEC_KEY, id);
}

function loadSelectedView(): ActiveView {
  try {
    const raw = localStorage.getItem(SELECTED_VIEW_KEY);
    if (raw) return JSON.parse(raw) as ActiveView;
  } catch {
    // ignore
  }
  return { type: "empty" };
}

function saveSelectedView(view: ActiveView): void {
  saveLocal(SELECTED_VIEW_KEY, JSON.stringify(view));
}

function loadSelectedTaskId(): string | null {
  return loadLocal(SELECTED_TASK_KEY);
}

function saveSelectedTaskId(id: string | null): void {
  saveLocal(SELECTED_TASK_KEY, id);
}

// ─── main app ─────────────────────────────────────────────────────────────────

export function App() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  console.log("[App] useTheme resolved, theme=", theme);
  const { projects, isLoading: projectsLoading, createProject } = useProjects();
  console.log("[App] useProjects resolved, loading=", projectsLoading, "count=", projects.length);
  const hasProjects = projects.length > 0;
  // Restore project selection from localStorage
  const initialProjectId = loadSelectedProjectId();
  // ── Unread brain counts for sidebar nudges and badges ───────────────────
  const { observations, proposals, approvals } = useUnreadCount();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectId && projects.find(p => p.id === initialProjectId) ? initialProjectId : null
  );
  const [selectedPlanExecId, setSelectedPlanExecId] = useState<string | null>(loadSelectedExecId());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(loadSelectedTaskId());
  const [selectedTask, setSelectedTask] = useState<MultiPhaseTask | null>(null);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [showPlanUploadDialog, setShowPlanUploadDialog] = useState(false);
  const [showTaskCreateDialog, setShowTaskCreateDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [showExecutionLog, setShowExecutionLog] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showCommandsDialog, setShowCommandsDialog] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showBrainContext, setShowBrainContext] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState<"left" | "right" | null>(null);

  // ── Brain V5 mode ─────────────────────────────────────────────────────
  const [brainMode, setBrainMode] = useState<TopbarBrainMode>("READ_ONLY");
  const cycleBrainMode = useCallback(() => {
    setBrainMode((prev) => {
      const modes: TopbarBrainMode[] = ["OFF", "READ_ONLY", "ADVISORY", "DRAFTING", "OPERATOR_READY"];
      const idx = modes.indexOf(prev);
      return modes[(idx + 1) % modes.length];
    });
  }, []);

  // ── New state: active view ─────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>(loadSelectedView());

  // ── Derived booleans from activeView ──────────────────────────────────
  const showAutonomy         = activeView.type === "platform" && activeView.screen === "autonomy";
  const showObservability    = activeView.type === "platform" && activeView.screen === "observability";
  const showExtensions       = activeView.type === "platform" && activeView.screen === "extensions_skills";
  const showSkills           = activeView.type === "platform" && activeView.screen === "extensions_skills";
  const showPlanIntake       = activeView.type === "platform" && activeView.screen === "plan_intake";
  const showPolicyAudit      = activeView.type === "platform" && activeView.screen === "policy_audit";
  const showRegistrySettings = activeView.type === "platform" && activeView.screen === "registry_settings";
  const showPiInbox            = activeView.type === "platform" && activeView.screen === "pi_inbox";
  // P19 brain pages (V5.13 unified Brain section)
  const showBrainOverview    = activeView.type === "platform" && activeView.screen === "brain_overview";
  const showBrainAsk         = activeView.type === "platform" && activeView.screen === "brain_ask";
  const showBrainTemporal    = activeView.type === "platform" && activeView.screen === "brain_temporal";
  const showBrainMemory      = activeView.type === "platform" && activeView.screen === "brain_memory";
  const showBrainRepoScanner = activeView.type === "platform" && activeView.screen === "brain_repo_scanner";
  const showBrainSignals     = activeView.type === "platform" && activeView.screen === "brain_signals";
  const showBrainReflections = activeView.type === "platform" && activeView.screen === "brain_reflections";
  const showBrainDigest      = activeView.type === "platform" && activeView.screen === "brain_digest";
  const showBrainOvernight   = activeView.type === "platform" && activeView.screen === "brain_overnight";
  const showBrainGoals       = activeView.type === "platform" && activeView.screen === "brain_goals";
  const showBrainProposals   = activeView.type === "platform" && activeView.screen === "brain_proposals";
  const showBrainDrafts      = activeView.type === "platform" && activeView.screen === "brain_drafts";
  const showBrainTrust       = activeView.type === "platform" && activeView.screen === "brain_trust";
  const showBrainInbox       = activeView.type === "platform" && activeView.screen === "brain_inbox";
  const platformActiveItem: PlatformNavItem | null =
    activeView.type === "platform" ? activeView.screen : null;

  // ── Navigate to a sidebar item ────────────────────────────────────────
  const handleSidebarNavigate = useCallback((item: string) => {
    // Brain items are platform screens
    if (item.startsWith("brain_")) {
      setActiveView({ type: "platform", screen: item as PlatformNavItem });
    } else if (
      item === "autonomy" ||
      item === "plan_intake" ||
      item === "extensions_skills" ||
      item === "registry_settings" ||
      item === "observability" ||
      item === "policy_audit" ||
      item === "pi_inbox"
    ) {
      setActiveView({ type: "platform", screen: item as PlatformNavItem });
    } else {
      // Default: try as a run or task selection handled by parent
      // This is handled by separate callbacks
    }
    setMobileNav(null);
  }, []);

  // Select first project if none selected, with localStorage support
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      const saved = loadSelectedProjectId();
      const target = saved && projects.find(p => p.id === saved) ? saved : projects[0].id;
      setSelectedProjectId(target);
    }
  }, [projects, selectedProjectId]);

  // Save project/exec/view/task to localStorage whenever they change
  useEffect(() => { saveSelectedProjectId(selectedProjectId); }, [selectedProjectId]);
  useEffect(() => { saveSelectedExecId(selectedPlanExecId); }, [selectedPlanExecId]);
  useEffect(() => { saveSelectedView(activeView); }, [activeView]);
  useEffect(() => { saveSelectedTaskId(selectedTaskId); }, [selectedTaskId]);

  const [includeArchivedPlans, setIncludeArchivedPlans] = useState(false);
  const { data: executions = [], isLoading: executionsLoading } = usePlanExecutions(selectedProjectId, includeArchivedPlans);
  const { data: executionDetail } = usePlanExecutionDetail(selectedProjectId, selectedPlanExecId);
  const { data: planStats } = usePlanStats(selectedProjectId, selectedPlanExecId);
  const { budgets: contextBudgets } = useSettings();
  const { events: planEvents, connectionStatus, lastEventAt, isStale: isEventStreamStale } = usePlanEvents({ projectId: selectedProjectId, planExecId: selectedPlanExecId });
  const { toolCalls } = useToolCallEvents({ projectId: selectedProjectId, planExecId: selectedPlanExecId });
  const { data: integrationQueueData } = useIntegrationQueueStatus(hasProjects);
  // Auto-select execution: restore saved one, or fall back to first
  useEffect(() => {
    if (executions.length === 0) return;
    // Don't override platform/task views with run selection
    if (activeView.type !== "empty") return;
    if (selectedPlanExecId && executions.find(e => e.id === selectedPlanExecId)) {
      // Our saved execution is still valid
      setActiveView({ type: "run" });
      return;
    }
    // Saved execution not found in current list — pick first
    const running = executions.find(e => e.status === "running");
    setSelectedPlanExecId(running?.id ?? executions[0].id);
    setActiveView({ type: "run" });
  }, [executions, selectedPlanExecId, activeView.type]);

  const { data: legacyPlanState, isLoading: legacyLoading, workers: legacyWorkers, queue: legacyQueue } = usePlanState(!hasProjects);
  const { events: legacyEvents } = useJournalStream(!hasProjects);
  const isLegacyMode = !hasProjects && !selectedProjectId;
  const isStartingUp = projectsLoading && !hasProjects;
  const [controlActionInFlight, setControlActionInFlight] = useState(false);

  const activePlanStatus = isLegacyMode
    ? (legacyPlanState?.status ?? "unknown")
    : (executionDetail?.status ?? "unknown");

  const canResume = activePlanStatus === "paused";
  const canPause = activePlanStatus === "running";
  const canStop = activePlanStatus === "running" || activePlanStatus === "paused";
  const canRerun = activePlanStatus === "failed" || activePlanStatus === "stopped" || activePlanStatus === "cancelled";
  const controlDisabled = selectedPlanExecId === null || controlActionInFlight;
  const canForceKill = activePlanStatus === "running" || activePlanStatus === "paused";

  const activeWorkspaces: WorkspaceSummary[] = isLegacyMode
    ? (legacyPlanState?.workspaces?.map(ws => ({ id: ws.workspaceId, stage: ws.stage, attempts: ws.attempts, error: ws.error ?? null, startedAt: ws.startedAt ?? null, completedAt: ws.completedAt ?? null })) ?? [])
    : (executionDetail?.workspaces ?? []);

  const activeEvents = isLegacyMode ? legacyEvents : planEvents;

  // ── Integration queue / conflict alerts ──────────────────────────────────
  const conflictAlertCount =
    integrationQueueData?.counts?.conflict ??
    integrationQueueData?.entries?.filter((e) => e.status === "conflict").length ??
    0;
  const conflictEntries =
    integrationQueueData?.entries?.filter((e) => e.status === "conflict") ?? [];
  const totalAlertIssues =
    activeWorkspaces.filter((w) => w.stage === "failed").length + conflictAlertCount;
  const workers: WorkerInfo[] = isLegacyMode
    ? legacyWorkers
    : activeWorkspaces.map(ws => ({ id: ws.id, stage: ws.stage as WorkerInfo["stage"], attempt: ws.attempts, retries: 0 }));

  const queue = isLegacyMode
    ? legacyQueue
    : { pending: activeWorkspaces.filter(w => w.stage === "pending").length, active: activeWorkspaces.filter(w => w.stage === "active").length, blocked: activeWorkspaces.filter(w => w.stage === "blocked").length, complete: activeWorkspaces.filter(w => w.stage === "complete").length, failed: activeWorkspaces.filter(w => w.stage === "failed").length };

  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "errors">("all");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  /** Context refs for the chat panel derived from current dashboard selections. */
  const chatContextRefs: ContextRef[] = [
    ...(selectedProjectId ? [{ kind: "plan" as const, id: selectedProjectId, label: projects.find(p => p.id === selectedProjectId)?.name ?? selectedProjectId }] : []),
    ...(selectedPlanExecId ? [{ kind: "run" as const, id: selectedPlanExecId, label: (executionDetail as any)?.displayTitle ?? executionDetail?.title ?? `Run ${selectedPlanExecId.slice(0, 6)}` }] : []),
    ...(selectedWorkerId ? [{ kind: "workspace" as const, id: selectedWorkerId, label: selectedWorkerId }] : []),
  ];

  useEffect(() => {
    if (!_appMounted) {
      _appMounted = true;
      console.log("[App] First mount — all hooks initialized, rendering UI");
    }
  }, []);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedWorker = workers.find(w => w.id === selectedWorkerId);
  const selectedWorkspace = activeWorkspaces.find(w => w.id === selectedWorkerId);

  const showError = useCallback((msg: string) => {
    setErrorBanner(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorBanner(null), 5000);
  }, []);

  useEffect(() => () => { if (errorTimerRef.current) clearTimeout(errorTimerRef.current); }, []);

  const handleControl = useCallback(async (action: "pause" | "stop" | "cancel" | "resume") => {
    if (controlActionInFlight) return;
    setControlActionInFlight(true);
    try {
      const res = await sendControlCommand(action, selectedPlanExecId);
      if (!res.success) showError(res.error || `Failed to ${action}`);
      queryClient.invalidateQueries({ queryKey: ["plan-execution-detail", selectedProjectId, selectedPlanExecId] });
      queryClient.invalidateQueries({ queryKey: ["plan-stats", selectedProjectId, selectedPlanExecId] });
      queryClient.invalidateQueries({ queryKey: ["plan-executions", selectedProjectId] });
    } finally {
      setControlActionInFlight(false);
    }
  }, [showError, selectedPlanExecId, selectedProjectId, queryClient, controlActionInFlight]);

  const [showForceKillConfirm, setShowForceKillConfirm] = useState(false);

  const handleForceKill = useCallback(async () => {
    if (!selectedPlanExecId) return;
    setShowForceKillConfirm(false);
    const res = await sendControlCommand("force-kill", selectedPlanExecId);
    if (!res.success) showError(res.error || "Failed to force kill workers");
  }, [showError, selectedPlanExecId]);

  const handleStopWorker = useCallback(async (workerId: string) => {
    // Individual worker stop: force-kill the entire plan
    if (!selectedPlanExecId) return;
    const res = await sendControlCommand("force-kill", selectedPlanExecId);
    if (!res.success) showError(res.error || `Failed to stop worker ${workerId}`);
  }, [showError, selectedPlanExecId]);

  // Force kill callback — added after handleStopWorker to avoid babel async parsing issues
  const handleForceKillWorkers = useCallback(async () => {
    if (!selectedPlanExecId) return;
    setShowForceKillConfirm(false);
    const res = await sendControlCommand("force-kill", selectedPlanExecId);
    if (!res.success) showError(res.error || "Failed to force kill workers");
  }, [showError, selectedPlanExecId]);

  const handleRerun = useCallback(async () => {
    if (!selectedProjectId || !selectedPlanExecId) return;
    setRerunning(true);
    try {
      const res = await sendRerunCommand(selectedProjectId, selectedPlanExecId);
      if (!res.success) {
        showError(res.error || "Failed to rerun plan");
      } else if (res.planExecutionId) {
        setSelectedPlanExecId(res.planExecutionId);
        queryClient.invalidateQueries({ queryKey: ["plan-executions", selectedProjectId] });
      }
    } finally {
      setRerunning(false);
      setShowRerunDialog(false);
    }
  }, [selectedProjectId, selectedPlanExecId, showError, queryClient]);

  const handleUploadPlan = useCallback(() => {
    hasProjects ? setShowPlanUploadDialog(true) : setShowProjectDialog(true);
  }, [hasProjects]);

  const handleExecutionStarted = useCallback((id: string) => {
    setSelectedPlanExecId(id);
    setActiveView({ type: "run" });
    setShowPlanUploadDialog(false);
  }, []);

  const handlePlanEnqueued = useCallback(() => {
    if (selectedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["plan-queue", selectedProjectId] });
    }
  }, [queryClient, selectedProjectId]);

  const handleProjectSelected = useCallback((id: string) => {
    setSelectedProjectId(id);
    setSelectedPlanExecId(null);
    setSelectedTask(null);
    setSelectedTaskId(null);
    setActiveView({ type: "empty" });
    setMobileNav(null);
  }, []);

  // ── Project CRUD helpers ──────────────────────────────────────────────
  const handleCreateProject = useCallback(() => {
    setShowProjectDialog(true);
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to delete project");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      // If we deleted the current project, reset selection
      if (selectedProjectId === projectId) {
        const remaining = projects.filter(p => p.id !== projectId);
        if (remaining.length > 0) {
          handleProjectSelected(remaining[0].id);
        } else {
          setSelectedProjectId(null);
          setActiveView({ type: "empty" });
        }
      }
    } catch (e) {
      showError(String(e));
    }
  }, [selectedProjectId, projects, queryClient, handleProjectSelected, showError]);

  const handleRenameProject = useCallback(async (projectId: string, name: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json();
        showError(data.error || "Failed to rename project");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (e) {
      showError(String(e));
    }
  }, [queryClient, showError]);

  // ── Fetch tasks for the current project ─────────────────────────────────
  const [projectTasks, setProjectTasks] = useState<MultiPhaseTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectTasks([]);
      return;
    }
    let cancelled = false;
    setTasksLoading(true);
    fetch(`${API_BASE}/api/projects/${encodeURIComponent(selectedProjectId)}/tasks`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setProjectTasks(data.tasks ?? []);
          setTasksLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjectTasks([]);
          setTasksLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setActiveView({ type: "task" });
    setMobileNav(null);
    fetch(`${API_BASE}/api/projects/${encodeURIComponent(selectedProjectId ?? "")}/tasks/${encodeURIComponent(taskId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.task) setSelectedTask(d.task);
      })
      .catch(() => {});
  }, [selectedProjectId]);

  const handleSelectExecution = useCallback((execId: string) => {
    setSelectedPlanExecId(execId);
    setActiveView({ type: "run" });
    setMobileNav(null);
  }, []);

  const handleCreateTask = useCallback(() => {
    setShowTaskCreateDialog(true);
  }, []);

  useEffect(() => { setSelectedWorkerId(null); }, [selectedPlanExecId]);

  if (isStartingUp) {
    return (
      <div className={`w-full h-screen flex items-center justify-center ${BG}`}>
        <div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-screen flex flex-col ${BG} font-['DM_Sans',ui-sans-serif,system-ui,sans-serif] overflow-hidden`}>

      {/* ── topbar ── */}
      <Topbar
        planTitle={(executionDetail as any)?.displayTitle ?? executionDetail?.title ?? null}
        statusBadge={activePlanStatus !== "unknown" ? <StatusBadge status={activePlanStatus} /> : undefined}
        brainMode={brainMode}
        onCycleBrainMode={cycleBrainMode}
        onToggleMobileNav={() => setMobileNav(mobileNav === "left" ? null : "left")}
        onToggleLeftSidebar={() => setLeftOpen(o => !o)}
        leftSidebarOpen={leftOpen}
        onToggleRightSidebar={() => setRightOpen(o => !o)}
        rightSidebarOpen={rightOpen}
        canResume={canResume}
        canPause={canPause}
        canStop={canStop}
        controlDisabled={controlDisabled}
        onResume={() => handleControl("resume")}
        onPause={() => handleControl("pause")}
        onStop={() => handleControl("stop")}
        canRerun={!!selectedPlanExecId && canRerun}
        onRerun={() => setShowRerunDialog(true)}
        canForceKill={canForceKill}
        onForceKill={() => setShowForceKillConfirm(true)}
        onSettings={() => setShowSettingsDialog(true)}
        activeViewType={activeView.type}
        onUploadPlan={handleUploadPlan}
        onGit={() => setShowGitDialog(true)}
        onCommands={() => setShowCommandsDialog(true)}
        onChat={() => setShowChat(o => !o)}
        showChat={showChat}
        onBrainContext={() => setShowBrainContext(o => !o)}
        showBrainContext={showBrainContext}
        onArtifacts={() => setShowArtifacts(o => !o)}
        showArtifacts={showArtifacts}
        onExecutionLog={() => setShowExecutionLog(true)}
        hasSelectedPlanExecId={!!selectedPlanExecId}
      />

      {/* ── error banner ── */}
      <AnimatePresence>
        {errorBanner && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-900 px-4 py-2.5 flex items-center gap-2 text-xs text-red-700 dark:text-red-300 shrink-0">
            <AlertCircle size={13} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{errorBanner}</span>
            <button onClick={() => setErrorBanner(null)} className="text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-300"><X size={13} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 3-panel grid body ── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* mobile overlay */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setMobileNav(null)} />
          )}
        </AnimatePresence>

        {/* ── left sidebar (project-centric) ── */}
        <AnimatePresence initial={false}>
          {(leftOpen || mobileNav === "left") && (
            <motion.aside key="left"
              initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 ${SURF} border-r ${BORD} flex flex-col overflow-hidden
                md:relative md:z-auto ${mobileNav === "left" ? "absolute left-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              <Sidebar
                project={projects.find(p => p.id === selectedProjectId) ?? null}
                projects={projects}
                activeItem={selectedPlanExecId ?? selectedTaskId ?? platformActiveItem}
                onNavigate={handleSidebarNavigate}
                onSelectProject={handleProjectSelected}
                onCreateProject={handleCreateProject}
                onDeleteProject={handleDeleteProject}
                onRenameProject={handleRenameProject}
                onOpenSettings={() => setShowSettingsDialog(true)}
                onUploadPlan={handleUploadPlan}
                brainMode={brainMode}
                onCycleBrainMode={cycleBrainMode}
                executions={executions}
                tasks={projectTasks}
                executionsLoading={executionsLoading}
                tasksLoading={tasksLoading}
                onSelectExecution={handleSelectExecution}
                onSelectTask={handleSelectTask}
                onCreateTask={handleCreateTask}
                includeArchived={includeArchivedPlans}
                onToggleArchived={() => setIncludeArchivedPlans(a => !a)}
                unreadCounts={{ observations, proposals, approvals }}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── center column ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">

          {/* ── contextual toolbar ── */}
          <ContextualToolbar
            activeViewType={activeView.type}
            onUploadPlan={handleUploadPlan}
            onGit={() => setShowGitDialog(true)}
            onCommands={() => setShowCommandsDialog(true)}
            onChat={() => setShowChat(o => !o)}
            showChat={showChat}
            onBrainContext={() => setShowBrainContext(o => !o)}
            showBrainContext={showBrainContext}
            onArtifacts={() => setShowArtifacts(o => !o)}
            showArtifacts={showArtifacts}
            onExecutionLog={() => setShowExecutionLog(true)}
            hasSelectedPlanExecId={!!selectedPlanExecId}
          />

          {/* ── center body — switch on activeView ── */}
          {isLegacyMode ? (
            /* ── LEGACY MODE ── */
            <>
              {legacyPlanState && (
                <>
                  <div className={`shrink-0 grid grid-cols-2 gap-3 p-3 ${BG} border-b ${BORD}`}>
                    <StatCard icon={History} label="Workspaces" value={String(legacyPlanState.workspaces?.length ?? 0)} />
                    <StatCard icon={Activity} label="Status" value={legacyPlanState.status} accent={legacyPlanState.status === "running"} />
                  </div>
                  <QueueStrip queue={queue} />
                  <div className={`flex gap-4 p-4 border-b ${BORD} ${SURF} shrink-0`}>
                    <div className="w-64"><PlanSummary planState={legacyPlanState} /></div>
                    <div className="w-48"><QueuePanel queue={queue} /></div>
                  </div>
                  {workers.length > 0 && (
                    <div className={`shrink-0 max-h-48 overflow-y-auto border-b ${BORD} ${SURF}`}>
                      {workers.map(w => (
                        <WorkerCard key={w.id} worker={w} workspace={activeWorkspaces.find(ws => ws.id === w.id)}
                          active={w.id === selectedWorkerId} onClick={() => setSelectedWorkerId(w.id)}
                          onStopWorker={(id) => handleStopWorker(id)} />
                      ))}
                    </div>
                  )}
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {selectedWorker ? (
                      <WorkerDetail worker={selectedWorker} planExecId={selectedPlanExecId} workspace={selectedWorkspace} />
                    ) : workers.length > 0 ? (
                      <LiveLogTerminal workers={workers} planEvents={activeEvents as any} className="h-full" />
                    ) : null}
                  </div>
                </>
              )}
              {legacyLoading && (
                <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-stone-400 dark:text-stone-500" /></div>
              )}
              {!legacyPlanState && !legacyLoading && (
                <div className={`flex-1 flex flex-col items-center justify-center gap-4 ${MUT} p-8`}>
                  <LayoutGrid size={48} strokeWidth={1} className="text-stone-300 dark:text-stone-600" />
                  <p className={`text-sm text-stone-500 dark:text-stone-400`}>No plan execution data found</p>
                  <p className={`text-xs ${MUT} max-w-md text-center`}>Upload a plan to get started.</p>
                  <div className="flex gap-2 mt-2">
                    <LabeledBtn icon={Upload} label="Upload plan" onClick={handleUploadPlan} accent />
                    <LabeledBtn icon={Plus} label="Create project" onClick={() => setShowProjectDialog(true)} />
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── PROJECT MODE — switch on activeView ── */
            <>
              {(() => {
                switch (activeView.type) {
                  case "run":
                    return (
                      <>
                        {/* warning banner */}
                        <WarningBanner executionDetail={executionDetail ?? null} workers={activeWorkspaces}
                          events={activeEvents as any} burnRatePerMin={planStats?.burn_rate_per_min} contextBudgets={contextBudgets} executionStats={planStats ?? null} />

                        {/* stats */}
                        {executionDetail && (
                          <>
                            <div className={`shrink-0 grid grid-cols-2 sm:grid-cols-7 gap-3 p-3 ${BG} border-b ${BORD}`}>
                              <StatCard icon={DollarSign} label="Est. cost" value={formatCost(planStats?.estimated_cost_usd)} />
                              <StatCard icon={Cpu} label="Tokens in" value={formatTokens(planStats?.total_tokens_in)} accent />
                              <StatCard icon={Activity} label="Tokens out" value={formatTokens(planStats?.total_tokens_out)} />
                              <StatCard icon={Zap} label="Burn rate" value={planStats?.burn_rate_per_min != null ? `${planStats.burn_rate_per_min.toFixed(0)}/m` : "—"} sublabel="total tokens ÷ elapsed min" />
                              <StatCard icon={Activity} label="Cache hit" value={formatPercentOrUnknown(planStats?.cache_hit_rate_known ? planStats?.cache_hit_rate : null)} />
                              <StatCard icon={ListOrdered} label="Tok/workspace" value={planStats?.tokens_per_workspace != null ? formatTokens(planStats.tokens_per_workspace) : "—"} />
                              <StatCard icon={Filter} label="Tok/progress%" value={planStats?.tokens_per_percent != null ? formatTokens(planStats.tokens_per_percent) : "—"} />
                            </div>
                            <QueueStrip queue={queue} />
                            <ExecutionStabilityPanel
                              status={activePlanStatus}
                              queue={queue}
                              events={activeEvents}
                              connectionStatus={connectionStatus}
                              lastEventAt={lastEventAt}
                              isEventStreamStale={isEventStreamStale}
                              lastError={errorBanner}
                            />
                            <div className={`shrink-0 p-3 border-b ${BORD}`}>
                              <SchedulerStatusPanel stats={planStats ?? null} />
                            </div>
                          </>
                        )}

                        {/* no execution selected */}
                        {!executionDetail && (
                          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${MUT}`}>
                            <History size={32} strokeWidth={1.2} />
                            <p className="text-sm">No execution selected</p>
                            <LabeledBtn icon={Upload} label="Upload a plan" onClick={() => setShowPlanUploadDialog(true)} accent />
                          </div>
                        )}

                        {/* worker list */}
                        {executionDetail && workers.length > 0 && (
                          <div className={`shrink-0 max-h-48 overflow-y-auto border-b ${BORD} ${SURF}`}>
                            {workers.map(w => (
                              <WorkerCard key={w.id} worker={w} workspace={activeWorkspaces.find(ws => ws.id === w.id)}
                                active={w.id === selectedWorkerId} onClick={() => setSelectedWorkerId(w.id)}
                                onStopWorker={(id) => handleStopWorker(id)} />
                            ))}
                          </div>
                        )}

                        {/* worker detail / live log */}
                        {executionDetail && (
                          <div className="flex-1 min-h-0 overflow-y-auto">
                            {selectedWorker ? (
                              <WorkerDetail worker={selectedWorker} planExecId={selectedPlanExecId} workspace={selectedWorkspace} />
                            ) : workers.length > 0 ? (
                              <LiveLogTerminal workers={workers} planEvents={activeEvents as any} className="h-full" />
                            ) : null}
                          </div>
                        )}
                      </>
                    );

                  case "task":
                    return (
                      <div className="flex-1 min-h-0 overflow-y-auto p-4">
                        {selectedTask ? (
                          <TaskDetailView
                            task={selectedTask}
                            projectId={selectedProjectId ?? ""}
                            onBack={() => {
                              setSelectedTask(null);
                              setSelectedTaskId(null);
                              setActiveView(selectedPlanExecId ? { type: "run" } : { type: "empty" });
                            }}
                            onTaskUpdated={(updated) => setSelectedTask(updated)}
                            onPhasePlanClick={(planExecId) => {
                              setSelectedPlanExecId(planExecId);
                              setActiveView({ type: "run" });
                            }}
                          />
                        ) : (
                          <div className={`flex flex-col items-center justify-center h-full gap-3 ${MUT}`}>
                            <Loader2 size={20} className="animate-spin" />
                            <p className="text-sm">Loading task...</p>
                          </div>
                        )}
                      </div>
                    );

                  case "platform":
                    return (
                      <>
                        {/* Platform screen containers only when no task detail */}
                        {showRegistrySettings ? (
                          <RegistrySettings className="flex-1 min-h-0" />
                        ) : showPlanIntake ? (
                          <PlanIntakePanel className="flex-1 min-h-0" />
                        ) : showPolicyAudit ? (
                          <PolicyAuditCenter className="flex-1 min-h-0" />
                        ) : showExtensions ? (
                          <ExtensionsManager className="flex-1 min-h-0" />
                        ) : showSkills ? (
                          <SkillsManager className="flex-1 min-h-0" />
                        ) : showAutonomy ? (
                          <AutonomyCenter className="flex-1 min-h-0" />
                        ) : showObservability ? (
                          <ObservabilityCockpit className="flex-1 min-h-0" />
                        ) : showPiInbox ? (
                          <PiInbox className="flex-1 min-h-0" />
                        ) : showBrainOverview ? (
                          <BrainStatePage />
                        ) : showBrainTemporal ? (
                          <BrainStatePage />
                        ) : showBrainRepoScanner ? (
                          <BrainStatePage />
                        ) : showBrainProposals || showBrainDrafts ? (
                          <ProposalInbox className="flex-1 min-h-0" />
                        ) : showBrainMemory ? (
                          <BrainMemoryPage />
                        ) : showBrainReflections ? (
                          <BrainReflectionsPage />
                        ) : showBrainSignals ? (
                          <DigestPage />
                        ) : showBrainAsk ? (
                          <BrainInboxPage />
                        ) : showBrainDigest ? (
                          <DigestPage />
                        ) : showBrainOvernight ? (
                          <BrainOvernightPage />
                        ) : showBrainGoals ? (
                          <GoalBoard className="flex-1 min-h-0" />
                        ) : showBrainTrust ? (
                          <TrustDashboard className="flex-1 min-h-0" />
                        ) : showBrainInbox ? (
                          <BrainInboxPage />
                        ) : (
                          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${MUT}`}>
                            <Cpu size={32} strokeWidth={1.2} />
                            <p className="text-sm">Select a platform feature from the sidebar</p>
                          </div>
                        )}
                      </>
                    );

                  case "empty":
                  default:
                    return (
                      <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${MUT}`}>
                        <History size={32} strokeWidth={1.2} />
                        <p className="text-sm">No execution selected</p>
                        <LabeledBtn icon={Upload} label="Upload a plan" onClick={() => setShowPlanUploadDialog(true)} accent />
                      </div>
                    );
                }
              })()}
            </>
          )}
        </div>

        {/* ── right sidebar (3 sections) ── */}
        <AnimatePresence initial={false}>
          {(rightOpen || mobileNav === "right") && (
            <motion.aside key="right"
              initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 overflow-hidden
                md:relative md:z-auto ${mobileNav === "right" ? "absolute right-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              <RightSidebar
                events={activeEvents}
                eventFilter={eventFilter}
                onEventFilterChange={setEventFilter}
                alertEntries={[
                  ...activeWorkspaces.filter(w => w.stage === "failed").map(w => ({ id: w.id, type: "failed" as const, workspaceId: w.id })),
                  ...conflictEntries.map(entry => ({ id: entry.workspaceId, type: "conflict" as const, workspaceId: entry.workspaceId })),
                  ...activeWorkspaces.filter(w => w.stage === "blocked").map(w => ({ id: w.id, type: "blocked" as const, workspaceId: w.id })),
                ]}
                totalAlertIssues={totalAlertIssues}
                projectId={selectedProjectId}
                planExecId={selectedPlanExecId}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* -- brain context panel -- */}
        <AnimatePresence>
          {showBrainContext && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="shrink-0 overflow-hidden relative z-20"
            >
              <BrainContextPanel
                projectId={selectedProjectId}
                isOpen={showBrainContext}
                onClose={() => setShowBrainContext(false)}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* -- artifacts overlay -- */}
        <AnimatePresence>
          {showArtifacts && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }} animate={{ width: 480, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden relative z-20`}
            >
              <div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>Artifacts</span>
                <button onClick={() => setShowArtifacts(false)} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300`}>
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ArtifactBrowser planExecId={selectedPlanExecId} />
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* ── dialogs ── */}
      <OpenProjectDialog isOpen={showProjectDialog} onClose={() => setShowProjectDialog(false)}
        onCreate={createProject} projects={projects}
        onSelectExisting={(id) => handleProjectSelected(id)} />
      {showPlanUploadDialog && (selectedProjectId || projects.length > 0) && (
        <PlanUploadDialog isOpen={showPlanUploadDialog} onClose={() => setShowPlanUploadDialog(false)}
          projectId={selectedProjectId ?? projects[0].id} onExecutionStarted={handleExecutionStarted}
          onEnqueued={handlePlanEnqueued} />
      )}
      {showTaskCreateDialog && selectedProjectId && (
        <TaskCreateDialog isOpen={showTaskCreateDialog} onClose={() => setShowTaskCreateDialog(false)}
          projectId={selectedProjectId} onTaskCreated={(taskId) => {
            setShowTaskCreateDialog(false);
            setSelectedTaskId(taskId);
            setActiveView({ type: "task" });
            queryClient.invalidateQueries({ queryKey: ["tasks", selectedProjectId] });
          }} />
      )}
      <SettingsDialog isOpen={showSettingsDialog} onClose={() => setShowSettingsDialog(false)}
        project={selectedProjectId ? projects.find(p => p.id === selectedProjectId) ?? null : null} />
      <ExecutionLogViewer planExecId={selectedPlanExecId} isOpen={showExecutionLog} onClose={() => setShowExecutionLog(false)} />
      <RerunDialog
        isOpen={showRerunDialog}
        onClose={() => setShowRerunDialog(false)}
        onConfirm={handleRerun}
        executionDetail={executionDetail ?? null}
        loading={rerunning}
      />
      <ForceKillDialog
        isOpen={showForceKillConfirm}
        onClose={() => setShowForceKillConfirm(false)}
        onConfirm={handleForceKill}
        executionTitle={(executionDetail as any)?.displayTitle ?? executionDetail?.title ?? null}
      />
      <ChatPanel
        isOpen={showChat}
        projectId={selectedProjectId}
        onClose={() => setShowChat(false)}
        contextRefs={chatContextRefs}
        onContextRefClick={(ref) => {
          if (ref.kind === "run") {
            setSelectedPlanExecId(ref.id);
            setActiveView({ type: "run" });
          } else if (ref.kind === "workspace") {
            setSelectedWorkerId(ref.id);
          }
        }}
      />

      {/* ── git dialog ── */}
      <AnimatePresence>
        {showGitDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowGitDialog(false)}
          >
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className={`bg-white dark:bg-[#1E1E1E] border ${BORD} rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200">Git Status</h2>
                <button onClick={() => setShowGitDialog(false)} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300">
                  <X size={18} />
                </button>
              </div>
              <GitContent workspaces={activeWorkspaces} planExecId={selectedPlanExecId} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── commands dialog ── */}
      <AnimatePresence>
        {showCommandsDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowCommandsDialog(false)}
          >
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 0.95 }} exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className={`bg-white dark:bg-[#1E1E1E] border ${BORD} rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200">Commands</h2>
                <button onClick={() => setShowCommandsDialog(false)} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300">
                  <X size={18} />
                </button>
              </div>
              <CommandsPanel toolCalls={toolCalls} workspaceIds={activeWorkspaces.map(w => w.id)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── git dialog content ──

type GitTabId = "overview" | "workspaces";

function GitContent({ workspaces, planExecId }: { workspaces: WorkspaceSummary[]; planExecId: string | null }) {
  const [activeTab, setActiveTab] = useState<GitTabId>("overview");
  const [gitData, setGitData] = useState<{ branch?: string; dirty?: boolean; log?: string; error?: string }>({});
  const [loading, setLoading] = useState(true);
  // Per-workspace git diff cache
  const [wsDiffs, setWsDiffs] = useState<Record<string, GitFilePatch[]>>({});
  const [wsDiffsLoading, setWsDiffsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGitData().then(data => { if (!cancelled) { setGitData(data); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Fetch git diff patches for completed workspaces
  useEffect(() => {
    if (activeTab !== "workspaces" || !planExecId) return;
    const completedWorkspaces = workspaces.filter(w => w.stage === "complete");
    if (completedWorkspaces.length === 0) return;

    setWsDiffsLoading(true);
    const fetchPromises = completedWorkspaces.map(async ws => {
      try {
        const r = await fetch(`/api/projects/_/plans/${planExecId}/workspaces/${ws.id}/git-diff?format=patch`);
        const data = await r.json();
        return { wsId: ws.id, patches: data.patches ?? [] };
      } catch {
        return { wsId: ws.id, patches: [] };
      }
    });

    Promise.all(fetchPromises).then(results => {
      const diffMap: Record<string, GitFilePatch[]> = {};
      for (const r of results) {
        diffMap[r.wsId] = r.patches;
      }
      setWsDiffs(diffMap);
      setWsDiffsLoading(false);
    });
  }, [activeTab, planExecId, workspaces]);

  if (loading) {
    return <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500 py-8 justify-center"><Loader2 size={14} className="animate-spin" /> Loading git data...</div>;
  }

  const tabs: { id: GitTabId; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "workspaces", label: "Workspace commits" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[#E8E6E1] dark:border-[#333] mb-4 shrink-0">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
              activeTab === tab.id
                ? "bg-[#EBF2FF] dark:bg-[#1A2A44] text-blue-700 dark:text-blue-300 border-b-2 border-blue-500 dark:border-blue-400"
                : "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
            }`}
          >{tab.label}</button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-4 text-xs text-stone-600 dark:text-stone-400 overflow-y-auto">
          {gitData.error ? (
            <div className="flex items-center justify-center h-16 text-xs text-stone-400 dark:text-stone-500">
              Git data unavailable: {gitData.error}
            </div>
          ) : (
            <>
              <div className="flex gap-4">
                <div><span className="text-stone-400 dark:text-stone-500">Branch:</span> <span className="font-mono text-stone-800 dark:text-stone-200">{gitData.branch}</span></div>
                <div><span className="text-stone-400 dark:text-stone-500">Dirty:</span> <span className={gitData.dirty ? "text-amber-600 dark:text-amber-400 font-medium" : "text-emerald-600 dark:text-emerald-400"}>{gitData.dirty ? "Yes" : "No"}</span></div>
              </div>
              <div>
                <span className="text-stone-400 dark:text-stone-500 block mb-1">Recent commits:</span>
                <pre className="bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-2 font-mono text-xs text-stone-700 dark:text-stone-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {gitData.log || "No commits"}
                </pre>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "workspaces" && (
        <div className="flex flex-col gap-3 text-xs overflow-y-auto">
          {wsDiffsLoading && (
            <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500 py-4 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading workspace diffs...
            </div>
          )}
          {!wsDiffsLoading && workspaces.filter(w => w.stage === "complete").length === 0 && (
            <div className="flex items-center justify-center h-16 text-stone-400 dark:text-stone-500">
              No completed workspaces yet
            </div>
          )}
          {!wsDiffsLoading && workspaces.filter(w => w.stage === "complete").map(ws => {
            const changes = wsDiffs[ws.id] ?? [];
            return (
              <div key={ws.id} className="border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
                <div className="bg-stone-100 dark:bg-[#222] px-3 py-2 font-semibold text-stone-600 dark:text-stone-400 flex items-center gap-2">
                  <span>{ws.id}</span>
                  <span className="text-stone-400 dark:text-stone-500 font-normal">({changes.length} file{changes.length !== 1 ? "s" : ""} changed)</span>
                </div>
                {changes.length > 0 ? (
                  <DiffViewer patches={changes} />
                ) : (
                  <div className="px-3 py-3 text-stone-400 dark:text-stone-500 italic">No uncommitted changes</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

async function fetchGitData(): Promise<{ branch?: string; dirty?: boolean; log?: string; error?: string }> {
  try {
    const r = await fetch("/api/git-info");
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: String(e) };
  }
}
