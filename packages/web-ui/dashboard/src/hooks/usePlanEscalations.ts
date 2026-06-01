/**
 * usePlanEscalations — Hook for plan-level escalation aggregation (P42.09).
 *
 * Fetches all escalations across all workspaces for a plan execution.
 * Uses the existing `/api/human/escalations/:planExecId/:workspaceId` endpoint
 * which goes through execution-service-backed web-server routes.
 *
 * Also provides dependency graph data for the DeadlockDependencyPanel.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePlanWorkspaces } from "./usePlanWorkspaces";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { LeadEscalationView } from "@earendil-works/pi-execution-core";

export interface PlanEscalationsResponse {
  success: boolean;
  escalations: LeadEscalationView[];
  count: number;
}

export interface PlanEscalationsData {
  /** All escalations for the plan */
  escalations: LeadEscalationView[];
  /** Active escalations (awaiting_user or user_responded) */
  activeEscalations: LeadEscalationView[];
  /** Resolved/expired escalations */
  resolvedEscalations: LeadEscalationView[];
  /** Workspace IDs of blocked workspaces */
  blockedWorkspaceIds: string[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------

const API_BASE = "";

async function fetchWorkspaceEscalations(
  planExecId: string,
  workspaceId: string,
): Promise<LeadEscalationView[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/human/escalations/${encodeURIComponent(planExecId)}/${encodeURIComponent(workspaceId)}`,
    );
    if (!res.ok) return [];
    const data: PlanEscalationsResponse = await res.json();
    return data.escalations ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlanEscalations(
  projectId: string | null,
  planExecId: string | null,
  enabled = true,
): PlanEscalationsData {
  // Get workspace IDs for the plan
  const { workspaces, workspaceIds, isLoading: wsLoading } = usePlanWorkspaces({
    projectId,
    planExecId,
    intervalMs: 10_000,
  });

  const {
    data: escalations = [],
    isLoading: escLoading,
    error,
    refetch,
  } = useQuery<LeadEscalationView[]>({
    queryKey: ["plan-escalations", planExecId, workspaceIds],
    queryFn: async () => {
      if (!planExecId || workspaceIds.length === 0) return [];

      const allEscalations: LeadEscalationView[] = [];
      const seenIds = new Set<string>();

      // Fetch escalations for each workspace in parallel
      const results = await Promise.allSettled(
        workspaceIds.map((wsId) => fetchWorkspaceEscalations(planExecId, wsId)),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const esc of result.value) {
            if (seenIds.has(esc.escalationId)) continue;
            seenIds.add(esc.escalationId);
            allEscalations.push(esc);
          }
        }
      }

      // Sort by createdAt descending (newest first)
      allEscalations.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return allEscalations;
    },
    enabled: enabled && !!planExecId && workspaceIds.length > 0,
    refetchInterval: 10_000,
  });

  const activeEscalations = useMemo(
    () =>
      escalations.filter(
        (e) => e.status === "awaiting_user" || e.status === "user_responded",
      ),
    [escalations],
  );

  const resolvedEscalations = useMemo(
    () =>
      escalations.filter(
        (e) => e.status === "resolved" || e.status === "expired",
      ),
    [escalations],
  );

  const blockedWorkspaceIds = useMemo(
    () => workspaces.filter((w) => w.stage === "blocked").map((w) => w.id),
    [workspaces],
  );

  return {
    escalations,
    activeEscalations,
    resolvedEscalations,
    blockedWorkspaceIds,
    isLoading: wsLoading || escLoading,
    error: error instanceof Error ? error : null,
    refetch,
  };
}
