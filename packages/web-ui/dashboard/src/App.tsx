import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Pause,
  Square,
  Settings,
  Upload,
  GitBranch,
  Terminal,
  ScrollText,
  AlertCircle,
  Plus,
  History,
  LayoutGrid,
  X,
  Cpu,
  Loader2,
  Activity,
  Filter,
  DollarSign,
  Zap,
} from "lucide-react";
import type { WorkerInfo, WorkspaceSummary } from "./types";
import { usePlanState } from "./hooks/usePlanState";
import { useJournalStream } from "./hooks/useJournalStream";
import { useProjects } from "./hooks/useProjects";
import { usePlanExecutions, usePlanExecutionDetail, usePlanStats } from "./hooks/usePlanExecutions";
import { usePlanEvents } from "./hooks/usePlanEvents";
import { useSettings } from "./hooks/useSettings";
import { PlanSummary } from "./components/PlanSummary";
import { QueuePanel } from "./components/QueuePanel";
import { WorkerDetail } from "./components/WorkerDetail";
import { OpenProjectDialog } from "./components/OpenProjectDialog";
import { PlanUploadDialog } from "./components/PlanUploadDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExecutionLogViewer } from "./components/ExecutionLogViewer";
import { WarningBanner } from "./components/WarningBanner";
import { StatusBadge } from "./components/StatusBadge";
import { IconBtn, LabeledBtn } from "./components/IconBtn";
import { SectionHeader, Divider } from "./components/SectionHeader";
import { ProjectItem } from "./components/ProjectItem";
import { HistoryItem } from "./components/HistoryItem";
import { StatCard } from "./components/StatCard";
import { EventLine } from "./components/EventLine";
import { formatTokens, formatCost, formatPercent } from "./utils/format";

const API_BASE = "";

async function sendControlCommand(
  action: "pause" | "stop" | "cancel" | "resume",
  planExecId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    let url: string;
    let body: Record<string, unknown>;
    if (planExecId) {
      url = `${API_BASE}/api/executions/${planExecId}/control`;
      body = { action };
    } else {
      url = `${API_BASE}/api/control`;
      body = { action, requestedAt: new Date().toISOString(), requestedBy: "dashboard" };
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function WorkerCard({
  worker,
  workspace,
  active,
  onClick,
}: {
  worker: WorkerInfo;
  workspace?: WorkspaceSummary;
  active: boolean;
  onClick: () => void;
}) {
  const stageIconMap: Record<string, React.ElementType> = {
    active:   LayoutGrid,
    pending:  LayoutGrid,
    blocked:  Pause,
    complete: LayoutGrid,
    failed:   AlertCircle,
  };
  const stageColorMap: Record<string, string> = {
    active:   "text-emerald-600",
    pending:  "text-stone-400",
    blocked:  "text-amber-600",
    complete: "text-blue-600",
    failed:   "text-red-600",
  };
  const stageBgMap: Record<string, string> = {
    active:   "bg-emerald-50",
    pending:  "bg-stone-100",
    blocked:  "bg-amber-50",
    complete: "bg-blue-50",
    failed:   "bg-red-50",
  };

  const Icon = stageIconMap[worker.stage] ?? LayoutGrid;
  const clr  = stageColorMap[worker.stage] ?? "text-stone-400";
  const bg   = stageBgMap[worker.stage] ?? "bg-stone-100";

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-150 border-b border-[#E8E6E1] last:border-b-0 ${
        active ? "bg-[#EBF2FF]" : "hover:bg-stone-50"
      }`}
    >
      <span className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 ${bg}`}>
        <Icon size={14} strokeWidth={1.8} className={clr} />
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium truncate ${active ? "text-blue-800" : "text-stone-700"}`}>
          {worker.id}
        </p>
        <p className="text-[10px] text-stone-400 mt-0.5">
          attempt {worker.attempt ?? 1}
          {workspace?.stage ? ` \u00B7 ${workspace.stage}` : ""}
        </p>
      </div>
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${clr} ${bg}`}>
        {worker.stage}
      </span>
    </button>
  );
}

