import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerInfo, WorkspaceSummary, GitFilePatch, WorkspaceAttempt, LogStream, WorkerTranscriptEvent } from "../types";
import { formatPercent } from "../utils/format";
import { useWorkspaceLogStream } from "../hooks/useWorkspaceLogStream";
import { useWorkerTranscript } from "../hooks/useWorkerTranscript";
import { DiffViewer } from "./DiffViewer";
import { WorkerP6LifecycleTab } from "./WorkerP6LifecycleTab";
import { EditStrategyWarnings, type EditStrategyWarningData } from "./EditStrategyWarnings";
import { ThinkingAnimation, LiveWritingText } from "./ThinkingAnimation";

type TabId = "overview" | "tokens" | "performance" | "git" | "commands" | "logs" | "transcript" | "p6-lifecycle";

interface WorkerDetailProps {
  worker: WorkerInfo;
  planExecId: string | null;
  workspace?: WorkspaceSummary;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tokens", label: "Tokens" },
  { id: "performance", label: "Performance" },
  { id: "git", label: "Git" },
  { id: "commands", label: "Commands" },
  { id: "logs", label: "Logs" },
  { id: "transcript", label: "Transcript" },
  { id: "p6-lifecycle", label: "P6 Lifecycle" },
];

export function WorkerDetail({ worker, planExecId, workspace }: WorkerDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [attempts, setAttempts] = useState<WorkspaceAttempt[]>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [activeLogStream, setActiveLogStream] = useState<LogStream>("raw");

  // Fetch attempt history when workspace detail is available
  useEffect(() => {
    if (planExecId) {
      setAttemptsLoading(true);
      fetch(`/api/projects/_/plans/${planExecId}/workspaces/${worker.id}/attempts`)
        .then(r => r.json())
        .then(data => {
          setAttempts(data.attempts ?? []);
        })
        .catch(() => {
          setAttempts([]);
        })
        .finally(() => setAttemptsLoading(false));
    }
  }, [planExecId, worker.id]);
  const { lines, isConnected, isReconnecting, error: logError } = useWorkspaceLogStream(planExecId, worker.id);
  const { events: transcriptEvents } = useWorkerTranscript({
    planExecId,
    workspaceId: worker.id,
  });
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [lines]);

  const statusDot = worker.stage === "active" ? "bg-emerald-500"
    : worker.stage === "failed" ? "bg-red-500"
    : worker.stage === "blocked" ? "bg-amber-500" : "bg-stone-300 dark:bg-stone-600";

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#1E1E1E]">
      {/* header + tabs */}
      <div className="shrink-0 px-4 pt-4 pb-0">
        <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 tracking-wide mb-2 flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} />
          {worker.id}
        </h2>
        <div className="flex gap-1 border-b border-[#E8E6E1] dark:border-[#333]">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
                activeTab === tab.id
                  ? "bg-[#EBF2FF] dark:bg-[#1A2A44] text-blue-700 dark:text-blue-300 border-b-2 border-blue-500 dark:border-blue-400"
                  : "text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
              }`}
            >{tab.label}</button>
          ))}
        </div>
      </div>

      {/* tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {activeTab === "overview" && (
          <OverviewTab worker={worker} workspace={workspace}
            lines={lines} isConnected={isConnected} isReconnecting={isReconnecting} logError={logError}
            logContainerRef={logContainerRef} planExecId={planExecId}
            attempts={attempts} attemptsLoading={attemptsLoading}
            transcriptEvents={transcriptEvents} />
        )}
        {activeTab === "tokens" && <TokensTab workspace={workspace} />}
        {activeTab === "performance" && <PerformanceTab workspace={workspace} planExecId={planExecId} workerId={worker.id} />}
        {activeTab === "git" && <GitTab workspace={workspace} planExecId={planExecId} workerId={worker.id} />}
        {activeTab === "commands" && <CommandsTab lines={lines} />}
        {activeTab === "logs" && <LogsTab planExecId={planExecId} workerId={worker.id} activeStream={activeLogStream} onSwitchStream={setActiveLogStream} />}
        {activeTab === "transcript" && <TranscriptTab planExecId={planExecId} workerId={worker.id} />}
        {activeTab === "p6-lifecycle" && <WorkerP6LifecycleTab worker={worker} workspace={workspace} />}
      </div>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ worker, workspace, lines, isConnected, isReconnecting, logError, logContainerRef, planExecId, attempts, attemptsLoading, transcriptEvents }: {
  worker: WorkerInfo; workspace?: WorkspaceSummary; lines: string[];
  isConnected: boolean; isReconnecting: boolean; logError: string | null;
  logContainerRef: React.RefObject<HTMLDivElement | null>;
  planExecId: string | null;
  attempts: WorkspaceAttempt[];
  attemptsLoading: boolean;
  transcriptEvents: WorkerTranscriptEvent[];
}) {
  const now = Date.now();
  const isTerminal = workspace?.stage === "complete" || workspace?.stage === "failed";
  const lastActivityTs = workspace?.lastActivityAt ?? workspace?.updatedAt ?? workspace?.startedAt ?? null;
  const idleSeconds = lastActivityTs != null ? Math.floor((now - lastActivityTs) / 1000) : null;
  const idleMinutes = idleSeconds != null ? Math.floor(idleSeconds / 60) : null;
  // Terminal workspaces are never considered hung
  const idleWarning = !isTerminal && idleMinutes != null && idleMinutes > 3
    ? (idleMinutes > 10 ? "Worker may be hung" : `No output for ${idleMinutes}m`)
    : null;
  const lastActivityLabel = workspace?.lastActivitySource
    ? `${idleSeconds != null ? `${idleSeconds}s ago` : ""} (${workspace.lastActivitySource})`
    : (idleSeconds != null ? `${idleSeconds}s ago` : null);

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="text-xs space-y-1 text-stone-500 dark:text-stone-400 shrink-0">
        <Row label="ID" value={worker.id} />
        <Row label="Stage" value={worker.stage} />
        <Row label="Attempts" value={String(worker.attempt)} />
        <Row label="Retries" value={String(worker.retries)} />
        {worker.snapshotPath && <Row label="Snapshot" value={worker.snapshotPath} />}
        {worker.reportPath && <Row label="Report" value={worker.reportPath} />}
        {lastActivityLabel != null && <Row label="Last activity" value={lastActivityLabel} />}
        {idleWarning && <div className={`mt-1 text-xs font-medium ${idleMinutes! > 10 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}>{idleWarning}</div>}

        {/* Live thinking animation for active workspaces */}
        {worker.stage === "active" && <LiveThinkingStatus events={transcriptEvents} />}
        {/* Failure / blocked banner */}
        {(worker.stage === "failed" || worker.stage === "blocked") && (
          <div className="mt-3 pt-3 border-t border-[#E8E6E1] dark:border-[#333]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{worker.stage === "failed" ? "\u274C" : "\u26A0\uFE0F"}</span>
              <div>
                <div className="text-sm font-bold text-red-700 dark:text-red-300">
                  {worker.stage === "failed" ? "Workspace Failed" : "Workspace Blocked"}
                </div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  {worker.stage === "failed" ? "The workspace did not pass completion validation." : "The workspace is blocked and cannot proceed."}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Failure reason from worker */}
        {worker.error && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Failure Reason:</div>
            <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 p-2 rounded border border-red-200 dark:border-red-900 whitespace-pre-wrap break-words">{worker.error}</div>
          </div>
        )}
        {/* Additional error from workspace detail (completion gate blocks, etc.) */}
        {workspace?.error && workspace.error !== worker.error && (
          <div className="mt-3">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">Workspace State Error:</div>
            <div className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 rounded border border-amber-200 dark:border-amber-900 whitespace-pre-wrap break-words">{workspace.error}</div>
          </div>
        )}
      </div>

      {/* Attempt History */}
      <AttemptHistoryTable attempts={attempts} loading={attemptsLoading} />

      {/* Edit Strategy Warnings (P4.5) */}
      {workspace?.editAuditSummary && (
        <EditStrategyWarnings data={{
          editMode: workspace.editAuditSummary.editModeUsed ?? "unknown",
          blockedRewrites: workspace.editAuditSummary.blockedRewrites,
          truncationEvents: workspace.editAuditSummary.truncationEvents,
          exactMatchFailures: workspace.editAuditSummary.exactMatchFailures,
          handoffTriggered: worker.stage === "blocked",
          failedFiles: [],
        }} />
      )}

      {/* Patch-first warning for blocked workers */}
      {worker.stage === "blocked" && !workspace?.editAuditSummary && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded p-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-amber-500 rounded-full shrink-0" />
            <span className="font-semibold text-amber-700 dark:text-amber-400">Patch-first mode active</span>
          </div>
          <div className="text-amber-700 dark:text-amber-300 mt-1">
            This worker is blocked. Full rewrites are restricted — use targeted edits (patches) to modify existing files.
          </div>
        </div>
      )}

      <div className="flex flex-col min-h-0 border-t border-[#E8E6E1] dark:border-[#333] pt-3">
        <div className="flex items-center justify-between mb-2 shrink-0 flex-wrap gap-1">
          <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400">Live Logs</h3>
          <div className="flex items-center gap-2 shrink-0">
            {isConnected && <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />Connected ({lines.length} lines)</span>}
            {isReconnecting && <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 dark:bg-amber-400 rounded-full animate-pulse" />Reconnecting...</span>}
            {!isConnected && !isReconnecting && !logError && lines.length === 0 && <span className="text-xs text-stone-400 dark:text-stone-500">Connecting...</span>}
            {!isConnected && !isReconnecting && lines.length > 0 && <span className="text-xs text-stone-400 dark:text-stone-500">{lines.length} lines (disconnected)</span>}
            {logError && !isReconnecting && <span className="text-xs text-red-500 dark:text-red-400">{logError}</span>}
          </div>
        </div>
        <div ref={logContainerRef as React.RefObject<HTMLDivElement>}
          className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-700 dark:text-stone-300"
          style={{ maxHeight: "50vh", minHeight: "120px" }}
        >
          {lines.length === 0 && <div className="text-stone-400 dark:text-stone-500 italic">No logs yet...</div>}
          {lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)}
        </div>
      </div>
    </div>
  );
}

