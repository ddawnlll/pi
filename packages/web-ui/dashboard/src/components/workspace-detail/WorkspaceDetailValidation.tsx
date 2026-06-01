/**
 * WorkspaceDetailValidation — Validation evidence section (P42.06).
 *
 * Displays the final validation status for the workspace.
 */

import { CheckCircle, Shield, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import type { ValidationStatus } from "../../hooks/useValidationStatus";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkspaceDetailValidationProps {
  validation: ValidationStatus | undefined;
  isLoading: boolean;
  error: unknown;
}

export function WorkspaceDetailValidation({
  validation,
  isLoading,
  error,
}: WorkspaceDetailValidationProps) {
  // ── Loading state ──
  if (isLoading) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 flex items-center gap-2 text-xs ${MUT}`}>
        <Loader2 size={12} className="animate-spin" />
        Loading validation status...
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs text-red-500`}>
        Failed to load validation status.
      </div>
    );
  }

  // ── Empty state ──
  if (!validation) {
    return (
      <div className={`${SURF} rounded-lg border ${BORD} p-3 text-xs ${MUT}`}>
        No validation data available.
      </div>
    );
  }

  const passed = validation.passed;
  const blocked = validation.blocked;

  return (
    <div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b ${BORD}">
        <Shield size={13} className={MUT} />
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
          Validation Evidence
        </span>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Overall status */}
        {passed === null && !blocked && (
          <div className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
            <span className={`${MUT}`}>
              {validation.required ? "Awaiting validation" : "Validation not required"}
            </span>
          </div>
        )}

        {passed === true && (
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle size={13} className="text-emerald-400" />
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              Validation passed
            </span>
          </div>
        )}

        {passed === false && (
          <div className="flex items-center gap-2 text-xs">
            <XCircle size={13} className="text-red-400" />
            <span className="text-red-600 dark:text-red-400 font-medium">
              Validation failed
            </span>
          </div>
        )}

        {blocked && (
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle size={13} className="text-amber-400" />
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              Blocked
            </span>
          </div>
        )}

        {/* Required flag */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className={MUT}>Required:</span>
          <span className={validation.required ? "text-stone-600 dark:text-stone-300" : MUT}>
            {validation.required ? "Yes" : "No"}
          </span>
        </div>

        {/* Block reasons */}
        {validation.blockReasons && validation.blockReasons.length > 0 && (
          <div className="mt-2">
            <span className={`text-[10px] ${MUT} block mb-1`}>Block Reasons:</span>
            <ul className="space-y-0.5">
              {validation.blockReasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] text-red-600 dark:text-red-400">
                  <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
