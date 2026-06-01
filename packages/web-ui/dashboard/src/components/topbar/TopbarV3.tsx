/**
 * TopbarV3 — P42 V3 Simplified Topbar
 *
 * Slim 48px topbar with:
 * - Pi logo (home navigation)
 * - Breadcrumb: Project > Task > Run
 * - Health/status pill with status text
 * - Pause/Stop controls
 * - Brain dropdown
 * - Settings dropdown
 * - Search/command palette trigger
 */

import {
  AlertTriangle,
  Brain,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Square,
} from "lucide-react";
import type { BreadcrumbSegment } from "../../navigation/BreadcrumbModel";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopbarV3BrainMode = "OFF" | "READ_ONLY" | "ADVISORY" | "DRAFTING" | "OPERATOR_READY";

export interface TopbarV3Props {
  /** Breadcrumb segments to display. */
  breadcrumbs: BreadcrumbSegment[];
  /** Plan execution status (for health pill). */
  status?: string;
  /** Status text (e.g. "3 active · est. 6 min"). */
  statusText?: string | null;
  /** Brain V5 operating mode. */
  brainMode?: TopbarV3BrainMode;
  /** Cycle brain mode handler. */
  onCycleBrainMode?: () => void;

  // Playback controls
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  controlDisabled: boolean;
  onResume: () => void;
  onPause: () => void;
  onStop: () => void;

  // Rerun
  canRerun: boolean;
  onRerun: () => void;

  // Force Kill
  canForceKill?: boolean;
  onForceKill?: () => void;

  // Actions
  onSettings: () => void;
  onSearch?: () => void;
  onBrainMenu?: () => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HealthPill({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    running: "bg-emerald-500",
    paused: "bg-blue-500",
    stopped: "bg-stone-400",
    failed: "bg-red-500",
    complete: "bg-emerald-500",
    cancelled: "bg-stone-400",
    unknown: "bg-stone-300 dark:bg-stone-600",
  };

  const dotColor = colorMap[status?.toLowerCase()] ?? colorMap.unknown;

  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-stone-100 dark:bg-[#2A2A2A] border border-stone-200 dark:border-stone-700">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className="text-[11px] font-medium text-stone-600 dark:text-stone-400 capitalize">
        {status}
      </span>
    </span>
  );
}

function Breadcrumbs({ segments }: { segments: BreadcrumbSegment[] }) {
  if (segments.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 min-w-0 text-xs" aria-label="Breadcrumb">
      {segments.map((seg, i) => (
        <span key={seg.key} className="flex items-center gap-1 min-w-0">
          {i > 0 && (
            <ChevronRight size={12} strokeWidth={1.5} className={`shrink-0 ${MUT}`} />
          )}
          {seg.onClick ? (
            <button
              onClick={seg.onClick}
              className={`truncate hover:text-stone-900 dark:hover:text-stone-100 transition-colors ${
                seg.isLast
                  ? `${TXT} font-semibold`
                  : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
              }`}
            >
              {seg.icon}
              {seg.label}
            </button>
          ) : (
            <span
              className={`truncate ${
                seg.isLast
                  ? `${TXT} font-semibold`
                  : MUT
              }`}
            >
              {seg.icon}
              {seg.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Icon button helper
// ---------------------------------------------------------------------------

function TopbarIconBtn({
  icon: Icon,
  label,
  onClick,
  badge,
}: {
  icon: typeof Search;
  label: string;
  onClick?: () => void;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative inline-flex items-center justify-center h-8 w-8 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-800 dark:hover:text-stone-200 transition-colors"
    >
      <Icon size={15} strokeWidth={1.8} />
      {badge && (
        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Labeled action button matching TopbarV3 style
// ---------------------------------------------------------------------------

function LabeledActionBtn({
  icon: Icon,
  label,
  onClick,
  accent = false,
  danger = false,
  disabled = false,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg text-xs font-medium transition-all duration-150 border px-2.5 h-8";
  let cls = base;
  if (disabled) {
    cls +=
      " text-stone-300 dark:text-stone-600 border-[#E8E6E1]/50 dark:border-[#333]/50 cursor-not-allowed bg-stone-50 dark:bg-[#1A1A1A]";
  } else if (accent) {
    cls += " bg-blue-600 text-white border-transparent hover:bg-blue-700 shadow-sm";
  } else if (danger) {
    cls +=
      " text-stone-500 dark:text-stone-400 border-[#E8E6E1] dark:border-[#333] hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800";
  } else {
    cls +=
      " text-stone-600 dark:text-stone-400 border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] hover:border-stone-300 dark:hover:border-[#555]";
  }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={cls}>
      <Icon size={12} strokeWidth={1.8} /> {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main TopbarV3 component
// ---------------------------------------------------------------------------

export function TopbarV3({
  breadcrumbs,
  status,
  statusText,
  brainMode,
  onCycleBrainMode,
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
  onSearch,
  onBrainMenu,
}: TopbarV3Props) {
  return (
    <header
      className={`h-12 shrink-0 ${SURF} border-b ${BORD} flex items-center px-3 gap-2 z-10`}
    >
      {/* Pi logo */}
      <button
        className="flex items-center justify-center h-8 w-8 rounded-lg text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors font-semibold text-sm"
        aria-label="Home"
        title="Home"
      >
        Pi
      </button>

      {/* Breadcrumb */}
      <div className="flex-1 min-w-0">
        <Breadcrumbs segments={breadcrumbs} />
      </div>

      {/* Health pill */}
      {status && (
        <div className="flex items-center gap-2 shrink-0">
          <HealthPill status={status} />
          {statusText && (
            <span className={`text-[11px] ${MUT} hidden sm:inline`}>
              {statusText}
            </span>
          )}
        </div>
      )}

      {/* Spacer before controls */}
      <div className="w-2" />

      {/* ── Playback controls ── */}
      <div className="flex items-center gap-1.5 shrink-0">
        <LabeledActionBtn
          icon={Play}
          label="Resume"
          onClick={onResume}
          accent
          disabled={controlDisabled || !canResume}
        />
        <LabeledActionBtn
          icon={Pause}
          label="Pause"
          onClick={onPause}
          disabled={controlDisabled || !canPause}
        />
        <LabeledActionBtn
          icon={Square}
          label="Stop"
          onClick={onStop}
          danger
          disabled={controlDisabled || !canStop}
        />
        {canForceKill && onForceKill && (
          <LabeledActionBtn
            icon={AlertTriangle}
            label="Force Kill"
            onClick={onForceKill}
            danger
            disabled={controlDisabled || !canForceKill}
          />
        )}
        {canRerun && (
          <LabeledActionBtn
            icon={RefreshCw}
            label="Restart"
            onClick={onRerun}
            accent
          />
        )}
      </div>

      {/* ── Right action icons ── */}
      <div className="flex items-center gap-0.5 ml-2 shrink-0">
        {/* Brain mode */}
        {brainMode && onCycleBrainMode && (
          <TopbarIconBtn
            icon={Brain}
            label={`Brain: ${brainMode.replace(/_/g, " ")}`}
            onClick={onBrainMenu ?? onCycleBrainMode}
          />
        )}

        {/* Search */}
        <TopbarIconBtn
          icon={Search}
          label="Search / Command palette (Cmd+K)"
          onClick={onSearch}
        />

        {/* Settings */}
        <TopbarIconBtn
          icon={Settings}
          label="Settings"
          onClick={onSettings}
        />
      </div>
    </header>
  );
}
