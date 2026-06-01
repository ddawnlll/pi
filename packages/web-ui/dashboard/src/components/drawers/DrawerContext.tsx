/**
 * DrawerContext — P42.10 Contextual Drawer State
 *
 * React context providing drawer open/close state accessible from any
 * child component in the V3 shell. This avoids threading drawer callbacks
 * through every intermediate component.
 *
 * Usage:
 *   const { openDrawer, closeDrawer, activeDrawer } = useDrawer();
 *   openDrawer("transcript", <TranscriptDrawer ... />, "Transcript");
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { DrawerPanel } from "../shell/ContextualRightDrawer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawerState {
  /** Currently open drawer panel, or null if closed. */
  activeDrawer: DrawerPanel | null;
  /** Open a specific drawer. */
  openDrawer: (panel: DrawerPanel) => void;
  /** Close the currently open drawer. */
  closeDrawer: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const DrawerContext = createContext<DrawerState | null>(null);

export function useDrawer(): DrawerState {
  const ctx = useContext(DrawerContext);
  if (!ctx) {
    throw new Error("useDrawer must be used within a DrawerProvider");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface DrawerProviderProps {
  children: ReactNode;
  /** Optional externally controlled drawer (bypasses internal state). */
  drawer?: DrawerPanel | null;
  /** Called when drawer should close (for externally controlled mode). */
  onDrawerChange?: (panel: DrawerPanel | null) => void;
}

export function DrawerProvider({ children, drawer: externalDrawer, onDrawerChange }: DrawerProviderProps) {
  const [internalDrawer, setInternalDrawer] = useState<DrawerPanel | null>(null);

  // Use external control if provided, otherwise internal state
  const activeDrawer = externalDrawer !== undefined ? externalDrawer : internalDrawer;

  const openDrawer = useCallback((panel: DrawerPanel) => {
    if (onDrawerChange) {
      onDrawerChange(panel);
    } else {
      setInternalDrawer(panel);
    }
  }, [onDrawerChange]);

  const closeDrawer = useCallback(() => {
    if (onDrawerChange) {
      onDrawerChange(null);
    } else {
      setInternalDrawer(null);
    }
  }, [onDrawerChange]);

  const value = useMemo<DrawerState>(() => ({
    activeDrawer,
    openDrawer,
    closeDrawer,
  }), [activeDrawer, openDrawer, closeDrawer]);

  return (
    <DrawerContext.Provider value={value}>
      {children}
    </DrawerContext.Provider>
  );
}
