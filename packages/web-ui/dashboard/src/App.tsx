import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Track first mount for debug logging
let _appMounted = false;
import { AnimatePresence, motion } from "framer-motion";
import {
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Play, Pause, Square, Settings, Upload, GitBranch, Terminal, ScrollText,
  AlertCircle, Plus, History, LayoutGrid, X, Cpu, Loader2, Activity,
  Filter, DollarSign, Zap, Bot, Archive, Bell, ListOrdered,
  AlertTriangle, BarChart3, Lightbulb, RefreshCw, Package, BookOpen,
  Sliders,
} from "lucide-react";
import type { WorkerInfo, WorkspaceSummary, GitFilePatch } from "./types";
import { usePlanState } from "./hooks/usePlanState";
import { useJournalStream } from "./hooks/useJournalStream";
import { useProjects } from "./hooks/useProjects";
import { usePlanExecutions, usePlanExecutionDetail, usePlanStats } from "./hooks/usePlanExecutions";
import { usePlanEvents } from "./hooks/usePlanEvents";
import { useToolCallEvents } from "./hooks/useToolCallEvents";
import { useSettings } from "./hooks/useSettings";
import { useIntegrationQueueStatus } from "./hooks/useScaleStatus";
import { useBatchPlan } from "./hooks/useBatchPlan";
import { useTheme } from "./hooks/useTheme";
import { PlanSummary } from "./components/PlanSummary";
import { QueuePanel } from "./components/QueuePanel";
import { WorkerDetail } from "./components/WorkerDetail";
import { DiffViewer } from "./components/DiffViewer";
import { OpenProjectDialog } from "./components/OpenProjectDialog";
import { PlanUploadDialog } from "./components/PlanUploadDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExecutionLogViewer } from "./components/ExecutionLogViewer";
import { WarningBanner } from "./components/WarningBanner";
import { RerunDialog } from "./components/RerunDialog";
import { StatusBadge } from "./components/StatusBadge";
import { IconBtn, LabeledBtn } from "./components/IconBtn";
import { SectionHeader, Divider } from "./components/SectionHeader";
import { ProjectItem } from "./components/ProjectItem";
import { HistoryItem } from "./components/HistoryItem";
import { StatCard } from "./components/StatCard";
import { EventLine } from "./components/EventLine";
import { ChatPanel, type ContextRef } from "./components/ChatPanel";
import { CommandsPanel } from "./components/CommandsPanel";
import { ArtifactBrowser } from "./components/ArtifactBrowser";
import { formatTokens, formatCost, formatPercent, formatPercentOrUnknown } from "./utils/format";
import { PlanQueueTab } from "./components/PlanQueueTab";
import { LiveLogTerminal } from "./components/LiveLogTerminal";
import { SchedulerStatusPanel } from "./components/SchedulerStatusPanel";
import { PlanSummaryPanel } from "./components/PlanSummaryPanel";
import { ScaleOverviewStrip } from "./components/ScaleOverviewStrip";
import { ScaleCockpitPanel } from "./components/ScaleCockpitPanel";
import { BatchOSDashboard } from "./components/BatchOSDashboard";
import { LeadAgentDashboard } from "./components/LeadAgentDashboard";
import { AutonomyCenter } from "./features/autonomy/AutonomyCenter";
import { ExtensionsManager } from "./components/ExtensionsManager";
import { SkillsManager } from "./components/SkillsManager";
import { LeftNav, PlatformSectionHeader, type PlatformNavItem } from "./components/LeftNav";
import { RegistrySettings } from "./features/settings/RegistrySettings";
import { PlanIntakePanel } from "./features/plan-intake/PlanIntakePanel";
import { MemoryCockpit } from "./features/memory/MemoryCockpit";
import { PolicyAuditCenter } from "./features/policy-audit/PolicyAuditCenter";

const API_BASE = "";

