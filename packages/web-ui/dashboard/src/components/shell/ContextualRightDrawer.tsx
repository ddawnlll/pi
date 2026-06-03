/**
 * ContextualRightDrawer — P42 V3 Contextual Right Drawer
 *
 * Right drawer that is hidden by default and opens only when needed.
 * Shows contextual information like:
 * - File evidence / diff details
 * - Escalation details
 * - Worker transcript
 * - Event details
 *
 * Not a permanent sidebar — opens on-demand via actions.
 */

import { useCallback, useEffect, useRef } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { X } from "lucide-react";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DrawerPanelId =
  | "file-evidence"
  | "escalation-detail"
  | "worker-transcript"
  | "event-detail"
  | "artifact-browser"
  | "debug-event"
  | "directive"
  | "none";

export interface DrawerPanel {
  id: DrawerPanelId;
  title: string;
  content: React.ReactNode;
}

export interface ContextualRightDrawerProps {
  /** Currently open panel, or null if closed. */
  panel: DrawerPanel | null;
  /** Called when the drawer should close. */
  onClose: () => void;
  /** Drawer width in pixels (default: 360). */
  width?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContextualRightDrawer({
  panel,
  onClose,
  width = 360,
}: ContextualRightDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel) {
        onClose();
      }
    },
    [panel, onClose],
  );

  useEffect(() => {
    if (panel) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [panel, handleKeyDown]);

  if (!panel) return null;

  return (
    <div
      ref={drawerRef}
      className={`shrink-0 ${SURF} border-l ${BORD} flex flex-col overflow-hidden relative z-20`}
      style={{ width }}
    >
      {/* Header */}
      <div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD}`}>
        <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>
          {panel.title}
        </span>
        <button
          onClick={onClose}
          className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 transition-colors`}
          aria-label="Close drawer"
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {panel.content}
      </div>
    </div>
  );
}
