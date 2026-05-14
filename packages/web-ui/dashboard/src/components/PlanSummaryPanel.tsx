/**
 * PlanSummaryPanel — displays the cleanup/review agent's plan summary.
 *
 * Shows:
 * - Overall verdict (PASS / FAIL) with color coding
 * - Summary text
 * - Changed files list
 * - Issues / warnings
 * - Test results
 *
 * Fetches from /api/projects/:projectId/plans/:planExecId/summary
 */

import { useEffect, useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, FileCode, Beaker, ListChecks, Sparkles } from "lucide-react";

interface PlanSummaryData {
  planExecutionId: string;
  planTitle?: string;
  phase?: string;
  completedAt?: number;
  summary: string;
  issueCount: number;
  issues: string[];
  changedFiles: string[];
  testResults: Array<{ name: string; passed: boolean; output?: string }>;
  passed: boolean;
  source?: string;
}

interface PlanSummaryPanelProps {
  projectId: string | null;
  planExecId: string | null;
  /** Optional class name */
  className?: string;
}

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";

export function PlanSummaryPanel({ projectId, planExecId, className = "" }: PlanSummaryPanelProps) {
  const [data, setData] = useState<PlanSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !planExecId) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/projects/${projectId}/plans/${planExecId}/summary`)
      .then((r) => {
        if (r.status === 404) {
          setData(null);
          setLoading(false);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PlanSummaryData>;
      })
      .then((summary) => {
        if (summary) {
          setData(summary);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [projectId, planExecId]);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 px-4 py-3 text-xs ${MUT} ${className}`}>
        <span className="w-3 h-3 border-2 border-stone-400 dark:border-stone-500 border-t-transparent rounded-full animate-spin" />
        Loading plan summary...
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center gap-2 px-4 py-3 text-xs text-amber-600 dark:text-amber-400 ${className}`}>
        <AlertTriangle size={13} />
        Summary unavailable: {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className={`${SURF} border ${BORD} rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${BORD} bg-stone-50 dark:bg-[#1A1A1A]`}>
        <div className="flex items-center gap-2">
          <Sparkles size={14} className={data.passed ? "text-emerald-500" : "text-amber-500"} />
          <span className={`text-xs font-semibold uppercase tracking-widest ${MUT}`}>Plan Summary</span>
        </div>
        <div className="flex items-center gap-2">
          {data.passed ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
              <CheckCircle size={10} /> PASS
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
              <XCircle size={10} /> FAIL
            </span>
          )}
          {data.completedAt && (
            <span className={`text-[10px] ${MUT} tabular-nums`}>
              {new Date(data.completedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Summary text */}
      <div className="px-4 py-3 border-b ${BORD}">
        <p className={`text-xs leading-relaxed ${TXT}`}>{data.summary}</p>
      </div>

      {/* Stats row */}
      <div className={`grid grid-cols-3 gap-px bg-[#E8E6E1] dark:bg-[#333]`}>
        <div className={`${SURF} px-4 py-2.5 text-center`}>
          <div className={`text-sm font-semibold ${data.issueCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
            {data.issueCount}
          </div>
          <div className={`text-[9px] uppercase tracking-wider ${MUT} font-medium`}>Issues</div>
        </div>
        <div className={`${SURF} px-4 py-2.5 text-center`}>
          <div className={`text-sm font-semibold ${TXT}`}>{data.changedFiles.length}</div>
          <div className={`text-[9px] uppercase tracking-wider ${MUT} font-medium`}>Files Changed</div>
        </div>
        <div className={`${SURF} px-4 py-2.5 text-center`}>
          <div className={`text-sm font-semibold ${TXT}`}>{data.testResults.length}</div>
          <div className={`text-[9px] uppercase tracking-wider ${MUT} font-medium`}>Tests Run</div>
        </div>
      </div>

      {/* Changed files */}
      {data.changedFiles.length > 0 && (
        <div className="border-t ${BORD} px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <FileCode size={11} className={MUT} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>Changed Files</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {data.changedFiles.map((file, i) => (
              <span key={i} className="inline-block px-1.5 py-0.5 text-[10px] font-mono bg-stone-100 dark:bg-[#2A2A2A] text-stone-600 dark:text-stone-400 rounded">
                {file}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      {data.issues.length > 0 && (
        <div className="border-t ${BORD} px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertTriangle size={11} className="text-amber-500" />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>Issues</span>
          </div>
          <ul className="space-y-1">
            {data.issues.map((issue, i) => (
              <li key={i} className={`flex items-start gap-1.5 text-xs ${i < 3 ? "text-stone-700 dark:text-stone-300" : "text-stone-400 dark:text-stone-500"}`}>
                <span className="text-amber-500 shrink-0 mt-0.5">&bull;</span>
                <span className="break-words">{issue}</span>
              </li>
            ))}
            {data.issues.length > 3 && (
              <li className={`text-[10px] ${MUT} italic`}>...and {data.issues.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Test results */}
      {data.testResults.length > 0 && (
        <div className="border-t ${BORD} px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Beaker size={11} className={MUT} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${MUT}`}>Test Results</span>
          </div>
          <div className="space-y-1">
            {data.testResults.map((test, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {test.passed ? (
                  <CheckCircle size={11} className="text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={11} className="text-red-500 shrink-0" />
                )}
                <span className={test.passed ? "text-stone-600 dark:text-stone-400" : "text-red-600 dark:text-red-400"}>
                  {test.name}
                </span>
                {test.output && (
                  <span className={`text-[10px] ${MUT} truncate max-w-[200px]`} title={test.output}>
                    &mdash; {test.output.slice(0, 60)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className={`border-t ${BORD} px-4 py-2 bg-stone-50 dark:bg-[#1A1A1A] flex items-center gap-2 ${MUT} text-[9px]`}>
        <ListChecks size={9} />
        <span>
          Cleanup review: {data.passed ? "All checks passed" : "Issues detected"}
          {data.source === "journal" ? " (cached)" : ""}
        </span>
      </div>
    </div>
  );
}
