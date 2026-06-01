/**
 * Navigation State — P42 V3 App Shell
 *
 * Core navigation types and React context for the V3 app shell.
 * This replaces the inline ActiveView type in App.tsx with a
 * more structured navigation model.
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Cockpit Tab Types
// ---------------------------------------------------------------------------

export type CockpitTabId =
  | "overview"
  | "workspaces"
  | "files"
  | "logs"
  | "escalations";

export const COCKPIT_TABS: { id: CockpitTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "workspaces", label: "Workspaces" },
  { id: "files", label: "Files" },
  { id: "logs", label: "Logs" },
  { id: "escalations", label: "Escalations" },
];

// ---------------------------------------------------------------------------
// Navigation Route
// ---------------------------------------------------------------------------

export type NavigationRouteType =
  | "empty"      // No execution selected
  | "run"        // Execution overview (cockpit tabs)
  | "task"       // Task detail
  | "platform";  // Platform/brain secondary page

export interface NavigationRoute {
  type: NavigationRouteType;
  projectId: string | null;
  taskId: string | null;
  planExecId: string | null;
  workspaceId: string | null;
  platformScreen: string | null;
  cockpitTab: CockpitTabId;
}

// ---------------------------------------------------------------------------
// Navigation State Context
// ---------------------------------------------------------------------------

export interface NavigationState {
  route: NavigationRoute;
  setRoute: (route: NavigationRoute) => void;
  setCockpitTab: (tab: CockpitTabId) => void;
  navigateToRun: (execId: string) => void;
  navigateToTask: (taskId: string) => void;
  navigateToPlatform: (screen: string) => void;
  navigateToEmpty: () => void;
}

export const NavigationContext = createContext<NavigationState | null>(null);

export function useNavigation(): NavigationState {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error(
      "useNavigation must be used within a NavigationProvider",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Default route
// ---------------------------------------------------------------------------

export const DEFAULT_ROUTE: NavigationRoute = {
  type: "empty",
  projectId: null,
  taskId: null,
  planExecId: null,
  workspaceId: null,
  platformScreen: null,
  cockpitTab: "overview",
};

// ---------------------------------------------------------------------------
// Navigation Provider
// ---------------------------------------------------------------------------

export function NavigationProvider({ children, initialRoute }: { children: ReactNode; initialRoute?: NavigationRoute }) {
  const [route, setRouteState] = useState<NavigationRoute>(initialRoute ?? DEFAULT_ROUTE);

  const setRoute = useCallback((newRoute: NavigationRoute) => {
    setRouteState(newRoute);
  }, []);

  const setCockpitTab = useCallback((tab: CockpitTabId) => {
    setRouteState((prev) => ({ ...prev, cockpitTab: tab }));
  }, []);

  const navigateToRun = useCallback((planExecId: string) => {
    setRouteState((prev) => ({
      ...prev,
      type: "run",
      planExecId,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    }));
  }, []);

  const navigateToTask = useCallback((taskId: string) => {
    setRouteState((prev) => ({
      ...prev,
      type: "task",
      taskId,
      workspaceId: null,
      platformScreen: null,
      cockpitTab: "overview",
    }));
  }, []);

  const navigateToPlatform = useCallback((screen: string) => {
    setRouteState((prev) => ({
      ...prev,
      type: "platform",
      platformScreen: screen,
      workspaceId: null,
      cockpitTab: "overview",
    }));
  }, []);

  const navigateToEmpty = useCallback(() => {
    setRouteState(DEFAULT_ROUTE);
  }, []);

  const value = useMemo<NavigationState>(() => ({
    route,
    setRoute,
    setCockpitTab,
    navigateToRun,
    navigateToTask,
    navigateToPlatform,
    navigateToEmpty,
  }), [route, setRoute, setCockpitTab, navigateToRun, navigateToTask, navigateToPlatform, navigateToEmpty]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
