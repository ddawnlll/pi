/**
 * useEditFailureHandoff - React hook for fetching edit failure handoff data.
 *
 * P4.5: Fetches edit failure handoff data from the API for a given
 * plan execution and workspace.
 */

import { useState, useEffect } from "react";

const API_BASE = "";

/**
 * Edit failure handoff data from the API.
 */
export interface EditFailureHandoffAPIData {
  /** Whether the workspace is blocked due to edit failure */
  isBlocked: boolean;
  /** Blocked file path */
  filePath?: string;
  /** Selected edit mode at time of handoff */
  selectedEditMode?: string;
  /** Failed strategy list */
  failedStrategyList?: Array<{
    attemptType: string;
    failureType: string;
    errorMessage?: string;
  }>;
  /** Last tool error */
  lastToolError?: string;
  /** Pre-edit snapshot path */
  preEditSnapshotPath?: string;
  /** Current diff */
  currentDiff?: string;
  /** Suggested manual fix steps */
  suggestedManualFixSteps?: string[];
  /** Suggested resume instruction */
  suggestedResumeInstruction?: string;
}

/**
 * Hook return type.
 */
export interface UseEditFailureHandoffResult {
  /** Handoff data */
  data: EditFailureHandoffAPIData | null;
  /** Whether data is loading */
  isLoading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Refetch the handoff data */
  refetch: () => void;
  /** Fetch version for triggering re-fetches */
  fetchVersion: number;
}

/**
 * Fetch edit failure handoff data for a workspace.
 *
 * @param planExecId - Plan execution ID (null if not available)
 * @param workspaceId - Workspace ID (null if not available)
 * @returns Handoff data, loading state, error, and refetch
 */
export function useEditFailureHandoff(
  planExecId: string | null,
  workspaceId: string | null,
): UseEditFailureHandoffResult {
  const [data, setData] = useState<EditFailureHandoffAPIData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchVersion, setFetchVersion] = useState(0);

  const refetch = () => setFetchVersion((v) => v + 1);

  useEffect(() => {
    if (!planExecId || !workspaceId) {
      setData(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/projects/_/plans/${planExecId}/workspaces/${workspaceId}/edit-failure-handoff`)
      .then((r) => {
        if (r.status === 404) {
          return null;
        }
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((result) => {
        setData(result);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, [planExecId, workspaceId, fetchVersion]);

  return { data, isLoading, error, refetch, fetchVersion };
}
