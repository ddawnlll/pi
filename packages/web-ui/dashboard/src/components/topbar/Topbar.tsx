import { type LucideIcon, Play, Pause, Square, Settings, PanelLeftClose, LayoutGrid, RefreshCw, Upload, GitBranch, Terminal, ScrollText, Bot, Archive, PanelRightClose, PanelRightOpen, Brain, AlertTriangle, Eye, Zap, Edit3, Rocket } from "lucide-react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TopbarAction {
  id: string;
  icon: LucideIcon;
  label?: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  accent?: boolean;
  disabled?: boolean;
  group?: "playback" | "settings" | "contextual" | "navigation";
}

// ─── Action group filtering ───────────────────────────────────────────────

export function renderActionGroup(actions: TopbarAction[], group: string): TopbarAction[] {
  return actions.filter((a) => a.group === group);
}

// ─── Shared tokens ────────────────────────────────────────────────────────


// ─── Sub-components ────────────────────────────────────────────────────────

/** Icon-only round button (44x44 touch target for primary actions). */
function IconBtn({
  icon: Icon,
  label,
  onClick,
  primary = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  const size = primary ? "min-w-[44px] min-h-[44px] h-11 w-11" : "h-8 w-8";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-800 dark:hover:text-stone-200 ${size}`}
    >
      <Icon size={primary ? 18 : 15} strokeWidth={1.8} />
    </button>
  );
}

/** Labeled action button (playback controls). */
function LabeledActionBtn({
  icon: Icon,
  label,
  onClick,
  accent = false,
  danger = false,
  disabled = false,
  primary = false,
}: TopbarAction & { icon: LucideIcon }) {
  const base =
    "inline-flex items-center gap-2 rounded-lg text-xs font-medium transition-all duration-150 border min-w-[44px] min-h-[44px] px-3";
  let cls = base;
  if (disabled) {
    cls +=
      " text-stone-300 dark:text-stone-600 border-[#E8E6E1] dark:border-[#333]/50 dark:border-[#333]/50 cursor-not-allowed bg-stone-50 dark:bg-[#1A1A1A]";
  } else if (accent) {
    cls += " bg-blue-600 text-white border-transparent hover:bg-blue-700 shadow-sm";
  } else if (danger) {
    cls +=
      " text-stone-400 dark:text-stone-500 border-[#E8E6E1] dark:border-[#333] hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800";
  } else {
    cls +=
      " text-stone-600 dark:text-stone-400 border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] hover:border-stone-300 dark:hover:border-[#555]";
  }
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cls}
    >
      <Icon size={13} strokeWidth={1.8} /> {label}
    </button>
  );
}

// ─── Main Topbar component ─────────────────────────────────────────────────

/** Brain V5 operating mode for the topbar indicator. */
export type TopbarBrainMode = "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";

export interface TopbarProps {
  /** Plan execution title to display (truncated). */
  planTitle?: string | null;
  /** Plan execution status badge node. */
  statusBadge?: React.ReactNode;
  /** Brain V5 mode indicator — shown next to title when set. */
  brainMode?: TopbarBrainMode | null;
  /** Cycle brain V5 operating mode (triggered from badge click). */
  onCycleBrainMode?: () => void;

  // Navigation
  onToggleMobileNav: () => void;
  onToggleLeftSidebar: () => void;
  leftSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
  rightSidebarOpen: boolean;

  // Playback controls
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  controlDisabled: boolean;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;

  // Restart
  canRerun: boolean;
  onRerun: () => void;

  // Force Kill
  canForceKill?: boolean;
  onForceKill?: () => void;

  // Settings
  onSettings: () => void;

  // Contextual actions (shown conditionally in contextual toolbar zone)
  activeViewType: string;
  onUploadPlan: () => void;
  onGit: () => void;
  onCommands: () => void;
  onChat: () => void;
  showChat: boolean;
  onArtifacts: () => void;
  showArtifacts: boolean;
  onExecutionLog: () => void;
  hasSelectedPlanExecId: boolean;
  onBrainContext: () => void;
  showBrainContext: boolean;
}

function BrainModeBadge({ mode, onClick }: { mode: TopbarBrainMode; onClick?: () => void }) {
  const colors: Record<TopbarBrainMode, string> = {
    OFF:            "bg-stone-200 dark:bg-stone-700 text-stone-400 dark:text-stone-500",
    READ_ONLY:      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    ADVISORY:       "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    DRAFTING:       "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    OPERATOR_READY: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  };
  const dots: Record<TopbarBrainMode, string> = {
    OFF:            "bg-stone-400 dark:bg-stone-500",
    READ_ONLY:      "bg-blue-500 dark:bg-blue-400",
    ADVISORY:       "bg-amber-500 dark:bg-amber-400",
    DRAFTING:       "bg-purple-500 dark:bg-purple-400",
    OPERATOR_READY: "bg-emerald-500 dark:bg-emerald-400",
  };
  const labels: Record<TopbarBrainMode, string> = {
    OFF:            "OFF",
    READ_ONLY:      "READ ONLY",
    ADVISORY:       "ADVISORY",
    DRAFTING:       "DRAFTING",
    OPERATOR_READY: "OPERATOR READY",
  };
  return (
    <button
      onClick={onClick}
      type="button"
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-[5px] text-xs font-semibold tracking-wider whitespace-nowrap border transition-colors ${
        mode === "OFF" ? "border-stone-300 dark:border-stone-600" :
        mode === "READ_ONLY" ? "border-blue-300 dark:border-blue-700" :
        mode === "ADVISORY" ? "border-amber-300 dark:border-amber-700" :
        mode === "DRAFTING" ? "border-purple-300 dark:border-purple-700" :
        "border-emerald-300 dark:border-emerald-700"
      } ${colors[mode]} hover:brightness-90 dark:hover:brightness-125`}
      title={`Brain V5 mode: ${mode.replace(/_/g, " ")}. Click to cycle.`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dots[mode]}`} />
      <span>Brain</span>
      <span className="opacity-60">·</span>
      <span>{labels[mode]}</span>
    </button>
  );
}

export function Topbar({
  planTitle,
  statusBadge,
  brainMode,
  onCycleBrainMode,
  onToggleMobileNav,
  onToggleLeftSidebar,
  leftSidebarOpen,
  onToggleRightSidebar,
  rightSidebarOpen,
  canResume,
  canPause,
  canStop,
  controlDisabled,
  onResume,
  onPause,
  onStop,
  canRerun,
  onRerun,
  canForceKill = false,
  onForceKill,
  onSettings,
  activeViewType,
  onUploadPlan,
  onGit,
  onCommands,
  onChat,
  showChat,
  onArtifacts,
  showArtifacts,
  onExecutionLog,
  hasSelectedPlanExecId,
  onBrainContext,
  showBrainContext,
}: TopbarProps) {
  return (
    <header
      className={`h-12 shrink-0 ${SURF} border-b ${BORD} flex items-center px-3 gap-2 z-10`}
    >
      {/* ── Mobile hamburger ── */}
      <button
        className="md:hidden flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
        onClick={onToggleMobileNav}
        aria-label="Toggle navigation"
      >
        <LayoutGrid size={15} strokeWidth={1.8} />
      </button>

      {/* ── Left sidebar toggle (desktop) ── */}
      <button
        className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
        onClick={onToggleLeftSidebar}
        aria-label={leftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        <PanelLeftClose size={15} strokeWidth={1.8} />
      </button>

      {/* ── Title / status area ── */}
      <div className="flex items-center gap-2 mx-1 min-w-0">
        <span className="text-[13px] font-semibold text-stone-800 dark:text-stone-200 tracking-tight whitespace-nowrap">
          Planner
        </span>
        {brainMode && (
          <BrainModeBadge mode={brainMode} onClick={onCycleBrainMode} />
        )}
        {statusBadge}
        {planTitle && (
          <span className="hidden sm:inline text-xs text-stone-400 dark:text-stone-500 truncate max-w-[200px]">
            &mdash; {planTitle}
          </span>
        )}
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1 min-w-0" />

      {/* ── Playback control group ── */}
      <div className="flex items-center gap-2">
        <LabeledActionBtn
          id="resume"
          icon={Play}
          label="Resume"
          onClick={onResume}
          accent
          disabled={controlDisabled || !canResume}
          group="playback"
          primary
        />
        <LabeledActionBtn
          id="pause"
          icon={Pause}
          label="Pause"
          onClick={onPause}
          disabled={controlDisabled || !canPause}
          group="playback"
          primary
        />
        <LabeledActionBtn
          id="stop"
          icon={Square}
          label="Stop"
          onClick={onStop}
          danger
          disabled={controlDisabled || !canStop}
          group="playback"
          primary
        />
        {canForceKill && onForceKill && (
          <LabeledActionBtn
            id="force-kill"
            icon={AlertTriangle}
            label="Force Kill"
            onClick={onForceKill}
            danger
            disabled={controlDisabled || !canForceKill}
            group="playback"
            primary
          />
        )}
        {canRerun && (
          <LabeledActionBtn
            id="restart"
            icon={RefreshCw}
            label="Restart"
            onClick={onRerun}
            accent
            group="playback"
            primary
          />
        )}
      </div>

      {/* ── Settings (spaced from playback) ── */}
      <div className="flex items-center gap-1 ml-3">
        <IconBtn icon={Settings} label="Settings" onClick={onSettings} />
      </div>

      {/* ── Right sidebar toggle ── */}
      <button
        className="hidden md:flex items-center justify-center h-8 w-8 rounded-lg text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
        onClick={onToggleRightSidebar}
        aria-label={rightSidebarOpen ? "Collapse events" : "Expand events"}
      >
        {rightSidebarOpen ? (
          <PanelRightClose size={15} strokeWidth={1.8} />
        ) : (
          <PanelRightOpen size={15} strokeWidth={1.8} />
        )}
      </button>

      {/* ── Contextual toolbar (below topbar, inline) ── */}
      {/* Note: This is rendered as a separate bar below the header in the layout */}
      {/* The contextual actions are exposed via the activeViewType prop for rendering outside */}
    </header>
  );
}

// ─── Contextual toolbar sub-component ──────────────────────────────────────

export interface ContextualToolbarProps {
  activeViewType: string;
  onUploadPlan: () => void;
  onGit: () => void;
  onCommands: () => void;
  onChat: () => void;
  showChat: boolean;
  onArtifacts: () => void;
  showArtifacts: boolean;
  onExecutionLog: () => void;
  hasSelectedPlanExecId: boolean;
  onBrainContext: () => void;
  showBrainContext: boolean;
}

export function ContextualToolbar({
  activeViewType,
  onUploadPlan,
  onGit,
  onCommands,
  onChat,
  showChat,
  onArtifacts,
  showArtifacts,
  onExecutionLog,
  hasSelectedPlanExecId,
  onBrainContext,
  showBrainContext,
}: ContextualToolbarProps) {
  return (
    <div
      className={`shrink-0 ${SURF} border-b ${BORD} flex items-center gap-1.5 px-3 h-11`}
    >
      {activeViewType === "run" && (
        <>
          <LabeledActionBtn
            id="upload-plan"
            icon={Upload}
            label="Upload plan"
            onClick={onUploadPlan}
            accent
            group="contextual"
          />
          <div className={`w-px h-5 ${BORD} mx-0.5`} />
          <LabeledActionBtn
            id="git"
            icon={GitBranch}
            label="Git"
            onClick={onGit}
            group="contextual"
          />
          <LabeledActionBtn
            id="commands"
            icon={Terminal}
            label="Commands"
            onClick={onCommands}
            group="contextual"
          />
          <LabeledActionBtn
            id="chat"
            icon={Bot}
            label="Chat"
            onClick={onChat}
            accent={showChat}
            group="contextual"
          />
          <LabeledActionBtn
            id="artifacts"
            icon={Archive}
            label="Artifacts"
            onClick={onArtifacts}
            accent={showArtifacts}
            group="contextual"
          />
          {hasSelectedPlanExecId && (
            <LabeledActionBtn
              id="exec-log"
              icon={ScrollText}
              label="Exec log"
              onClick={onExecutionLog}
              group="contextual"
            />
          )}
          <div className={`w-px h-5 border-[#E8E6E1] dark:border-[#333] mx-0.5`} />
          <LabeledActionBtn
            id="brain-context"
            icon={Brain}
            label="Brain"
            onClick={onBrainContext}
            accent={showBrainContext}
            group="contextual"
          />
        </>
      )}
      {activeViewType === "empty" && (
        <LabeledActionBtn
          id="upload-plan"
          icon={Upload}
          label="Upload plan"
          onClick={onUploadPlan}
          accent
          group="contextual"
        />
      )}
    </div>
  );
}
