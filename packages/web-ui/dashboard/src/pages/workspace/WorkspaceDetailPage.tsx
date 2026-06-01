/**
 * WorkspaceDetailPage — Full workspace detail page as a route (P42.06).
 *
 * Sections:
 * - Header (workspace ID, stage badge, back nav)
 * - Current State (stage, attempts, timestamps, error)
 * - Prompt/Context Summary (goal, role, role packet, context, files)
 * - Command History
 * - File Changes
 * - Transcript (live SSE)
 * - Validation Evidence
 * - Attempt History
 * - Escalations / Directives
 */

import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigation } from "../../navigation/NavigationState";
import { useWorkerContext, type WorkerContextView } from "../../hooks/useWorkerContext";
import { useCommandHistory } from "../../hooks/useCommandHistory";
import { useChangedFiles } from "../../hooks/useChangedFiles";
import { useWorkerTranscript } from "../../hooks/useWorkerTranscript";
import { useValidationStatus } from "../../hooks/useValidationStatus";
import { useEscalations, useResolveEscalation } from "../../hooks/useEscalations";
import { useHumanDirectives } from "../../hooks/useHumanDirectives";

import {
  WorkspaceDetailCurrentState,
  WorkspaceDetailContextSummary,
  WorkspaceDetailCommandHistory,
  WorkspaceDetailFileChanges,
  WorkspaceDetailTranscript,
  WorkspaceDetailValidation,
  WorkspaceDetailEscalations,
  WorkspaceDetailAttemptHistory,
} from "../../components/workspace-detail";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AttemptEntry {
  attemptNumber: number;
  stage: string;
  startedAt?: string;
  completedAt?: string;
  error?: string | null;
}

interface AttemptListResponse {
  attempts: AttemptEntry[];
}

