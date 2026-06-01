/**
 * EscalationEvidenceList — Evidence panel for escalations (P42.09).
 *
 * Displays evidence references and log paths that are relevant
 * to a specific escalation. Each evidence item links to the
 * workspace or artifact that produced it.
 *
 * Acceptance Criteria:
 * - Shows evidence references for an escalation
 * - Displays log paths to inspect
 * - Links evidence to workspace detail or transcript URLs
 */

import { FileText, Link2, ScrollText } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscalationEvidenceListProps {
  /** Evidence reference strings (e.g., file paths, event IDs) */
  evidenceRefs?: string[];
  /** Log paths to inspect (e.g., workspace log files) */
  logsToInspect?: string[];
  /** Plan execution ID for building links */
  planExecId?: string;
  /** Workspace ID for building links */
  workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-600 dark:text-blue-400";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EscalationEvidenceList({
  evidenceRefs,
  logsToInspect,
  planExecId,
  workspaceId,
}: EscalationEvidenceListProps) {
  const hasEvidence = evidenceRefs && evidenceRefs.length > 0;
  const hasLogs = logsToInspect && logsToInspect.length > 0;

  if (!hasEvidence && !hasLogs) {
    return (
      <div className={`text-xs ${MUT} italic py-1`}>
        No evidence references available
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${TXT}`}>
      {/* Evidence references */}
      {hasEvidence && (
        <div>
          <div className={`flex items-center gap-1.5 mb-1 ${MUT}`}>
            <Link2 size={10} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              Evidence
            </span>
          </div>
          <ul className="space-y-0.5">
            {evidenceRefs!.map((ref, i) => (
              <li
                key={`ev-${i}`}
                className={`flex items-start gap-1.5 text-[10px] ${ACC_TXT} break-all`}
              >
                <span className="mt-0.5 shrink-0">&#8226;</span>
                <span className={`font-mono ${ACC_TXT}`}>{ref}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Logs to inspect */}
      {hasLogs && (
        <div>
          <div className={`flex items-center gap-1.5 mb-1 ${MUT}`}>
            <ScrollText size={10} />
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              Logs to Inspect
            </span>
          </div>
          <ul className="space-y-0.5">
            {logsToInspect!.map((logPath, i) => (
              <li
                key={`log-${i}`}
                className="flex items-start gap-1.5"
              >
                <FileText size={10} className={`mt-0.5 shrink-0 ${MUT}`} />
                <span className={`text-[10px] font-mono ${TXT} break-all`}>
                  {logPath}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript link */}
      {workspaceId && planExecId && (
        <div className="pt-1">
          <a
            href={`/api/transcript/${planExecId}/${workspaceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1 text-[10px] ${ACC_TXT} hover:underline`}
          >
            <ScrollText size={10} />
            View worker transcript
          </a>
        </div>
      )}
    </div>
  );
}