// ── Tokens Tab ────────────────────────────────────────────────────────────────

function TokensTab({ workspace }: { workspace?: WorkspaceSummary }) {
  const ctxUsed = workspace?.contextUsed;
  const ctxLimit = workspace?.contextLimit;
  if (ctxUsed === undefined || ctxLimit === undefined || ctxLimit === 0) {
    return <div className="pt-3 text-xs text-stone-400 dark:text-stone-500">No token data available</div>;
  }
  const pct = Math.round((ctxUsed / ctxLimit) * 100);
  const bar = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="pt-3">
      <h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Context Window</h3>
      <div className="text-xs text-stone-500 dark:text-stone-400 mb-1">Context: {fmt(ctxUsed)} / {fmt(ctxLimit)} ({pct}%)</div>
      <div className="w-full h-2 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ── Performance Tab ──────────────────────────────────────────────────────────

function PerformanceTab({ workspace, planExecId, workerId }: { workspace?: WorkspaceSummary; planExecId: string | null; workerId: string }) {
  const [perfMetrics, setPerfMetrics] = useState<import("../types").WorkspacePerformanceMetrics | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState<string | null>(null);

  useEffect(() => {
    if (!planExecId) {
      setPerfMetrics(null);
      return;
    }
    setPerfLoading(true);
    setPerfError(null);
    fetch(`/api/projects/_/plans/${planExecId}/workspaces/${workerId}/performance`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setPerfMetrics(data);
      })
      .catch(err => {
        setPerfError(String(err));
        setPerfMetrics(null);
      })
      .finally(() => setPerfLoading(false));
  }, [planExecId, workerId]);

  if (perfLoading) {
    return (
      <div className="flex items-center gap-2 pt-3 text-xs text-stone-400 dark:text-stone-500">
        <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
        Loading performance data...
      </div>
    );
  }

  if (perfError) {
    return <div className="pt-3 text-xs text-amber-600 dark:text-amber-400">Performance data unavailable: {perfError}</div>;
  }

  if (!perfMetrics) {
    return <div className="pt-3 text-xs text-stone-400 dark:text-stone-500">No performance data available</div>;
  }

  const { cache, tokenSplit, validationLock } = perfMetrics;
  const cacheDisplay = cache.cacheHitRateKnown ? formatPercent(cache.cacheHitRate) : "unknown";

  return (
    <div className="flex flex-col gap-4 pt-3">
      {/* Cache Performance */}
      <div>
        <h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Cache Performance</h3>
        <div className="text-xs space-y-1 text-stone-500 dark:text-stone-400">
          <Row label="Cache hit" value={cacheDisplay} />
          {cache.cacheCreationInputTokens != null && <Row label="Cache created" value={fmt(cache.cacheCreationInputTokens)} />}
          {cache.cacheReadInputTokens != null && <Row label="Cache read" value={fmt(cache.cacheReadInputTokens)} />}
        </div>
      </div>

      {/* Token Split */}
      <div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
        <h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Token Split (Prefix / Suffix)</h3>
        {tokenSplit.totalTokenCount != null ? (
          <div className="text-xs space-y-1 text-stone-500 dark:text-stone-400">
            <Row label="Prefix" value={fmt(tokenSplit.prefixTokenCount ?? 0)} />
            <Row label="Suffix" value={fmt(tokenSplit.suffixTokenCount ?? 0)} />
            <Row label="Total" value={fmt(tokenSplit.totalTokenCount)} />
            {/* Visual split bar */}
            <div className="mt-2">
              <div className="flex items-center gap-1 text-[10px] text-stone-400 dark:text-stone-500 mb-1">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-sm" /> Prefix
                <span className="ml-2 inline-block w-2 h-2 bg-amber-500 rounded-sm" /> Suffix
              </div>
              <div className="w-full h-2 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden flex">
                {tokenSplit.totalTokenCount > 0 && (
                  <>
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${((tokenSplit.prefixTokenCount ?? 0) / tokenSplit.totalTokenCount) * 100}%` }}
                    />
                    <div
                      className="h-full bg-amber-500 transition-all duration-500"
                      style={{ width: `${((tokenSplit.suffixTokenCount ?? 0) / tokenSplit.totalTokenCount) * 100}%` }}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-stone-400 dark:text-stone-500">Token split data not available</div>
        )}
      </div>

      {/* Validation Lock */}
      <div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
        <h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Validation Lock</h3>
        <div className="text-xs space-y-1 text-stone-500 dark:text-stone-400">
          <Row label="Lock waits" value={String(validationLock.lockWaits)} />
          {validationLock.totalLockWaitMs != null && <Row label="Total wait" value={`${validationLock.totalLockWaitMs}ms`} />}
          {validationLock.maxLockWaitMs != null && <Row label="Max wait" value={`${validationLock.maxLockWaitMs}ms`} />}
          {validationLock.avgLockWaitMs != null && <Row label="Avg wait" value={`${validationLock.avgLockWaitMs}ms`} />}
          {validationLock.lockWaits === 0 && <div className="text-stone-400 dark:text-stone-500 italic mt-1">No validation lock contention</div>}
        </div>
      </div>
    </div>
  );
}

// ── Git Tab ───────────────────────────────────────────────────────────────────

function GitTab({ workspace, planExecId, workerId }: { workspace?: WorkspaceSummary; planExecId: string | null; workerId: string }) {
  const { gitBranch: branch, gitDirty: dirty, gitCommits: commits, stage } = workspace ?? {};
  const [patches, setPatches] = useState<GitFilePatch[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [useTableView, setUseTableView] = useState(false);

  // Fetch git diff patches for completed workspaces
  useEffect(() => {
    if (stage === "complete" && planExecId) {
      setDiffLoading(true);
      setDiffError(null);
      fetch(`/api/projects/_/plans/${planExecId}/workspaces/${workerId}/git-diff?format=patch`)
        .then(r => r.json())
        .then(data => {
          if (data.error && !data.patches?.length) {
            setDiffError(data.error);
            setPatches([]);
          } else {
            setPatches(data.patches ?? []);
          }
        })
        .catch(err => {
          setDiffError(String(err));
          setPatches([]);
        })
        .finally(() => setDiffLoading(false));
    }
  }, [stage, planExecId, workerId]);

  if (!branch && dirty === undefined && (!commits || commits.length === 0) && patches.length === 0 && !diffLoading && !diffError) {
    return <div className="flex items-center justify-center h-32 text-stone-400 dark:text-stone-500 text-xs pt-3">Git data unavailable</div>;
  }

  const isPending = stage !== "complete" && stage !== "failed";

  return (
    <div className="text-xs space-y-3 text-stone-600 dark:text-stone-400 pt-3">
      {branch && <Row label="Branch" value={branch} />}
      {dirty !== undefined && <Row label="Working tree" value={dirty ? "Dirty" : "Clean"} />}
      {commits && commits.length > 0 && (
        <div><span className="text-stone-400 dark:text-stone-500 block mb-1">Recent commits:</span>
          {commits.map((c, i) => <div key={i} className="font-mono truncate text-stone-600 dark:text-stone-400">{c}</div>)}
        </div>
      )}

      {/* Diff section */}
      <div className="pt-2 border-t border-[#E8E6E1] dark:border-[#333]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-stone-400 dark:text-stone-500 font-semibold">File changes:</span>
          {!isPending && patches.length > 0 && (
            <button
              onClick={() => setUseTableView(!useTableView)}
              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              {useTableView ? "Show diff view" : "Show table view"}
            </button>
          )}
        </div>

        {diffLoading && <div className="text-stone-400 dark:text-stone-500 italic">Loading...</div>}
        {diffError && !diffLoading && <div className="text-amber-600 dark:text-amber-400 italic">{diffError}</div>}

        {!diffLoading && !diffError && isPending && (
          <DiffViewer patches={[]} pending={true} />
        )}

        {!diffLoading && !diffError && !isPending && patches.length === 0 && (
          <div className="text-stone-400 dark:text-stone-500 italic">No uncommitted changes</div>
        )}

        {!diffLoading && !diffError && !isPending && patches.length > 0 && !useTableView && (
          <DiffViewer patches={patches} />
        )}

        {!diffLoading && !diffError && !isPending && patches.length > 0 && useTableView && (
          <TableView patches={patches} />
        )}
      </div>
    </div>
  );
}

function TableView({ patches }: { patches: GitFilePatch[] }) {
  return (
    <div className="bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-stone-100 dark:bg-[#222] text-stone-500 dark:text-stone-400">
            <th className="text-left px-2 py-1 font-medium">File</th>
            <th className="text-center px-2 py-1 font-medium w-16">Status</th>
            <th className="text-right px-2 py-1 font-medium w-12">+</th>
            <th className="text-right px-2 py-1 font-medium w-12">-</th>
          </tr>
        </thead>
        <tbody>
          {patches.map(fc => {
            const addCount = (fc.patch.match(/^\+/gm) || []).length;
            const delCount = (fc.patch.match(/^-/gm) || []).length;
            return (
              <tr key={fc.path} className="border-t border-[#E8E6E1] dark:border-[#333]">
                <td className="px-2 py-1 font-mono text-stone-700 dark:text-stone-300 truncate max-w-[200px]" title={fc.path}>{fc.path}</td>
                <td className="px-2 py-1 text-center">
                  <span className={{
                    added: "text-emerald-600 dark:text-emerald-400",
                    modified: "text-amber-600 dark:text-amber-400",
                    deleted: "text-red-600 dark:text-red-400",
                    renamed: "text-blue-600 dark:text-blue-400",
                    copied: "text-violet-600 dark:text-violet-400",
                    unmerged: "text-orange-600 dark:text-orange-400",
                  }[fc.status] ?? "text-stone-500"}>{fc.status}</span>
                </td>
                <td className="px-2 py-1 text-right text-emerald-600 dark:text-emerald-400 font-mono">{addCount > 0 ? `+${addCount}` : ""}</td>
                <td className="px-2 py-1 text-right text-red-600 dark:text-red-400 font-mono">{delCount > 0 ? `-${delCount}` : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Commands Tab ──────────────────────────────────────────────────────────────

function CommandsTab({ lines }: { lines: string[] }) {
  const cmdLines = lines.filter(l => l.startsWith("$ ") || l.includes("tool_call") || l.includes("tool_use") || l.includes("<function=") || l.includes("function_call"));
  if (cmdLines.length === 0) return <div className="flex items-center justify-center h-32 text-stone-400 dark:text-stone-500 text-xs pt-3">No commands detected yet</div>;
  return (
    <div className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-700 dark:text-stone-300 mt-3"
      style={{ maxHeight: "60vh", minHeight: "120px" }}>
      {cmdLines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)}
    </div>
  );
}

// ── Attempt History Table ──────────────────────────────────────────────────────

function AttemptHistoryTable({ attempts, loading }: { attempts: WorkspaceAttempt[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
        <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
          <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  if (attempts.length === 0) {
    return null;
  }

  // Single-attempt success: show compact without expanded history
  const isSingleSuccess = attempts.length === 1 && attempts[0].verdict === "complete";

  if (isSingleSuccess) {
    const a = attempts[0];
    return (
      <div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <RoleBadge role={a.role} />
          <span>{formatDuration(a.duration)}</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Complete</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
      <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400 mb-2">Attempt History</h3>
      <div className="space-y-1.5">
        {attempts.map((a) => (
          <AttemptRow key={a.attempt} attempt={a} />
        ))}
      </div>
    </div>
  );
}

function AttemptRow({ attempt: a }: { attempt: WorkspaceAttempt }) {
  const isRunning = a.verdict === "running";

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 rounded bg-stone-50 dark:bg-[#1A1A1A] border border-[#E8E6E1] dark:border-[#333]">
      <RoleBadge role={a.role} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <span>Attempt {a.attempt}</span>
          {a.duration != null && <span>{formatDuration(a.duration)}</span>}
          <VerdictBadge verdict={a.verdict} />
        </div>
        {isRunning && (
          <div className="flex items-center gap-1 mt-1">
            <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-amber-600 dark:text-amber-400">In progress...</span>
          </div>
        )}
        {a.error && !isRunning && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-400 break-words">{a.error}</div>
        )}
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: WorkspaceAttempt["role"] }) {
  const colors: Record<string, string> = {
    worker: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    flash: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
    reviewer: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    final: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 ${colors[role] || colors.worker}`}>
      {role}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: WorkspaceAttempt["verdict"] }) {
  const colors: Record<string, string> = {
    complete: "text-emerald-600 dark:text-emerald-400",
    failed: "text-red-600 dark:text-red-400",
    running: "text-amber-600 dark:text-amber-400",
  };
  return <span className={`font-medium ${colors[verdict] || "text-stone-500"}`}>{verdict}</span>;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "--";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

// ── Logs Tab ──────────────────────────────────────────────────────────────────

const LOG_STREAMS: LogStream[] = ["raw", "structured", "narrative", "audit", "decision", "stdout", "stderr", "test", "error", "transcript"];

const LOG_STREAM_DESCRIPTIONS: Record<LogStream, string> = {
  raw: "Raw console output from the worker process",
  structured: "Structured JSON log entries with metadata",
  narrative: "Human-readable narrative summaries of worker activity",
  audit: "Audit trail of control and safety actions",
  decision: "Agent decision log entries",
  stdout: "Standard output stream (legacy)",
  stderr: "Standard error stream (legacy)",
  test: "Test output stream",
  error: "Error output stream (legacy)",
  transcript: "Sanitized worker transcript events (worker_status, decision_summary, validation, blocker)",
};

function LogsTab({ planExecId, workerId, activeStream, onSwitchStream }: {
  planExecId: string | null;
  workerId: string;
  activeStream: LogStream;
  onSwitchStream: (stream: LogStream) => void;
}) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch log stream content via SSE
  useEffect(() => {
    if (!planExecId || !workerId) {
      setLogLines([]);
      return;
    }

    setLogLoading(true);
    setLogError(null);
    setLogLines([]);

    const url = `/api/logs/v2/${planExecId}/${workerId}/${activeStream}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      setLogLoading(false);
      if (event.data === "__NO_LOGS__") {
        return;
      }
      setLogLines((prev) => [...prev, event.data]);
    };

    eventSource.onerror = () => {
      setLogLoading(false);
      eventSource.close();
      setLogError("Stream disconnected");
    };

    eventSource.onopen = () => {
      setLogLoading(false);
      setLogError(null);
    };

    return () => {
      eventSource.close();
    };
  }, [planExecId, workerId, activeStream]);

  // Auto-scroll
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines.length]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      {/* Stream selector */}
      <div className="flex flex-wrap gap-1">
        {LOG_STREAMS.map((stream) => (
          <button
            key={stream}
            onClick={() => onSwitchStream(stream)}
            className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
              activeStream === stream
                  ? "bg-blue-600 text-white"
                  : "bg-stone-100 dark:bg-[#333] text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-[#444]"
            }`}
          >
            {stream}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-stone-400 dark:text-stone-500">
        {LOG_STREAM_DESCRIPTIONS[activeStream]}
      </p>

      {/* Log content */}
      <div
        ref={logContainerRef}
        className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-700 dark:text-stone-300"
        style={{ maxHeight: "50vh", minHeight: "120px" }}
      >
        {logLoading && (
          <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
            <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
            Loading {activeStream} stream...
          </div>
        )}
        {!logLoading && logError && (
          <div className="text-red-600 dark:text-red-400 italic">{logError}</div>
        )}
        {!logLoading && !logError && logLines.length === 0 && (
          <div className="text-stone-400 dark:text-stone-500 italic">
            No {activeStream} log entries yet
          </div>
        )}
        {logLines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">{line}</div>
        ))}
      </div>
    </div>
  );
}

// ── Transcript Tab ────────────────────────────────────────────────────────────

function TranscriptTab({ planExecId, workerId }: { planExecId: string | null; workerId: string }) {
  const { events, isConnected, isReconnecting, error } = useWorkerTranscript({
    planExecId,
    workspaceId: workerId,
  });
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const [animateEventId, setAnimateEventId] = useState<string | null>(null);

  // Auto-scroll
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [events.length]);

  // Animate the last event's summary on new events
  useEffect(() => {
    if (events.length > 0) {
      const last = events[events.length - 1];
      setAnimateEventId(`${last.timestamp}-${last.type}`);
    }
  }, [events.length]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400">Live Transcript</h3>
        <div className="flex items-center gap-2 shrink-0">
          {isConnected && <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full animate-pulse" />Connected ({events.length} events)</span>}
          {isReconnecting && <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 dark:bg-amber-400 rounded-full animate-pulse" />Reconnecting...</span>}
          {!isConnected && !isReconnecting && !error && <span className="text-xs text-stone-400 dark:text-stone-500">Connecting...</span>}
          {error && !isReconnecting && <span className="text-xs text-red-500 dark:text-red-400">{error}</span>}
        </div>
      </div>

      <p className="text-[10px] text-stone-400 dark:text-stone-500">
        Sanitized worker transcript — worker_status, decision_summary, validation, and blocker events. No private chain-of-thought.
      </p>

      <div
        ref={transcriptContainerRef}
        className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs"
        style={{ maxHeight: "50vh", minHeight: "120px" }}
      >
        {events.length === 0 && (
          <div className="text-stone-400 dark:text-stone-500 italic">No transcript events yet...</div>
        )}
        {events.map((event, i) => {
          const isLatest = i === events.length - 1;
          const eventId = `${event.timestamp}-${event.type}`;
          const shouldAnimate = isLatest && animateEventId === eventId;
          return (
            <TranscriptEventLine
              key={eventId}
              event={event}
              animate={shouldAnimate}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Renders a single transcript event with timestamp and type-appropriate styling.
 * Validates that no private chain-of-thought data is present.
 */
function TranscriptEventLine({ event, animate = false }: { event: import("../types").WorkerTranscriptEvent; animate?: boolean }) {
  const types = event.type;
  const ts = new Date(event.timestamp).toLocaleTimeString();

  // Type badge colors
  const badgeColors: Record<string, string> = {
    worker_status: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    worker_decision_summary: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
    validation: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    blocker: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    tool_call: "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300",
    workspace_start: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
    workspace_complete: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
    workspace_failed: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
    workspace_blocked: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    retry_attempt: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  };

  const badge = badgeColors[types] ?? "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300";

  // Validation pass/fail indicator
  const passed = event.data?.passed as boolean | undefined;
  const validationIcon = passed === true ? "\u2713" : passed === false ? "\u2717" : null;

  return (
    <div className={`flex gap-2 py-1 border-b border-stone-100 dark:border-[#222] last:border-0 ${animate ? "bg-blue-50/50 dark:bg-blue-950/20 -mx-2 px-2 rounded" : ""}`}>
      <span className="text-stone-400 dark:text-stone-500 shrink-0 w-16">{ts}</span>
      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${badge}`}>{types}</span>
      <span className="text-stone-700 dark:text-stone-300 break-words flex-1">
        {validationIcon && <span className={passed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{validationIcon} </span>}
        {animate ? (
          <LiveWritingText text={event.summary} tickMs={12} charsPerTick={2} />
        ) : (
          event.summary
        )}
      </span>
    </div>
  );
}

// ── LiveThinkingStatus ──────────────────────────────────────────────────────

/**
 * Derives the current thinking state from the most recent transcript events.
 * Renders an animated ThinkingAnimation card for active workers.
 */
function LiveThinkingStatus({ events }: { events: WorkerTranscriptEvent[] }) {
  const [animationKey, setAnimationKey] = useState(0);

  // Get the latest events to determine current state
  const recentEvents = events.slice(-10);
  const latestEvent = recentEvents[recentEvents.length - 1];

  // Map transcript event type to thinking state
  const getState = (): "thinking" | "executing" | "deciding" | "compacting" | "idle" => {
    if (!latestEvent) return "thinking";
    switch (latestEvent.type) {
      case "worker_status":
        const status = latestEvent.data?.status as string | undefined;
        if (status === "executing") return "executing";
        if (status === "compacting") return "compacting";
        if (status === "deciding") return "deciding";
        return "thinking";
      case "tool_call":
        return "executing";
      case "workspace_start":
        return "thinking";
      case "workspace_complete":
      case "workspace_failed":
      case "workspace_blocked":
        return "deciding";
      default:
        return "thinking";
    }
  };

  const state = getState();
  const message = latestEvent?.summary ?? "Waiting for worker activity...";

  // Re-trigger animation when new events arrive
  useEffect(() => {
    setAnimationKey((k) => k + 1);
  }, [events.length]);

  if (!latestEvent) {
    return (
      <div className="mt-3 pt-3 border-t border-[#E8E6E1] dark:border-[#333]">
        <h4 className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">Worker Status</h4>
        <ThinkingAnimation state="thinking" text="Awaiting first activity..." />
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-[#E8E6E1] dark:border-[#333]">
      <h4 className="text-xs font-semibold text-stone-500 dark:text-stone-400 mb-2">Live Status</h4>
      <ThinkingAnimation key={animationKey} state={state} text={message} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <span className="text-stone-400 dark:text-stone-500 w-20 shrink-0">{label}:</span>
      <span className="text-stone-700 dark:text-stone-300 truncate">{value}</span>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
  return String(n);
}