export interface WorkspaceDetailPageProps {
  projectId: string | null;
  planExecId: string | null;
  workspaceId: string;
  onBackToWorkspaces?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function shortId(id: string): string {
  if (id.length <= 24) return id;
  return `${id.slice(0, 14)}...${id.slice(-6)}`;
}

function stageDotColor(stage: string): string {
  switch (stage) {
    case "active":
      return "bg-emerald-500";
    case "complete":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "blocked":
      return "bg-amber-500";
    case "pending":
      return "bg-stone-300 dark:bg-stone-600";
    default:
      return "bg-stone-300 dark:bg-stone-600";
  }
}

// ─── Component ─────────────────────────────────────────────────────────────

export function WorkspaceDetailPage({
  projectId,
  planExecId,
  workspaceId,
  onBackToWorkspaces,
}: WorkspaceDetailPageProps) {
  const { navigateToWorkspace } = useNavigation();

  // ── Data hooks ──
  const { data: context, isLoading: contextLoading } = useWorkerContext(
    planExecId,
    workspaceId,
  );

  const {
    data: commands,
    isLoading: commandsLoading,
    error: commandsError,
  } = useCommandHistory(projectId, planExecId, workspaceId);

  const {
    data: files,
    isLoading: filesLoading,
    error: filesError,
  } = useChangedFiles(projectId, planExecId, workspaceId);

  const {
    events: transcriptEvents,
    isConnected: transcriptConnected,
    isReconnecting: transcriptReconnecting,
    error: transcriptError,
  } = useWorkerTranscript({ planExecId, workspaceId });

  const {
    data: validation,
    isLoading: validationLoading,
    error: validationError,
  } = useValidationStatus(projectId, planExecId, workspaceId);

  const {
    data: escalations,
    isLoading: escalationsLoading,
    error: escalationsError,
  } = useEscalations(planExecId, workspaceId);

  const {
    data: directives,
    isLoading: directivesLoading,
    error: directivesError,
  } = useHumanDirectives(planExecId, workspaceId);

  const resolveEscalation = useResolveEscalation();

  // ── Attempt history ──
  const [attempts, setAttempts] = useState<AttemptEntry[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [attemptsError, setAttemptsError] = useState<unknown>(null);

  useEffect(() => {
    if (!planExecId || !workspaceId) return;
    setAttemptsLoading(true);
    fetch(`/api/projects/${encodeURIComponent(projectId ?? "_")}/plans/${encodeURIComponent(planExecId)}/workspaces/${encodeURIComponent(workspaceId)}/attempts`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: AttemptListResponse) => {
        setAttempts(data.attempts ?? []);
        setAttemptsError(null);
      })
      .catch((err) => {
        setAttemptsError(err);
        setAttempts([]);
      })
      .finally(() => setAttemptsLoading(false));
  }, [projectId, planExecId, workspaceId]);

  // ── Callbacks ──
  const handleBack = useCallback(() => {
    if (onBackToWorkspaces) {
      onBackToWorkspaces();
    } else {
      navigateToWorkspace(workspaceId);
    }
  }, [onBackToWorkspaces, navigateToWorkspace, workspaceId]);

  const handleResolveEscalation = useCallback(
    (escalationId: string, chosenOptionId: string) => {
      if (!planExecId) return;
      resolveEscalation.mutate({
        escalationId,
        planExecutionId: planExecId,
        workspaceId,
        chosenOptionId,
      });
    },
    [planExecId, workspaceId, resolveEscalation],
  );

  // ── Derived ──
  const stage = context?.stage ?? "unknown";
  const errorBanner = context?.error;

  return (
    <div className="flex flex-col h-full bg-stone-50 dark:bg-[#161616] overflow-y-auto">
      {/* ── Header ── */}
      <div className={`shrink-0 sticky top-0 z-10 ${SURF} border-b ${BORD} px-4 py-3`}>
        <div className="flex items-center gap-3">
          {/* Back button */}
          <button
            onClick={handleBack}
            className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors`}
            aria-label="Back to workspaces"
          >
            <ArrowLeft size={13} />
            Back
          </button>

          {/* Divider */}
          <span className={`w-px h-5 ${BORD}`} />

          {/* Workspace identity */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-block w-2 h-2 rounded-full shrink-0 ${stageDotColor(stage)}`}
            />
            <span className={`text-sm font-semibold ${TXT} truncate`}>
              {shortId(workspaceId)}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                stage === "active"
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
                  : stage === "complete"
                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                    : stage === "failed"
                      ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
                      : stage === "blocked"
                        ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
                        : "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
              }`}
            >
              {stage}
            </span>
          </div>
        </div>
      </div>

      {/* ── Error banner ── */}
      {errorBanner && (
        <div className="shrink-0 flex items-start gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-500" />
          <span className="text-xs text-red-600 dark:text-red-400 break-all">
            {errorBanner}
          </span>
        </div>
      )}

      {/* ── Body: grid of sections ── */}
      <div className="flex-1 p-4 space-y-4">
        {/* Row 1: Current State + Prompt/Context */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WorkspaceDetailCurrentState
            context={context}
            isLoading={contextLoading}
          />
          <WorkspaceDetailContextSummary context={context} />
        </div>

        {/* Row 2: Command History + File Changes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WorkspaceDetailCommandHistory
            commands={commands}
            isLoading={commandsLoading}
            error={commandsError}
          />
          <WorkspaceDetailFileChanges
            files={files}
            isLoading={filesLoading}
            error={filesError}
          />
        </div>

        {/* Row 3: Transcript (full width) */}
        <WorkspaceDetailTranscript
          events={transcriptEvents}
          isConnected={transcriptConnected}
          isReconnecting={transcriptReconnecting}
          error={transcriptError}
        />

        {/* Row 4: Validation + Attempt History */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WorkspaceDetailValidation
            validation={validation}
            isLoading={validationLoading}
            error={validationError}
          />
          <WorkspaceDetailAttemptHistory
            attempts={attempts}
            isLoading={attemptsLoading}
            error={attemptsError}
          />
        </div>

        {/* Row 5: Escalations / Directives (full width) */}
        <WorkspaceDetailEscalations
          escalations={escalations}
          directives={directives}
          escalationsLoading={escalationsLoading}
          directivesLoading={directivesLoading}
          escalationsError={escalationsError}
          directivesError={directivesError}
          onResolveEscalation={handleResolveEscalation}
        />
      </div>
    </div>
  );
}
