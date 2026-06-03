/**
 * TaskRunSidebar — P42 V3 Left Sidebar
 *
 * Left sidebar with:
 * - Task -> run tree (hierarchical navigation)
 * - Completed tasks section
 * - Brain support section
 * - Platform support section
 * - Quick actions (Upload plan, New task)
 *
 * Replaces the old 4-tab sidebar with a single context tree.
 * No Browse/Queue/Chat tabs — just task/run hierarchy + secondary sections.
 */

import { useState, useCallback } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  FolderOpen,
  History,
  Inbox,
  LayoutGrid,
  Moon,
  Plus,
  Puzzle,
  Settings,
  Shield,
  Sunrise,
  Target,
  Upload,
} from "lucide-react";
import type { Project, PlanExecution, MultiPhaseTask } from "../../types";
import type { TopbarV3BrainMode } from "../topbar/TopbarV3";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskRunSidebarProps {
  /** Current project. */
  project: Project | null;
  /** All projects (for project switcher). */
  projects: Project[];
  /** Currently active navigation item ID. */
  activeItem: string | null;
  /** Navigate to a sidebar item. */
  onNavigate: (item: string) => void;
  /** Select a project. */
  onSelectProject: (projectId: string) => void;
  /** Create a new project. */
  onCreateProject: () => void;
  /** Upload a plan. */
  onUploadPlan: () => void;
  /** Create a new task. */
  onCreateTask: () => void;
  /** Open settings. */
  onOpenSettings: () => void;
  /** Brain V5 operating mode. */
  brainMode: TopbarV3BrainMode;
  /** Cycle brain mode. */
  onCycleBrainMode: () => void;

  // Dynamic data
  executions?: PlanExecution[];
  tasks?: MultiPhaseTask[];
  executionsLoading?: boolean;
  tasksLoading?: boolean;
  onSelectExecution?: (execId: string) => void;
  onSelectTask?: (taskId: string) => void;

  // Brain unread counts
  unreadCounts?: {
    observations: number;
    proposals: number;
    approvals: number;
  };
}

// ---------------------------------------------------------------------------
// Brain section items — STATIC PLACEHOLDER (P42.11)
//
// These are hardcoded navigation items. In production, brain navigation
// should be derived from the project's actual brain state and capabilities.
// ---------------------------------------------------------------------------

const BRAIN_ITEMS: { id: string; label: string; icon: typeof Brain }[] = [
  { id: "brain_overview", label: "Overview", icon: FileText },
  { id: "brain_proposals", label: "Proposals", icon: Inbox },
  { id: "brain_memory", label: "Memory", icon: LayoutGrid },
  { id: "brain_reflections", label: "Reflections", icon: Moon },
  { id: "brain_digest", label: "Morning Digest", icon: Sunrise },
  { id: "brain_goals", label: "Goals", icon: Target },
  { id: "brain_inbox", label: "Worker Inbox", icon: Inbox },
];

// ---------------------------------------------------------------------------
// Platform section items — STATIC PLACEHOLDER (P42.11)
//
// These are hardcoded platform navigation items. In production, platform
// navigation should be derived from installed extensions/skills/features.
// ---------------------------------------------------------------------------

const PLATFORM_ITEMS: { id: string; label: string; icon: typeof Cpu }[] = [
  { id: "autonomy", label: "Autonomy", icon: Cpu },
  { id: "observability", label: "Observability", icon: History },
  { id: "policy_audit", label: "Policy & Audit", icon: Shield },
  { id: "extensions_skills", label: "Extensions", icon: Puzzle },
  { id: "plan_intake", label: "Plan Intake", icon: Upload },
  { id: "pi_inbox", label: "Pi Inbox", icon: Inbox },
];

