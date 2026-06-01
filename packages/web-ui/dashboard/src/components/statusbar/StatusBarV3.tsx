/**
 * StatusBarV3 — P42 V3 Status Bar
 *
 * Compact 24px bottom bar showing:
 * - Run ID
 * - Execution status
 * - Workspace counts (active/blocked/complete)
 * - Estimated cost
 * - Token usage
 *
 * Hidden on mobile (<768px).
 */

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusBarV3Props {
  /** Run title / ID. */
  runTitle?: string | null;
  /** Execution status. */
  status?: string;
  /** Workspace queue counts. */
  workspaceCounts?: {
    pending: number;
    active: number;
    blocked: number;
    complete: number;
    failed: number;
  };
  /** Estimated cost in USD. */
  estimatedCost?: string | null;
  /** Token count. */
  tokenCount?: string | null;
  /** Optional cache hit rate. */
  cacheHitRate?: string | null;
  /** Optional burn rate. */
  burnRate?: string | null;
}

// ---------------------------------------------------------------------------
// Status dot color
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case "running":
      return "bg-emerald-500";
    case "paused":
      return "bg-blue-500";
    case "failed":
    case "cancelled":
      return "bg-red-500";
    case "complete":
      return "bg-emerald-500";
    case "stopped":
      return "bg-stone-400";
    default:
      return "bg-stone-300 dark:bg-stone-600";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatusBarV3({
  runTitle,
  status,
  workspaceCounts,
  estimatedCost,
  tokenCount,
  cacheHitRate,
  burnRate,
}: StatusBarV3Props) {
  // Don't render if no execution data
  if (!runTitle && !status && !workspaceCounts) return null;

  const total = workspaceCounts
    ? workspaceCounts.pending +
      workspaceCounts.active +
      workspaceCounts.blocked +
      workspaceCounts.complete +
      workspaceCounts.failed
    : 0;

  return (
    <footer
      className={`hidden md:flex h-6 shrink-0 ${SURF} border-t ${BORD} items-center px-3 gap-3 text-[10px] ${MUT}`}
    >
      {/* Run ID */}
      {runTitle && (
        <span className={`font-medium ${TXT} truncate max-w-[120px]`}>
          {runTitle}
        </span>
      )}

      {/* Status pill */}
      {status && (
        <span className="inline-flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor(status)}`} />
          <span className="capitalize">{status}</span>
        </span>
      )}

      {/* Separator */}
      <span className="text-stone-300 dark:text-stone-600">|</span>

      {/* Workspace counts */}
      {workspaceCounts && (
        <span className="flex items-center gap-2">
          <span>active {workspaceCounts.active}</span>
          <span className="text-stone-300 dark:text-stone-600">/</span>
          <span>{total} workspaces</span>
          {workspaceCounts.blocked > 0 && (
            <>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {workspaceCounts.blocked} blocked
              </span>
            </>
          )}
          {workspaceCounts.failed > 0 && (
            <>
              <span className="text-stone-300 dark:text-stone-600">·</span>
              <span className="text-red-600 dark:text-red-400 font-medium">
                {workspaceCounts.failed} failed
              </span>
            </>
          )}
        </span>
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Cost */}
      {estimatedCost && (
        <span title="Estimated cost">
          ~{estimatedCost}
        </span>
      )}

      {/* Tokens */}
      {tokenCount && (
        <span title="Total tokens">
          {tokenCount} tokens
        </span>
      )}

      {/* Cache hit */}
      {cacheHitRate && (
        <span className="hidden lg:inline" title="Cache hit rate">
          cache {cacheHitRate}
        </span>
      )}

      {/* Burn rate */}
      {burnRate && (
        <span className="hidden lg:inline" title="Burn rate (total tokens / elapsed min)">
          {burnRate}/m
        </span>
      )}
    </footer>
  );
}
