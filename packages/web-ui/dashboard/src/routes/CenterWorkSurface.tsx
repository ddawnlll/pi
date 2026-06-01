/**
 * CenterWorkSurface — P42 V3 Center Work Surface
 *
 * Renders the center column content based on the current navigation route.
 *
 * For "run" view:
 * - CockpitTabs (Overview, Workspaces, Files, Logs, Escalations)
 * - Active tab content
 *
 * For "task" view:
 * - TaskDetailView
 *
 * For "platform" view:
 * - Platform/brain page
 *
 * For "workspace-detail" view:
 * - WorkspaceDetailPage (P42.06)
 *
 * For "empty" view:
 * - Empty state with upload plan CTA
 */

import type { CockpitTabId, NavigationRoute } from "../navigation/NavigationState";
import type { CockpitTabsProps } from "./CockpitTabs";
import { CockpitTabs } from "./CockpitTabs";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CenterWorkSurfaceProps {
  /** Current navigation route. */
  route: NavigationRoute;
  /** Called when tab changes. */
  onTabChange: (tab: CockpitTabId) => void;
  /** Badges per tab. */
  tabBadges?: Partial<Record<CockpitTabId, number>>;
  /** Whether to show the cockpit tabs (when in run view). */
  showCockpitTabs?: boolean;

  /** Content to render inside each tab. */
  tabContent?: Partial<Record<CockpitTabId, React.ReactNode>>;

  /** Task detail content (for task view). */
  taskContent?: React.ReactNode;

  /** Platform content (for platform view). */
  platformContent?: React.ReactNode;

  /** Workspace detail content (for workspace-detail view). */
  workspaceDetailContent?: React.ReactNode;

  /** Empty state CTA. */
  onUploadPlan?: () => void;

  /** Contextual toolbar to render above tabs. */
  contextualToolbar?: React.ReactNode;

  /** Fallback children for run view (when no tabContent provided). */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CenterWorkSurface({
  route,
  onTabChange,
  tabBadges,
  showCockpitTabs = true,
  tabContent = {},
  taskContent,
  platformContent,
  workspaceDetailContent,
  onUploadPlan,
  contextualToolbar,
  children,
}: CenterWorkSurfaceProps) {
  const { type } = route;

  // ── Empty state ──
  if (type === "empty") {
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {contextualToolbar}
        <div className={`flex-1 flex flex-col items-center justify-center gap-4 ${MUT} p-8`}>
          <div className="w-16 h-16 rounded-2xl bg-stone-100 dark:bg-[#2A2A2A] flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-stone-400">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18M3 9h18" />
            </svg>
          </div>
          <p className={`text-sm font-medium ${MUT}`}>No execution selected</p>
          <p className={`text-xs ${MUT} max-w-sm text-center`}>
            Upload a plan to get started, or select an existing run from the sidebar.
          </p>
          {onUploadPlan && (
            <button
              onClick={onUploadPlan}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload a plan
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Platform / Brain view ──
  if (type === "platform") {
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {contextualToolbar}
        {platformContent ?? (
          <div className={`flex-1 flex items-center justify-center ${MUT}`}>
            <p className="text-sm">Platform view</p>
          </div>
        )}
      </div>
    );
  }

  // ── Workspace detail view ──
  if (type === "workspace-detail") {
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {workspaceDetailContent ?? (
          <div className={`flex-1 flex items-center justify-center ${MUT}`}>
            <p className="text-sm">Workspace detail</p>
          </div>
        )}
      </div>
    );
  }

  // ── Task detail view ──
  if (type === "task") {
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {contextualToolbar}
        {taskContent ?? (
          <div className={`flex-1 flex items-center justify-center ${MUT}`}>
            <p className="text-sm">Task detail</p>
          </div>
        )}
      </div>
    );
  }

  // ── Run view (execution overview with cockpit tabs) ──
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
      {contextualToolbar}

      {/* Cockpit tabs */}
      {showCockpitTabs && (
        <CockpitTabs
          activeTab={route.cockpitTab}
          onTabChange={onTabChange}
          tabBadges={tabBadges}
        />
      )}

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tabContent[route.cockpitTab] ?? children}
      </div>
    </div>
  );
}