async function sendControlCommand(action: "pause" | "stop" | "cancel" | "resume", planExecId: string | null) {
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
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── sub-components ───────────────────────────────────────────────────────────

function WorkerCard({ worker, workspace, active, onClick }: {
  worker: WorkerInfo; workspace?: WorkspaceSummary; active: boolean; onClick: () => void;
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

// ─── main app ─────────────────────────────────────────────────────────────────

export function App() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  console.log("[App] useTheme resolved, theme=", theme);
  const { projects, isLoading: projectsLoading, createProject } = useProjects();
  console.log("[App] useProjects resolved, loading=", projectsLoading, "count=", projects.length);
  const hasProjects = projects.length > 0;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPlanExecId, setSelectedPlanExecId] = useState<string | null>(null);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [showPlanUploadDialog, setShowPlanUploadDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [showExecutionLog, setShowExecutionLog] = useState(false);
  const [showGitDialog, setShowGitDialog] = useState(false);
  const [showCommandsDialog, setShowCommandsDialog] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const [showScaleCockpit, setShowScaleCockpit] = useState(false);
  const [showBatchOS, setShowBatchOS] = useState(false);
  const [showAutonomy, setShowAutonomy] = useState(false);
  const [showLeadAgent, setShowLeadAgent] = useState(false);
  const [showExtensions, setShowExtensions] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showPlanIntake, setShowPlanIntake] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showPolicyAudit, setShowPolicyAudit] = useState(false);
  const [showRegistrySettings, setShowRegistrySettings] = useState(false);
  const [platformActiveItem, setPlatformActiveItem] = useState<PlatformNavItem | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState<"left" | "right" | null>(null);

  /** Left sidebar tab: "nav" = projects + history + platform */
  const [leftTab, setLeftTab] = useState<"nav" | "queue">("nav");

  /** Navigate to a Platform feature, toggling it on/off and coordinating toolbar buttons. */
  const navigateToPlatform = useCallback((item: PlatformNavItem) => {
    // Turn off all platform-related screens
    setShowAutonomy(false);
    setShowPlanIntake(false);
    setShowExtensions(false);
    setShowSkills(false);
    setShowMemory(false);
    setShowPolicyAudit(false);
    setShowRegistrySettings(false);
    setShowScaleCockpit(false);
    setShowLeadAgent(false);
    setShowBatchOS(false);
    // If clicking the same item, toggle off; otherwise activate
    if (platformActiveItem !== item) {
      setPlatformActiveItem(item);
      switch (item) {
        case "autonomy": setShowAutonomy(true); break;
        case "plan_intake": setShowPlanIntake(true); break;
        case "extensions_skills": setShowExtensions(true); break;
        case "memory": setShowMemory(true); break;
        case "policy_audit": setShowPolicyAudit(true); break;
        case "registry_settings": setShowRegistrySettings(true); break;
      }
    } else {
      setPlatformActiveItem(null);
    }
    setMobileNav(null);
  }, [platformActiveItem]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  const { data: executions = [], isLoading: executionsLoading } = usePlanExecutions(selectedProjectId);
  const { data: executionDetail } = usePlanExecutionDetail(selectedProjectId, selectedPlanExecId);
  const { data: planStats } = usePlanStats(selectedProjectId, selectedPlanExecId);
  const { budgets: contextBudgets } = useSettings();
  const { events: planEvents } = usePlanEvents({ projectId: selectedProjectId, planExecId: selectedPlanExecId });
  const { toolCalls } = useToolCallEvents({ projectId: selectedProjectId, planExecId: selectedPlanExecId });
  const { data: integrationQueueData } = useIntegrationQueueStatus(hasProjects);
  const { data: batchPlanData } = useBatchPlan(selectedProjectId, selectedPlanExecId, showBatchOS);

  useEffect(() => {
    if (!selectedPlanExecId && executions.length > 0) {
      const running = executions.find(e => e.status === "running");
      setSelectedPlanExecId(running?.id ?? executions[0].id);
    }
  }, [executions, selectedPlanExecId]);

  const { data: legacyPlanState, isLoading: legacyLoading, workers: legacyWorkers, queue: legacyQueue } = usePlanState(!hasProjects);
  const { events: legacyEvents } = useJournalStream(!hasProjects);
  const isLegacyMode = !hasProjects && !selectedProjectId;
  const isStartingUp = projectsLoading && !hasProjects;

  const activePlanStatus = isLegacyMode
    ? (legacyPlanState?.status ?? "unknown")
    : (executionDetail?.status ?? "unknown");

  const canResume = activePlanStatus === "paused";
  const canPause = activePlanStatus === "running";
  const canStop = activePlanStatus === "running" || activePlanStatus === "paused";
  const canRerun = activePlanStatus === "failed" || activePlanStatus === "stopped" || activePlanStatus === "cancelled";
  const controlDisabled = selectedPlanExecId === null;

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
    ...(selectedPlanExecId ? [{ kind: "run" as const, id: selectedPlanExecId, label: executionDetail?.title ?? `Run ${selectedPlanExecId.slice(0, 6)}` }] : []),
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
    const res = await sendControlCommand(action, selectedPlanExecId);
    if (!res.success) showError(res.error || `Failed to ${action}`);
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
    setShowPlanUploadDialog(false);
  }, []);

  const handlePlanEnqueued = useCallback(() => {
    // Invalidate the queue query so the queue tab refreshes immediately
    if (selectedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["plan-queue", selectedProjectId] });
    }
  }, [queryClient, selectedProjectId]);

  useEffect(() => { setSelectedWorkerId(null); }, [selectedPlanExecId]);

  const filteredEvents = eventFilter === "errors"
    ? activeEvents.filter((e: any) => e.type === "error" || e.level === "error")
    : activeEvents;



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
      <header className={`h-12 shrink-0 ${SURF} border-b ${BORD} flex items-center px-3 gap-2 z-10`}>
        <button className="md:hidden flex items-center justify-center h-8 w-8 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
          onClick={() => setMobileNav(mobileNav === "left" ? null : "left")} aria-label="Toggle navigation">
          <LayoutGrid size={15} strokeWidth={1.8} />
        </button>
        <button className={`hidden md:flex items-center justify-center h-8 w-8 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
          onClick={() => setLeftOpen(o => !o)} aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"}>
          {leftOpen ? <PanelLeftClose size={15} strokeWidth={1.8} /> : <PanelLeftOpen size={15} strokeWidth={1.8} />}
        </button>
        <div className="flex items-center gap-2 mx-1 min-w-0">
          <span className={`text-[13px] font-semibold ${TXT} tracking-tight whitespace-nowrap`}>Planner</span>
          {activePlanStatus !== "unknown" && <StatusBadge status={activePlanStatus} />}
          {executionDetail?.title && (
            <span className={`hidden sm:inline text-xs ${MUT} truncate max-w-[200px]}`}>&mdash; {executionDetail.title}</span>
          )}
        </div>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1">
          <LabeledBtn icon={Play} label="Resume" onClick={() => handleControl("resume")} accent disabled={controlDisabled || !canResume} />
          <LabeledBtn icon={Pause} label="Pause" onClick={() => handleControl("pause")} disabled={controlDisabled || !canPause} />
          <LabeledBtn icon={Square} label="Stop" onClick={() => handleControl("stop")} danger disabled={controlDisabled || !canStop} />
          {selectedPlanExecId && canRerun && (
            <LabeledBtn icon={RefreshCw} label="Restart" onClick={() => setShowRerunDialog(true)} accent disabled={rerunning} />
          )}
          <IconBtn icon={Settings} label="Settings" onClick={() => setShowSettingsDialog(true)} variant="ghost" />
        </div>
        <button className={`hidden md:flex items-center justify-center h-8 w-8 rounded-lg ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
          onClick={() => setRightOpen(o => !o)} aria-label={rightOpen ? "Collapse events" : "Expand events"}>
          {rightOpen ? <PanelRightClose size={15} strokeWidth={1.8} /> : <PanelRightOpen size={15} strokeWidth={1.8} />}
        </button>
      </header>

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

        {/* ── left sidebar ── */}
        <AnimatePresence initial={false}>
          {(leftOpen || mobileNav === "left") && (
            <motion.aside key="left"
              initial={{ width: 0, opacity: 0 }} animate={{ width: 320, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 ${SURF} border-r ${BORD} flex flex-col overflow-hidden
                md:relative md:z-auto ${mobileNav === "left" ? "absolute left-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              {/* Left sidebar tab bar */}
              <div className={`shrink-0 flex items-center border-b ${BORD}`}>
                <button
                  onClick={() => setLeftTab("nav")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
                    leftTab === "nav"
                      ? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
                      : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
                  }`}
                >
                  <LayoutGrid size={12} strokeWidth={1.8} /> Browse
                </button>
                <button
                  onClick={() => setLeftTab("queue")}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
                    leftTab === "queue"
                      ? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
                      : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
                  }`}
                >
                  <ListOrdered size={12} strokeWidth={1.8} /> Queue
                </button>

              </div>

              {/* Nav tab content */}
              {leftTab === "nav" && (
                <>
                  <SectionHeader title="Projects" />
                  <div className="px-2 pb-1 flex flex-col gap-0.5">
                    {projects.map(p => (
                      <ProjectItem key={p.id} name={p.name ?? p.id} active={p.id === selectedProjectId}
                        onClick={() => { setSelectedProjectId(p.id); setSelectedPlanExecId(null); setMobileNav(null); }} />
                    ))}
                    <button onClick={() => setShowProjectDialog(true)}
                      className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}>
                      <Plus size={13} strokeWidth={2} /> Open project...
                    </button>
                  </div>
                  <Divider />
                  <SectionHeader title="History" />
                  <div className={`flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5`}>
                    {executionsLoading ? (
                      <div className={`flex items-center gap-2 px-3 py-2 text-xs ${MUT}`}><Loader2 size={11} className="animate-spin" /> Loading...</div>
                    ) : executions.length === 0 ? (
                      <p className={`px-3 py-2 text-xs ${MUT}`}>No runs yet</p>
                    ) : (
                      executions.map(ex => (
                        <HistoryItem key={ex.id} exec={ex} active={ex.id === selectedPlanExecId}
                          onClick={() => { setSelectedPlanExecId(ex.id); setMobileNav(null); }} />
                      ))
                    )}
                  </div>
                  <Divider />
                  <PlatformSectionHeader title="Platform" />
                  <div className="flex flex-col gap-0.5 overflow-y-auto">
                    <LeftNav
                      activeItem={platformActiveItem}
                      onNavigate={navigateToPlatform}
                    />
                  </div>
                </>
              )}

              {/* Queue tab content */}
              {leftTab === "queue" && (
                <PlanQueueTab projectId={selectedProjectId} />
              )}


            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── center column ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* toolbar */}
          <div className={`shrink-0 ${SURF} border-b ${BORD} flex items-center gap-1.5 px-3 h-11`}>
            <LabeledBtn icon={Upload} label="Upload plan" onClick={handleUploadPlan} accent />
            <div className={`w-px h-5 ${BORD} mx-0.5`} />
            <LabeledBtn icon={GitBranch} label="Git" onClick={() => setShowGitDialog(true)} />
            <LabeledBtn icon={Terminal} label="Commands" onClick={() => setShowCommandsDialog(true)} />
            <LabeledBtn icon={Bot} label="Chat" onClick={() => setShowChat(o => !o)} accent={showChat} />
            <LabeledBtn icon={Archive} label="Artifacts" onClick={() => setShowArtifacts(o => !o)} accent={showArtifacts} />
            <LabeledBtn icon={Cpu} label="Scale" onClick={() => { setPlatformActiveItem(null); setShowScaleCockpit(o => !o); setShowBatchOS(false); setShowLeadAgent(false); setShowAutonomy(false); setShowPlanIntake(false); setShowMemory(false); setShowPolicyAudit(false); setShowRegistrySettings(false); setShowExtensions(false); setShowSkills(false); }} accent={showScaleCockpit} />
            <LabeledBtn icon={Lightbulb} label="Lead Agent" onClick={() => { setPlatformActiveItem(null); setShowLeadAgent(o => !o); setShowScaleCockpit(false); setShowBatchOS(false); setShowAutonomy(false); setShowPlanIntake(false); setShowMemory(false); setShowPolicyAudit(false); setShowRegistrySettings(false); setShowExtensions(false); setShowSkills(false); }} accent={showLeadAgent} />
            <LabeledBtn icon={BarChart3} label="Batch OS" onClick={() => { setPlatformActiveItem(null); setShowBatchOS(o => !o); setShowScaleCockpit(false); setShowLeadAgent(false); setShowAutonomy(false); setShowExtensions(false); setShowSkills(false); setShowPlanIntake(false); setShowMemory(false); setShowPolicyAudit(false); setShowRegistrySettings(false); }} accent={showBatchOS} />
            <LabeledBtn icon={Cpu} label="Autonomy" onClick={() => { navigateToPlatform('autonomy'); }} accent={showAutonomy} />
            <LabeledBtn icon={Package} label="Extensions" onClick={() => { navigateToPlatform('extensions_skills'); setShowExtensions(o => !o); setShowSkills(false); }} accent={showExtensions} />
            <LabeledBtn icon={BookOpen} label="Skills" onClick={() => { navigateToPlatform('extensions_skills'); setShowSkills(o => !o); setShowExtensions(false); }} accent={showSkills} />
            <LabeledBtn icon={Sliders} label="Registry" onClick={() => { navigateToPlatform('registry_settings'); }} accent={showRegistrySettings} />
            {selectedPlanExecId && <LabeledBtn icon={ScrollText} label="Exec log" onClick={() => setShowExecutionLog(true)} />}
          </div>

          {/* warning banner */}
          {!isLegacyMode && (
            <WarningBanner executionDetail={executionDetail ?? null} workers={activeWorkspaces}
              events={activeEvents as any} burnRatePerMin={planStats?.burn_rate_per_min} contextBudgets={contextBudgets} executionStats={planStats ?? null} />
          )}

          {/* stats */}
          {!isLegacyMode && executionDetail && (
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
              <div className={`shrink-0 p-3 border-b ${BORD}`}>
                <SchedulerStatusPanel stats={planStats ?? null} />
              </div>
            </>
          )}
          {isLegacyMode && legacyPlanState && (
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
            </>
          )}

          {/* placeholders */}
          {!isLegacyMode && !executionDetail && hasProjects && (
            <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${MUT}`}>
              <History size={32} strokeWidth={1.2} />
              <p className="text-sm">No execution selected</p>
              <LabeledBtn icon={Upload} label="Upload a plan" onClick={() => setShowPlanUploadDialog(true)} accent />
            </div>
          )}
          {isLegacyMode && !legacyPlanState && !legacyLoading && (
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
          {isLegacyMode && legacyLoading && (
            <div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-stone-400 dark:text-stone-500" /></div>
          )}

          {/* P11 feature panels — platform screens */}
          {showRegistrySettings ? (
            <RegistrySettings className="flex-1 min-h-0" />
          ) : showPlanIntake ? (
            <PlanIntakePanel className="flex-1 min-h-0" />
          ) : showMemory ? (
            <MemoryCockpit className="flex-1 min-h-0" />
          ) : showPolicyAudit ? (
            <PolicyAuditCenter className="flex-1 min-h-0" />
          ) : showExtensions ? (
            <ExtensionsManager className="flex-1 min-h-0" />
          ) : showSkills ? (
            <SkillsManager className="flex-1 min-h-0" />
          ) : showAutonomy ? (
            <AutonomyCenter className="flex-1 min-h-0" />
          ) : showLeadAgent ? (
            <LeadAgentDashboard className="flex-1 min-h-0" />
          ) : showScaleCockpit ? (
            <>
              <div className={`shrink-0 border-b ${BORD} ${SURF}`}>
                <ScaleOverviewStrip />
              </div>
              <ScaleCockpitPanel className="flex-1 min-h-0" />
            </>
          ) : showBatchOS ? (
            <BatchOSDashboard
              className="flex-1 min-h-0"
              planStatus={activePlanStatus}
              hasActiveExecution={selectedPlanExecId !== null}
              workspaces={activeWorkspaces}
              batchPlan={batchPlanData}
              onControl={(action) => handleControl(action)}
              onWorkspaceClick={(id) => setSelectedWorkerId(id)}
            />
          ) : (
            <>
              {/* worker list */}
              {workers.length > 0 && (
                <div className={`shrink-0 max-h-48 overflow-y-auto border-b ${BORD} ${SURF}`}>
                  {workers.map(w => (
                    <WorkerCard key={w.id} worker={w} workspace={activeWorkspaces.find(ws => ws.id === w.id)}
                      active={w.id === selectedWorkerId} onClick={() => setSelectedWorkerId(w.id)} />
                  ))}
                </div>
              )}

              {/* worker detail */}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {selectedWorker ? (
                  <WorkerDetail worker={selectedWorker} planExecId={selectedPlanExecId} workspace={selectedWorkspace} />
                ) : workers.length > 0 ? (
                  <LiveLogTerminal workers={workers} planEvents={activeEvents as any} className="h-full" />
                ) : null}
              </div>
            </>
          )}
        </div>

        {/* ── right sidebar (event feed + alerts) ── */}
        <AnimatePresence initial={false}>
          {(rightOpen || mobileNav === "right") && (
            <motion.aside key="right"
              initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden
                md:relative md:z-auto ${mobileNav === "right" ? "absolute right-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              {/* Section: Events */}
              <div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>Events</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEventFilter("all")}
                    className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${eventFilter === "all" ? "bg-stone-100 dark:bg-[#333] text-stone-700 dark:text-stone-200" : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`}`}>All</button>
                  <button onClick={() => setEventFilter("errors")}
                    className={`h-6 px-2 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${eventFilter === "errors" ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300" : `${MUT} hover:text-red-600 dark:hover:text-red-400`}`}>
                    <Filter size={9} /> Errors
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-300 dark:text-stone-600">
                    <Activity size={20} strokeWidth={1.2} />
                    <p className="text-xs">No events</p>
                  </div>
                ) : (
                  filteredEvents.map((ev: any, i: number) => <EventLine key={ev.id ?? i} event={ev} />)
                )}
              </div>

              {/* Section: Alerts */}
              <Divider />
              <div className={`shrink-0 flex items-center px-4 h-9 border-b ${BORD}`}>
                <Bell size={11} className={`${MUT} mr-1.5`} />
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>Alerts</span>
                {totalAlertIssues > 0 && (
                  <span className="ml-auto h-4 min-w-[16px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
                    {totalAlertIssues}
                  </span>
                )}
              </div>
              <div className="shrink-0 max-h-40 overflow-y-auto">
                {totalAlertIssues === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-1 text-stone-300 dark:text-stone-600">
                    <p className="text-[10px]">No alerts</p>
                  </div>
                ) : (
                  <>
                    {activeWorkspaces.filter(w => w.stage === "failed").map(w => (
                      <div key={`alert-failed-${w.id}`} className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-red-50/50 dark:bg-red-950/20`}>
                        <AlertCircle size={11} className="shrink-0 text-red-500" />
                        <span className="text-red-700 dark:text-red-300 font-medium truncate">{w.id}</span>
                        <span className={`ml-auto text-[10px] ${MUT} shrink-0`}>failed</span>
                      </div>
                    ))}
                    {conflictEntries.map((entry) => (
                      <div key={`alert-conflict-${entry.workspaceId}`} className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-amber-50/50 dark:bg-amber-950/20`}>
                        <AlertTriangle size={11} className="shrink-0 text-amber-500" />
                        <span className="text-amber-700 dark:text-amber-300 font-medium truncate">{entry.workspaceId}</span>
                        <span className={`ml-auto text-[10px] ${MUT} shrink-0`}>conflict</span>
                      </div>
                    ))}
                    {activeWorkspaces.filter(w => w.stage === "blocked").map(w => (
                      <div key={`alert-blocked-${w.id}`} className={`flex items-center gap-2 px-4 py-2 text-xs border-b ${BORD} bg-amber-50/50 dark:bg-amber-950/20`}>
                        <AlertCircle size={11} className="shrink-0 text-amber-500" />
                        <span className="text-amber-700 dark:text-amber-300 font-medium truncate">{w.id}</span>
                        <span className={`ml-auto text-[10px] ${MUT} shrink-0`}>blocked</span>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Section: Plan Summary (cleanup review) */}
              <div className="flex-1 min-h-0 overflow-y-auto">
              <Divider />
              <PlanSummaryPanel
                projectId={selectedProjectId}
                planExecId={selectedPlanExecId}
                />
              </div>
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
        onSelectExisting={(id) => { setSelectedProjectId(id); setSelectedPlanExecId(null); }} />
      {showPlanUploadDialog && (selectedProjectId || projects.length > 0) && (
        <PlanUploadDialog isOpen={showPlanUploadDialog} onClose={() => setShowPlanUploadDialog(false)}
          projectId={selectedProjectId ?? projects[0].id} onExecutionStarted={handleExecutionStarted}
          onEnqueued={handlePlanEnqueued} />
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
      <ChatPanel
        isOpen={showChat}
        projectId={selectedProjectId}
        onClose={() => setShowChat(false)}
        contextRefs={chatContextRefs}
        onContextRefClick={(ref) => {
          if (ref.kind === "run") {
            setSelectedPlanExecId(ref.id);
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


