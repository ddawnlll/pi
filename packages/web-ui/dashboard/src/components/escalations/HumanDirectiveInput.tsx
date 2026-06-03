/**
 * HumanDirectiveInput — Inline human directive form (P42.09).
 *
 * Allows issuing a human directive to a workspace through the
 * execution-service-backed `/api/human/directive` endpoint.
 *
 * The component validates inputs and shows mutation states.
 *
 * Acceptance Criteria:
 * - Directive input with severity selector
 * - Sends through execution-service (via web-server endpoint)
 * - Shows loading, success, and error states
 * - Minimal inline footprint
 */

import { useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import { Loader2, Send, AlertTriangle, CheckCircle, MessageSquare } from "lucide-react";
import { useIssueDirective } from "../../hooks/useHumanDirectives";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";

// ---------------------------------------------------------------------------
// Severity options
// ---------------------------------------------------------------------------

const SEVERITIES = [
  { value: "low" as const, label: "Low", color: "text-stone-500", bg: "bg-stone-100 dark:bg-stone-800" },
  { value: "medium" as const, label: "Med", color: ACC_TXT, bg: ACC_BG },
  { value: "high" as const, label: "High", color: WARN_TXT, bg: WARN_BG },
  { value: "blocking" as const, label: "Block", color: ERR_TXT, bg: ERR_BG },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HumanDirectiveInputProps {
  /** Plan execution ID (required to issue) */
  planExecId: string | null;
  /** Workspace ID (required to issue) */
  workspaceId: string | null;
  /** Pre-populated directive text (e.g., from recommended action) */
  initialDirective?: string;
  /** Pre-selected severity */
  initialSeverity?: "low" | "medium" | "high" | "blocking";
  /** Called after a directive is successfully issued */
  onIssued?: () => void;
  /** Optional class name */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HumanDirectiveInput({
  planExecId,
  workspaceId,
  initialDirective = "",
  initialSeverity = "medium",
  onIssued,
  className = "",
}: HumanDirectiveInputProps) {
  const issueMutation = useIssueDirective();
  const [directiveText, setDirectiveText] = useState(initialDirective);
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "blocking">(initialSeverity);
  const [showForm, setShowForm] = useState(!!initialDirective);

  const canIssue = !!planExecId && !!workspaceId && directiveText.trim().length > 0;

  const handleIssue = () => {
    if (!canIssue) return;
    issueMutation.mutate(
      {
        planExecutionId: planExecId!,
        workspaceId: workspaceId!,
        directive: directiveText.trim(),
        severity,
      },
      {
        onSuccess: (data) => {
          if (data.success) {
            setDirectiveText("");
            onIssued?.();
          }
        },
      },
    );
  };

  // ── Success state (self-clearing after 3s) ──
  if (issueMutation.isSuccess && issueMutation.data?.success && !showForm) {
    return (
      <div className={`flex items-center gap-1.5 text-xs ${GOOD_TXT} py-1 ${className}`}>
        <CheckCircle size={10} />
        Directive issued
      </div>
    );
  }

  // ── Collapsed trigger ──
  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className={`inline-flex items-center gap-1 text-xs ${ACC_TXT} hover:underline py-1 ${className}`}
      >
        <MessageSquare size={10} />
        Issue directive
      </button>
    );
  }

  // ── Form ──
  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* Text area */}
      <textarea
        placeholder="Enter a directive for the worker..."
        value={directiveText}
        onChange={(e) => setDirectiveText(e.target.value)}
        className={`w-full text-xs px-2 py-1.5 rounded border ${BORD} bg-transparent ${TXT} placeholder:text-stone-400 resize-none`}
        rows={2}
        disabled={issueMutation.isPending}
      />

      {/* Controls row */}
      <div className="flex items-center gap-1.5">
        {/* Severity selector */}
        {SEVERITIES.map((s) => (
          <button
            key={s.value}
            onClick={() => setSeverity(s.value)}
            disabled={issueMutation.isPending}
            className={`text-xs px-1.5 py-0.5 rounded font-medium transition-colors ${
              severity === s.value
                ? `${s.color} ${s.bg}`
                : `${MUT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
            } disabled:opacity-50`}
          >
            {s.label}
          </button>
        ))}

        {/* Send button */}
        <button
          onClick={handleIssue}
          disabled={!canIssue || issueMutation.isPending}
          className={`ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded font-medium transition-colors ${
            canIssue
              ? `${ACC_BG} ${ACC_TXT} hover:opacity-80`
              : `${MUT} cursor-not-allowed opacity-50`
          }`}
        >
          {issueMutation.isPending ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Send size={10} />
          )}
          Send
        </button>

        {/* Cancel */}
        {!initialDirective && (
          <button
            onClick={() => {
              setShowForm(false);
              setDirectiveText("");
            }}
            className={`text-xs ${MUT} hover:text-stone-600 dark:hover:text-stone-300`}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Error state */}
      {issueMutation.isError && (
        <div className={`flex items-center gap-1 text-xs ${ERR_TXT}`}>
          <AlertTriangle size={10} />
          {issueMutation.error?.message ?? "Failed to issue directive"}
        </div>
      )}

      {/* Server error */}
      {issueMutation.data?.success === false && (
        <div className={`flex items-center gap-1 text-xs ${ERR_TXT}`}>
          <AlertTriangle size={10} />
          {issueMutation.data.error ?? "Directive rejected"}
        </div>
      )}
    </div>
  );
}