function QueueStrip({ queue }: {
  queue: { pending: number; active: number; blocked: number; complete: number; failed: number }
}) {
  const items = [
    { label: "Pending",  value: queue.pending,  color: "text-stone-500" },
    { label: "Active",   value: queue.active,   color: "text-emerald-600" },
    { label: "Blocked",  value: queue.blocked,  color: "text-amber-600" },
    { label: "Done",     value: queue.complete, color: "text-blue-600" },
    { label: "Failed",   value: queue.failed,   color: "text-red-600" },
  ];
  return (
    <div className="flex border-b border-[#E8E6E1] bg-white divide-x divide-[#E8E6E1]">
      {items.map((it) => (
        <div key={it.label} className="flex-1 flex flex-col items-center py-2.5 gap-0.5">
          <span className={`text-sm font-semibold ${it.color}`}>{it.value}</span>
          <span className="text-[9px] uppercase tracking-widest text-stone-400 font-medium">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function App() {
  const { projects, isLoading: projectsLoading, createProject } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedPlanExecId, setSelectedPlanExecId] = useState<string | null>(null);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [showPlanUploadDialog, setShowPlanUploadDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showExecutionLog, setShowExecutionLog] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState<"left" | "right" | null>(null);

  // Auto-select first project
  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  // Multi-project queries
  const { data: executions = [], isLoading: executionsLoading } = usePlanExecutions(selectedProjectId);
  const { data: executionDetail } = usePlanExecutionDetail(selectedProjectId, selectedPlanExecId);
  const { data: planStats } = usePlanStats(selectedProjectId, selectedPlanExecId);
  const { budgets: contextBudgets } = useSettings();
  const { events: planEvents } = usePlanEvents({ projectId: selectedProjectId, planExecId: selectedPlanExecId });

  // Auto-select execution
  useEffect(() => {
    if (!selectedPlanExecId && executions.length > 0) {
      const running = executions.find((e) => e.status === "running");
      setSelectedPlanExecId(running?.id ?? executions[0].id);
    }
  }, [executions, selectedPlanExecId]);

  // Legacy plan state queries — keep them running regardless
  const { data: legacyPlanState, isLoading: legacyLoading, workers: legacyWorkers, queue: legacyQueue } = usePlanState();
  const { events: legacyEvents } = useJournalStream();

  // Determine mode: legacy vs multi-project
  const hasProjects = projects.length > 0;
  const isLegacyMode = !hasProjects && !selectedProjectId;
  const isStartingUp = projectsLoading && !hasProjects;

  // Derive active data
  const activePlanStatus = isLegacyMode
    ? (legacyPlanState?.status ?? "unknown")
    : (executionDetail?.status ?? "unknown");
  const activeWorkspaces: WorkspaceSummary[] = isLegacyMode
    ? (legacyPlanState?.workspaces?.map((ws) => ({
        id: ws.workspaceId,
        stage: ws.stage,
        attempts: ws.attempts,
        error: ws.error ?? null,
        startedAt: ws.startedAt ?? null,
        completedAt: ws.completedAt ?? null,
      })) ?? [])
    : (executionDetail?.workspaces ?? []);
  const activeEvents = isLegacyMode ? legacyEvents : planEvents;

  const workers: WorkerInfo[] = isLegacyMode
    ? legacyWorkers
    : activeWorkspaces.map((ws) => ({
        id: ws.id,
        stage: ws.stage as WorkerInfo["stage"],
        attempt: ws.attempts,
        retries: 0,
      }));

  const queue = isLegacyMode
    ? legacyQueue
    : {
        pending:  activeWorkspaces.filter((w) => w.stage === "pending").length,
        active:   activeWorkspaces.filter((w) => w.stage === "active").length,
        blocked:  activeWorkspaces.filter((w) => w.stage === "blocked").length,
        complete: activeWorkspaces.filter((w) => w.stage === "complete").length,
        failed:   activeWorkspaces.filter((w) => w.stage === "failed").length,
      };

  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<"all" | "errors">("all");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState(0);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedWorker = workers.find((w) => w.id === selectedWorkerId);
  const selectedWorkspace = activeWorkspaces.find((w) => w.id === selectedWorkerId);

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

  const handleSelectWorker = useCallback((id: string) => setSelectedWorkerId(id), []);
  const handleFilterChange = useCallback((f: "all" | "errors") => { setEventFilter(f); setFilterKey((k) => k + 1); }, []);
  const handleExecutionStarted = useCallback((id: string) => {
    setSelectedPlanExecId(id);
    setShowPlanUploadDialog(false);
  }, []);

  const handleUploadPlan = useCallback(() => {
    if (hasProjects) {
      setShowPlanUploadDialog(true);
    } else {
      // In legacy mode, auto-create a project first then open upload dialog
      setShowProjectDialog(true);
    }
  }, [hasProjects]);

  useEffect(() => { setSelectedWorkerId(null); }, [selectedPlanExecId]);

  // Loading state — show only on initial load before we know anything
  if (isStartingUp) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-[#F7F6F3]">
        <div className="flex items-center gap-2.5 text-stone-400 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  const filteredEvents = eventFilter === "errors"
    ? activeEvents.filter((e: any) => e.type === "error" || e.level === "error")
    : activeEvents;

  const noExecutionPlaceholder = !isLegacyMode && !executionDetail && hasProjects;

  return (
    <div className="w-full h-screen flex flex-col bg-[#F7F6F3] overflow-hidden font-['DM_Sans',ui-sans-serif,system-ui,sans-serif]">

      {/* ── topbar ─────────────────────────────────────────────────────────── */}
      <header className="h-12 shrink-0 bg-white border-b border-[#E8E6E1] flex items-center px-3 gap-2">
        <button
          className="md:hidden flex items-center justify-center h-8 w-8 rounded-lg text-stone-500 hover:bg-stone-100"
          onClick={() => setMobileNav(mobileNav === "left" ? null : "left")}
          aria-label="Toggle navigation"
        >
          <LayoutGrid size={15} strokeWidth={1.8} />
        </button>

        <button
          className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          onClick={() => setLeftOpen((o) => !o)}
          aria-label={leftOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {leftOpen ? <PanelLeftClose size={15} strokeWidth={1.8} /> : <PanelLeftOpen size={15} strokeWidth={1.8} />}
        </button>

        <div className="flex items-center gap-2 mx-1">
          <span className="text-[13px] font-semibold text-stone-800 tracking-tight">Planner</span>
          {activePlanStatus !== "unknown" && <StatusBadge status={activePlanStatus} />}
          {executionDetail?.title && (
            <span className="hidden sm:inline text-xs text-stone-400 truncate max-w-[200px]">
              &mdash; {executionDetail.title}
            </span>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <LabeledBtn icon={Play}   label="Resume" onClick={() => handleControl("resume")} accent />
          <LabeledBtn icon={Pause}  label="Pause"  onClick={() => handleControl("pause")} />
          <LabeledBtn icon={Square} label="Stop"   onClick={() => handleControl("stop")}  danger />
          <div className="w-px h-5 bg-[#E8E6E1] mx-1 hidden sm:block" />
          <IconBtn icon={Settings} label="Settings" onClick={() => setShowSettingsDialog(true)} variant="ghost" />
        </div>

        <button
          className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
          onClick={() => setRightOpen((o) => !o)}
          aria-label={rightOpen ? "Collapse events" : "Expand events"}
        >
          {rightOpen ? <PanelRightClose size={15} strokeWidth={1.8} /> : <PanelRightOpen size={15} strokeWidth={1.8} />}
        </button>
      </header>

      {/* ── error banner ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {errorBanner && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-center gap-2 text-xs text-red-700 shrink-0"
          >
            <AlertCircle size={13} strokeWidth={2} className="shrink-0" />
            <span className="flex-1">{errorBanner}</span>
            <button onClick={() => setErrorBanner(null)} className="text-red-400 hover:text-red-600">
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* mobile nav overlay */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-30 md:hidden"
              onClick={() => setMobileNav(null)}
            />
          )}
        </AnimatePresence>

        {/* ── left sidebar ───────────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {(leftOpen || mobileNav === "left") && (
            <motion.aside
              key="left"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 bg-white border-r border-[#E8E6E1] flex flex-col overflow-hidden
                          md:relative md:z-auto
                          ${mobileNav === "left" ? "absolute left-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              <SectionHeader title="Projects" />
              <div className="px-2 pb-1 flex flex-col gap-0.5">
                {projects.map((p) => (
                  <ProjectItem
                    key={p.id}
                    name={p.name ?? p.id}
                    active={p.id === selectedProjectId}
                    onClick={() => { setSelectedProjectId(p.id); setSelectedPlanExecId(null); setMobileNav(null); }}
                  />
                ))}
                <button
                  onClick={() => setShowProjectDialog(true)}
                  className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-all"
                >
                  <Plus size={13} strokeWidth={2} />
                  Open project...
                </button>
              </div>

              <Divider />

              <SectionHeader title="History" />
              <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
                {executionsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-stone-400">
                    <Loader2 size={11} className="animate-spin" /> Loading...
                  </div>
                ) : executions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-stone-400">No runs yet</p>
                ) : (
                  executions.map((ex) => (
                    <HistoryItem
                      key={ex.id}
                      exec={ex}
                      active={ex.id === selectedPlanExecId}
                      onClick={() => { setSelectedPlanExecId(ex.id); setMobileNav(null); }}
                    />
                  ))
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── center ─────────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">

          {/* toolbar */}
          <div className="shrink-0 bg-white border-b border-[#E8E6E1] flex items-center gap-1.5 px-3 h-11">
            <LabeledBtn icon={Upload} label="Upload plan" onClick={handleUploadPlan} accent />
            <div className="w-px h-5 bg-[#E8E6E1] mx-0.5" />
            <LabeledBtn icon={GitBranch} label="Git" onClick={() => {}} />
            <LabeledBtn icon={Terminal} label="Commands" onClick={() => {}} />
            {selectedPlanExecId && (
              <LabeledBtn icon={ScrollText} label="Exec log" onClick={() => setShowExecutionLog(true)} />
            )}
          </div>

          {/* warning banner */}
          {!isLegacyMode && (
            <WarningBanner
              executionDetail={executionDetail ?? null}
              workers={activeWorkspaces}
              events={activeEvents as any}
              burnRatePerMin={planStats?.burn_rate_per_min}
              contextBudgets={contextBudgets}
            />
          )}

          {/* stats + queue — multi-project mode */}
          {!isLegacyMode && executionDetail && (
            <>
              <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-[#F7F6F3] border-b border-[#E8E6E1]">
                <StatCard icon={DollarSign} label="Est. cost"  value={formatCost(planStats?.estimated_cost_usd)} />
                <StatCard icon={Cpu}        label="Tokens in"  value={formatTokens(planStats?.total_tokens_in)} accent />
                <StatCard icon={Activity}   label="Cache hit"  value={formatPercent(planStats?.cache_hit_rate)} />
                <StatCard icon={Zap}        label="Burn rate"
                  value={planStats?.burn_rate_per_min != null ? `${planStats.burn_rate_per_min.toFixed(0)}/m` : "\u2014"} />
              </div>
              <QueueStrip queue={queue} />
            </>
          )}

          {/* stats + queue — legacy mode */}
          {isLegacyMode && legacyPlanState && (
            <>
              <div className="shrink-0 grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-[#F7F6F3] border-b border-[#E8E6E1]">
                <StatCard icon={History} label="Workspaces" value={String(legacyPlanState.workspaces?.length ?? 0)} />
                <StatCard icon={Activity} label="Status" value={legacyPlanState.status} accent={legacyPlanState.status === "running"} />
              </div>
              <QueueStrip queue={queue} />
            </>
          )}

          {/* legacy plan summary card */}
          {isLegacyMode && legacyPlanState && (
            <div className="flex gap-4 p-4 border-b border-[#E8E6E1] bg-white">
              <div className="w-64"><PlanSummary planState={legacyPlanState} /></div>
              <div className="w-48"><QueuePanel queue={queue} /></div>
            </div>
          )}

          {/* no execution placeholder (multi-project mode only) */}
          {noExecutionPlaceholder && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 border-b border-[#E8E6E1] text-stone-400">
              <History size={32} strokeWidth={1.2} />
              <p className="text-sm">No execution selected</p>
              <LabeledBtn icon={Upload} label="Upload a plan" onClick={() => setShowPlanUploadDialog(true)} accent />
            </div>
          )}

          {/* no data / first-run placeholder (legacy mode, no plan state) */}
          {isLegacyMode && !legacyPlanState && !legacyLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-stone-400 p-8">
              <LayoutGrid size={48} strokeWidth={1} className="text-stone-300" />
              <p className="text-sm text-stone-500">No plan execution data found</p>
              <p className="text-xs text-stone-400 max-w-md text-center">
                There is no plan-state.json in the .pi directory, or the server does not have a running plan.
                Upload a plan to get started.
              </p>
              <div className="flex gap-2 mt-2">
                <LabeledBtn icon={Upload} label="Upload plan" onClick={handleUploadPlan} accent />
                <LabeledBtn icon={Plus} label="Create project" onClick={() => setShowProjectDialog(true)} />
              </div>
            </div>
          )}

          {/* loading for legacy */}
          {isLegacyMode && legacyLoading && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-stone-400" />
            </div>
          )}

          {/* worker list */}
          {workers.length > 0 && (
            <div className="shrink-0 max-h-60 overflow-y-auto border-b border-[#E8E6E1] bg-white">
              {workers.map((w) => (
                <WorkerCard
                  key={w.id}
                  worker={w}
                  workspace={activeWorkspaces.find((ws) => ws.id === w.id)}
                  active={w.id === selectedWorkerId}
                  onClick={() => handleSelectWorker(w.id)}
                />
              ))}
            </div>
          )}

          {/* worker detail */}
          <div className="flex-1 min-h-0">
            {selectedWorker ? (
              <WorkerDetail
                worker={selectedWorker}
                planExecId={selectedPlanExecId}
                workspace={selectedWorkspace}
              />
            ) : workers.length > 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-stone-400">
                <Cpu size={28} strokeWidth={1.2} />
                <p className="text-xs">Select a workspace to view logs</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── right sidebar ──────────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {(rightOpen || mobileNav === "right") && (
            <motion.aside
              key="right"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className={`shrink-0 bg-white border-l border-[#E8E6E1] flex flex-col overflow-hidden
                          md:relative md:z-auto
                          ${mobileNav === "right" ? "absolute right-0 top-0 bottom-0 z-40 shadow-lg" : ""}`}
            >
              <div className="shrink-0 flex items-center justify-between px-4 h-10 border-b border-[#E8E6E1]">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Events</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEventFilter("all")}
                    className={`h-6 px-2 rounded text-[10px] font-medium transition-colors ${
                      eventFilter === "all" ? "bg-stone-100 text-stone-700" : "text-stone-400 hover:text-stone-600"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setEventFilter("errors")}
                    className={`h-6 px-2 rounded text-[10px] font-medium transition-colors flex items-center gap-1 ${
                      eventFilter === "errors" ? "bg-red-50 text-red-700" : "text-stone-400 hover:text-red-600"
                    }`}
                  >
                    <Filter size={9} />
                    Errors
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-300">
                    <Activity size={20} strokeWidth={1.2} />
                    <p className="text-xs">No events</p>
                  </div>
                ) : (
                  filteredEvents.map((ev: any, i: number) => (
                    <EventLine key={ev.id ?? i} event={ev} />
                  ))
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* ── dialogs ──────────────────────────────────────────────────────── */}
      <OpenProjectDialog
        isOpen={showProjectDialog}
        onClose={() => setShowProjectDialog(false)}
        onCreate={createProject}
        projects={projects}
        onSelectExisting={(id) => {
          setSelectedProjectId(id);
          setSelectedPlanExecId(null);
          // If a project was just selected, show the upload dialog next
          if (!selectedProjectId && showProjectDialog) {
            setShowPlanUploadDialog(true);
          }
        }}
      />

      {/* Upload dialog — requires a project, but show it if we have one */}
      {showPlanUploadDialog && (selectedProjectId || projects.length > 0) && (
        <PlanUploadDialog
          isOpen={showPlanUploadDialog}
          onClose={() => setShowPlanUploadDialog(false)}
          projectId={selectedProjectId ?? projects[0].id}
          onExecutionStarted={handleExecutionStarted}
        />
      )}

      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        project={selectedProjectId ? projects.find((p) => p.id === selectedProjectId) ?? null : null}
      />

      <ExecutionLogViewer
        planExecId={selectedPlanExecId}
        isOpen={showExecutionLog}
        onClose={() => setShowExecutionLog(false)}
      />
    </div>
  );
}
