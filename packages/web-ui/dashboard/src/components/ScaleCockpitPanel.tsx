/**
 * ScaleCockpitPanel — Dashboard scale cockpit section.
 *
 * Workspace 6.5.A — Scale dashboard information architecture.
 *
 * AC1: Scale cockpit section exists
 * AC2: Worktree, integration queue, conflict, and readiness panels are visible together
 * AC3: Existing live logs and WorkerDetail remain accessible
 * AC4: Dashboard remains responsive
 *
 * Groups the following scale-related panels together:
 * - Worktree status
 * - Integration queue
 * - Merge conflict entries
 * - Scale mode readiness
 */

import {
  AlertTriangle,
  Cpu,
} from "lucide-react";
import { useIntegrationQueueStatus } from "../hooks/useScaleStatus";
import { WorktreeStatusPanel } from "./WorktreeStatusPanel";
import { IntegrationQueuePanel } from "./IntegrationQueuePanel";
import { ScaleModeSettings } from "./ScaleModeSettings";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ─── Main component ─────────────────────────────────────────────────────────

interface ScaleCockpitPanelProps {
  /** Optional class name. */
  className?: string;
}

/**
 * ScaleCockpitPanel component.
 *
 * Displays the full scale cockpit with four panels arranged in a responsive grid:
 * - Worktree status
 * - Integration queue
 * - Scale mode settings
 * - Merge conflict details (inline from IntegrationQueuePanel)
 */
export function ScaleCockpitPanel({ className }: ScaleCockpitPanelProps) {
  const { data: queueData } = useIntegrationQueueStatus();

  const mergeConflicts = queueData?.mergeConflicts ?? [];
  const hasConflicts = mergeConflicts.length > 0;

  return (
    <div className={`overflow-y-auto ${className ?? ""}`}>
      {/* Responsive grid: 2 columns on large screens, 1 on small */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
        {/* Column 1: Worktree + Scale Mode */}
        <div className="space-y-3">
          <WorktreeStatusPanel />
          <ScaleModeSettings />
        </div>

        {/* Column 2: Integration Queue + Merge Conflicts */}
        <div className="space-y-3">
          <IntegrationQueuePanel />

          {/* Inline merge conflict cards */}
          {hasConflicts && (
            <div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-3`}>
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                <h3 className={`text-sm font-semibold ${TXT}`}>Active Merge Conflicts</h3>
                <span className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-[10px] font-medium text-amber-700 dark:text-amber-300`}>
                  <AlertTriangle size={10} />
                  {mergeConflicts.length}
                </span>
              </div>

              <div className="space-y-2">
                {mergeConflicts.map((conflict) => (
                  <div
                    key={conflict.workspaceId}
                    className="bg-amber-50 dark:bg-amber-900/10 rounded px-3 py-2 border border-amber-200 dark:border-amber-800"
                  >
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={12} className="text-amber-600 dark:text-amber-400 shrink-0" />
                      <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        {conflict.workspaceId}
                      </span>
                      <span className={`text-[10px] ${MUT} ml-auto`}>
                        {new Date(conflict.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {conflict.conflictedFiles.length > 0 && (
                      <ul className="mt-1 text-[10px] font-mono text-amber-600 dark:text-amber-400 list-disc list-inside">
                        {conflict.conflictedFiles.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    )}
                    {conflict.diff && (
                      <pre className="mt-1 text-[9px] font-mono text-amber-600 dark:text-amber-400 whitespace-pre-wrap max-h-20 overflow-y-auto">
                        {conflict.diff.slice(0, 500)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              <p className={`text-[10px] leading-tight ${MUT}`}>
                Merge conflicts block the integration queue. Each conflict must be
                resolved before processing can continue.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom help text */}
      <div className={`px-3 pb-3`}>
        <div className={`${SURF} rounded-lg border ${BORD} p-3`}>
          <div className="flex items-center gap-2">
            <Cpu size={15} className={ACC_TXT} />
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
              Scale Cockpit
            </span>
          </div>
          <p className={`text-[10px] leading-tight mt-1.5 ${MUT}`}>
            The scale cockpit provides operational visibility into scaled multi-worker execution.
            Worktree isolation, integration queue, and validation lock must all be satisfied
            before scale mode can be enabled.{' '}
            <strong>Current stable default: 3 workers.</strong>
            {' '}Use the panels above to monitor status and resolve any blocking issues.
          </p>
        </div>
      </div>
    </div>
  );
}
