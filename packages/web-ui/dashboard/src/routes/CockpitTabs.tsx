/**
 * CockpitTabs — P42 V3 Execution Cockpit Tab Bar
 *
 * Primary tabs for the execution cockpit view:
 * Overview, Workspaces, Files, Logs, Escalations
 *
 * REMOVED TABS (P42.11): "Controls" tab and "Feed" tab.
 *   - Controls: Now contextual actions in the topbar (pause/stop/resume/rerun/kill)
 *   - Feed: Now the PriorityFeed card in the execution overview
 * These were removed as part of the V3 cockpit redesign.
 */

import { COCKPIT_TABS, type CockpitTabId } from "../navigation/NavigationState";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../tokens";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CockpitTabsProps {
  /** Currently active tab ID. */
  activeTab: CockpitTabId;
  /** Called when a tab is selected. */
  onTabChange: (tab: CockpitTabId) => void;
  /** Optional badge counts per tab. */
  tabBadges?: Partial<Record<CockpitTabId, number>>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CockpitTabs({ activeTab, onTabChange, tabBadges }: CockpitTabsProps) {
  return (
    <div
      className={`shrink-0 flex items-center h-10 border-b ${BORD} bg-white dark:bg-[#1E1E1E] px-2 gap-0.5`}
      role="tablist"
      aria-label="Cockpit tabs"
    >
      {COCKPIT_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const badge = tabBadges?.[tab.id];
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${FOCUS_RING} ${
              isActive
                ? `${ACC_BG} ${ACC_TXT}`
                : `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
            }`}
          >
            {tab.label}
            {badge != null && badge > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-red-500 text-white text-xs font-bold px-1">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 dark:bg-blue-400 rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
