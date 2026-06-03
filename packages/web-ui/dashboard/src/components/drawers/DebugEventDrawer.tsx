/**
 * DebugEventDrawer — P42.10 Debug Event Drawer
 *
 * Shows raw execution events for debugging. Opens only when explicitly
 * requested — never as a default panel. Uses the existing EventLine
 * component for consistent rendering.
 *
 * Raw events are hidden behind this debug/expand control per P42 spec:
 * "Raw events must be hidden behind debug/expand controls."
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { Activity, Filter, X } from "lucide-react";
import { EventLine } from "../EventLine";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebugEventDrawerProps {
  /** Raw event list. */
  events: any[];
  /** Plan execution ID for context. */
  planExecId: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DebugEventDrawer({ events, planExecId }: DebugEventDrawerProps) {
  const [eventFilter, setEventFilter] = useState<"all" | "errors">("all");

  const filteredEvents =
    eventFilter === "errors"
      ? events.filter(
          (e: any) => e.type === "error" || e.level === "error" || e.severity === "error",
        )
      : events;

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD}`}>
        <span className={`text-xs font-semibold uppercase tracking-wider ${MUT}`}>
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEventFilter("all")}
            className={`h-5 px-2 rounded text-xs font-medium transition-colors ${
              eventFilter === "all"
                ? "bg-stone-100 dark:bg-[#333] text-stone-700 dark:text-stone-200"
                : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
            }`}
          >
            All
          </button>
          <button
            onClick={() => setEventFilter("errors")}
            className={`h-5 px-2 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
              eventFilter === "errors"
                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
                : `${MUT} hover:text-red-600 dark:hover:text-red-400`
            }`}
          >
            <Filter size={8} /> Errors
          </button>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-1.5 text-stone-300 dark:text-stone-600">
            <Activity size={20} strokeWidth={1.2} />
            <p className="text-xs">No events</p>
          </div>
        ) : (
          filteredEvents.map((ev, i) => (
            <EventLine key={ev.id ?? `${ev.type}-${ev.timestamp}-${i}`} event={ev} />
          ))
        )}
      </div>
    </div>
  );
}
