/**
 * WorkspaceDetailContextSummary — Prompt/Context summary section (P42.06).
 *
 * Displays goal, role packet, context summary, and allowed/touched files.
 */

import { FileCode, FileText, Target, User } from "lucide-react";
import type { WorkerContextView } from "../../hooks/useWorkerContext";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const ERR_TXT = "text-red-600 dark:text-red-400";

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailContextSummaryProps {
  context: WorkerContextView | null | undefined;
}

export function WorkspaceDetailContextSummary({
  context,
}: WorkspaceDetailContextSummaryProps) {
  if (!context) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No context summary available.
      </div>
    );
  }

  const touchedFiles = context.touchedFiles ?? [];

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b ${BORD}">
        <FileText size={13} className={MUT} />
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
          Prompt / Context
        </span>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3 text-xs">
        {/* Goal */}
        {context.goal && (
          <div className="flex items-start gap-2">
            <Target size={12} className={`mt-0.5 shrink-0 ${MUT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-0.5`}>Goal</span>
              <p className={`${TXT} leading-relaxed`}>{context.goal}</p>
            </div>
          </div>
        )}

        {/* Role */}
        {context.role && (
          <div className="flex items-start gap-2">
            <User size={12} className={`mt-0.5 shrink-0 ${MUT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-0.5`}>Role</span>
              <p className={`${TXT} leading-relaxed`}>{context.role}</p>
            </div>
          </div>
        )}

        {/* Role Packet Content */}
        {context.rolePacketContent && (
          <div className="flex items-start gap-2">
            <FileText size={12} className={`mt-0.5 shrink-0 ${MUT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-0.5`}>Role Packet</span>
              <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-words bg-stone-50 dark:bg-[#1A1A1A] rounded p-2 border ${BORD} ${TXT}`}>
                {context.rolePacketContent}
              </pre>
            </div>
          </div>
        )}

        {/* Context Packet Summary */}
        {context.contextPacketSummary && (
          <div className="flex items-start gap-2">
            <FileText size={12} className={`mt-0.5 shrink-0 ${MUT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-0.5`}>Context Summary</span>
              <p className={`${TXT} leading-relaxed`}>{context.contextPacketSummary}</p>
            </div>
          </div>
        )}

        {/* Allowed Files */}
        {context.allowedFiles && context.allowedFiles.length > 0 && (
          <div className="flex items-start gap-2">
            <FileCode size={12} className={`mt-0.5 shrink-0 ${ACC_TXT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-0.5`}>
                Allowed Files ({context.allowedFiles.length})
              </span>
              <div className="flex flex-wrap gap-1">
                {context.allowedFiles.map((f) => (
                  <span
                    key={f}
                    className="inline-block px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Touched Files */}
        {touchedFiles.length > 0 && (
          <div className="flex items-start gap-2">
            <FileCode size={12} className={`mt-0.5 shrink-0 ${MUT}`} />
            <div className="min-w-0 flex-1">
              <span className={`text-[10px] ${MUT} block mb-1`}>
                Touched Files ({touchedFiles.length})
              </span>
              <div className="space-y-0.5">
                {touchedFiles.map((f) => (
                  <div key={f.path} className="flex items-center gap-1 text-[10px] font-mono">
                    <span
                      className={
                        f.change === "created"
                          ? GOOD_TXT
                          : f.change === "modified"
                            ? ACC_TXT
                            : ERR_TXT
                      }
                    >
                      {f.change === "created" ? "+" : f.change === "modified" ? "~" : "-"}
                    </span>
                    <span className={`${MUT} truncate`}>{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