// ---------------------------------------------------------------------------
// Nav button helper
// ---------------------------------------------------------------------------

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
  badge,
  sublabel,
}: {
  active: boolean;
  icon?: typeof Brain;
  label: string;
  onClick: () => void;
  badge?: number;
  sublabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs transition-colors text-left ${FOCUS_RING} ${
        active
          ? `${ACC_BG} ${ACC_TXT}`
          : `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
      }`}
    >
      {Icon && (
        <Icon
          size={15}
          strokeWidth={1.6}
          className={`shrink-0 ${active ? ACC_TXT : MUT}`}
        />
      )}
      <span className={`flex-1 truncate ${active ? ACC_TXT : TXT}`}>
        {label}
      </span>
      {badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-red-500 text-white text-xs font-bold px-1">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {sublabel && (
        <span className={`text-xs ${MUT} shrink-0`}>{sublabel}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Section header helper
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  icon: Icon,
  expanded,
  onToggle,
  onAction,
  actionLabel,
}: {
  label: string;
  icon?: typeof Brain;
  expanded: boolean;
  onToggle: () => void;
  onAction?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      {Icon && (
        <Icon size={13} strokeWidth={1.5} className={MUT} />
      )}
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 flex-1 text-xs font-semibold uppercase tracking-widest ${MUT}`}
      >
        {expanded ? (
          <ChevronDown size={10} strokeWidth={2} />
        ) : (
          <ChevronRight size={10} strokeWidth={2} />
        )}
        {label}
      </button>
      {onAction && actionLabel && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
          className={`text-xs ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TaskRunSidebar component
// ---------------------------------------------------------------------------

export function TaskRunSidebar({
  project,
  projects,
  activeItem,
  onNavigate,
  onSelectProject,
  onCreateProject,
  onUploadPlan,
  onCreateTask,
  onOpenSettings,
  brainMode,
  onCycleBrainMode,
  executions = [],
  tasks = [],
  executionsLoading = false,
  tasksLoading = false,
  onSelectExecution,
  onSelectTask,
  unreadCounts,
}: TaskRunSidebarProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    tasks: true,
    runs: true,
    brain: true,
    platform: false,
  }));

  const toggleSection = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Count active vs completed tasks (matching TaskStatus type)
  const activeTasks = tasks.filter((t) =>
    t.status === "running" || t.status === "queued" || t.status === "blocked" ||
    t.status === "paused" || t.status === "draft" || t.status === "validating" ||
    t.status === "approval_required" || t.status === "reflecting"
  );
  const completedTasks = tasks.filter((t) =>
    t.status === "complete" || t.status === "failed" || t.status === "cancelled" ||
    t.status === "reflected" || t.status === "validation_failed"
  );

  return (
    <div className="flex flex-col h-full" role="navigation" aria-label="Task-Run sidebar">
      {/* ── Project name / switcher ── */}
      <div className="shrink-0 px-3 py-3 border-b border-[#E8E6E1] dark:border-[#333]">
        <div className="flex items-center gap-2">
          <FolderOpen size={14} strokeWidth={1.6} className={TXT} />
          <span className={`text-sm font-semibold truncate ${TXT}`}>
            {project ? project.name || project.id : "No project"}
          </span>
        </div>
      </div>

      {/* ── Scrollable nav area ── */}
      <div className="flex-1 overflow-y-auto py-1 overflow-x-hidden">
        {!project ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <FolderOpen size={24} strokeWidth={1.2} className={MUT} />
            <p className={`text-xs ${MUT}`}>Select or create a project</p>
            <button
              onClick={onCreateProject}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium ${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors`}
            >
              <Plus size={13} strokeWidth={2} />
              Create project
            </button>
          </div>
        ) : (
          <>
            {/* ── Tasks section ── */}
            <SectionHeader
              label="Active tasks"
              icon={History}
              expanded={expanded.tasks}
              onToggle={() => toggleSection("tasks")}
              onAction={onCreateTask}
              actionLabel="+ New"
            />
            {expanded.tasks && (
              <div className="flex flex-col gap-0.5 px-1 pb-1">
                {tasksLoading ? (
                  <div className={`px-3 py-2 text-xs ${MUT}`}>Loading...</div>
                ) : activeTasks.length === 0 ? (
                  <div className={`px-3 py-2 text-xs ${MUT}`}>No active tasks</div>
                ) : (
                  activeTasks.map((t) => (
                    <NavButton
                      key={t.id}
                      active={activeItem === t.id}
                      label={t.title || `Task ${t.id.slice(0, 6)}`}
                      onClick={() => onSelectTask?.(t.id)}
                      sublabel={t.status}
                    />
                  ))
                )}

                {/* Completed tasks sub-section */}
                {completedTasks.length > 0 && (
                  <>
                    <div className={`px-3 py-1 mt-1 text-xs font-medium uppercase tracking-wider ${MUT}`}>
                      Completed
                    </div>
                    {completedTasks.map((t) => (
                      <NavButton
                        key={t.id}
                        active={activeItem === t.id}
                        label={t.title || `Task ${t.id.slice(0, 6)}`}
                        onClick={() => onSelectTask?.(t.id)}
                        sublabel={t.status}
                      />
                    ))}
                  </>
                )}
              </div>
            )}

            <div className={`mx-3 my-1 border-t ${BORD}`} />

            {/* ── Runs section ── */}
            <SectionHeader
              label="Runs"
              icon={History}
              expanded={expanded.runs}
              onToggle={() => toggleSection("runs")}
              onAction={onUploadPlan}
              actionLabel="+ Upload"
            />
            {expanded.runs && (
              <div className="flex flex-col gap-0.5 px-1 pb-1">
                {executionsLoading ? (
                  <div className={`px-3 py-2 text-xs ${MUT}`}>Loading...</div>
                ) : executions.length === 0 ? (
                  <div className={`px-3 py-2 text-xs ${MUT}`}>No runs yet</div>
                ) : (
                  executions.map((ex) => (
                    <NavButton
                      key={ex.id}
                      active={activeItem === ex.id}
                      label={(ex as any).phaseTitle || ex.title || ex.phase || `Run ${ex.id.slice(0, 6)}`}
                      onClick={() => onSelectExecution?.(ex.id)}
                      sublabel={ex.status}
                    />
                  ))
                )}
              </div>
            )}

            <div className={`mx-3 my-1 border-t ${BORD}`} />

            {/* ── Brain section ── */}
            <SectionHeader
              label="Brain"
              icon={Brain}
              expanded={expanded.brain}
              onToggle={() => toggleSection("brain")}
              onAction={brainMode !== "OFF" ? onCycleBrainMode : undefined}
              actionLabel={brainMode !== "OFF" ? brainMode : undefined}
            />
            {expanded.brain && brainMode !== "OFF" && (
              <div className="flex flex-col gap-0.5 px-1 pb-1">
                {BRAIN_ITEMS.map((item) => (
                  <NavButton
                    key={item.id}
                    active={activeItem === item.id}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => onNavigate(item.id)}
                    badge={
                      item.id === "brain_proposals"
                        ? unreadCounts?.proposals
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
            {expanded.brain && brainMode === "OFF" && (
              <div className={`px-3 py-2 text-xs ${MUT}`}>
                Brain is off.{" "}
                <button
                  onClick={onCycleBrainMode}
                  className="text-blue-700 dark:text-blue-300 hover:underline"
                >
                  Enable
                </button>
              </div>
            )}

            <div className={`mx-3 my-1 border-t ${BORD}`} />

            {/* ── Platform section ── */}
            <SectionHeader
              label="Platform"
              icon={Cpu}
              expanded={expanded.platform}
              onToggle={() => toggleSection("platform")}
            />
            {expanded.platform && (
              <div className="flex flex-col gap-0.5 px-1 pb-1">
                {PLATFORM_ITEMS.map((item) => (
                  <NavButton
                    key={item.id}
                    active={activeItem === item.id}
                    icon={item.icon}
                    label={item.label}
                    onClick={() => onNavigate(item.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom settings ── */}
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
