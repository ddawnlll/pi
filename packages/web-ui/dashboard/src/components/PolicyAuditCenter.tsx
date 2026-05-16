/**
 * PolicyAuditCenter — Policy and Audit Center UI (P11.R).
 *
 * Aggregates and displays policy and audit events from across the system:
 *   - Skill audit events (denied/allowed invocations)
 *   - Extension lifecycle actions
 *   - Proposal approval actions
 *   - Queue control actions
 *
 * Acceptance Criteria:
 * 1. Can display allow/deny/pending/approved/rejected events.
 * 2. Protected-system approval requests are clearly separated from normal approvals.
 * 3. Audit filters and detail view work for representative event types.
 * 4. Rollback pointers are visible when available.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  CheckCircle,
  FileText,
  Filter,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldOff,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirroring backend)
// ---------------------------------------------------------------------------

type AuditEventSource = "skill" | "extension" | "queue_control" | "proposal" | "execution_archive" | "integration_queue";
type AuditVerdict = "allowed" | "denied" | "pending" | "approved" | "rejected" | "changes_requested" | "info" | "error";

interface UnifiedAuditEvent {
  id: string;
  source: AuditEventSource;
  timestamp: number;
  action: string;
  verdict: AuditVerdict;
  reason: string;
  actor?: string;
  resourceName?: string;
  resourceType?: string;
  protectionLevel?: string | null;
  isProtectedSystemEvent: boolean;
  policyRuleId?: string;
  planExecutionId?: string;
  workspaceId?: string;
  hasRollbackPointer: boolean;
  rollbackPointer?: {
    type: string;
    description: string;
    createdAt: number;
    targetId?: string;
  };
  metadata?: Record<string, unknown>;
}

interface RollbackPoint {
  id: string;
  type: string;
  description: string;
  createdAt: number;
  source: AuditEventSource;
  targetId?: string;
  resourceName?: string;
  events?: UnifiedAuditEvent[];
}

interface PolicyAuditStats {
  totalEvents: number;
  byVerdict: Record<string, number>;
  bySource: Record<string, number>;
  protectedSystemEvents: number;
  rollbackPointCount: number;
  pendingApprovals: number;
  recentDenials: number;
}

interface AuditEventsResponse {
  success: boolean;
  events: UnifiedAuditEvent[];
  total: number;
  filtered: number;
}

interface RollbackPointsResponse {
  success: boolean;
  rollbackPoints: RollbackPoint[];
  total: number;
}

interface StatsResponse {
  success: boolean;
  stats: PolicyAuditStats;
}

// ---------------------------------------------------------------------------
// Styling tokens
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BG = "bg-[#F7F6F3] dark:bg-[#161616]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

const VERDICT_CONFIG: Record<AuditVerdict, { label: string; color: string; bg: string; icon: string }> = {
  allowed:         { label: "Allowed",    color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/40", icon: "check" },
  denied:          { label: "Denied",     color: "text-red-700 dark:text-red-300",          bg: "bg-red-100 dark:bg-red-900/40",         icon: "x" },
  pending:         { label: "Pending",    color: "text-amber-700 dark:text-amber-300",      bg: "bg-amber-100 dark:bg-amber-900/40",     icon: "clock" },
  approved:        { label: "Approved",   color: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-100 dark:bg-emerald-900/40", icon: "check" },
  rejected:        { label: "Rejected",   color: "text-red-700 dark:text-red-300",          bg: "bg-red-100 dark:bg-red-900/40",         icon: "x" },
  changes_requested: { label: "Changes Req.", color: "text-purple-700 dark:text-purple-300", bg: "bg-purple-100 dark:bg-purple-900/40", icon: "edit" },
  info:            { label: "Info",       color: "text-blue-700 dark:text-blue-300",        bg: "bg-blue-100 dark:bg-blue-900/40",       icon: "info" },
  error:           { label: "Error",      color: "text-red-700 dark:text-red-300",          bg: "bg-red-100 dark:bg-red-900/40",         icon: "alert" },
};

const SOURCE_CONFIG: Record<AuditEventSource, { label: string; icon: string }> = {
  skill:            { label: "Skill",           icon: "code" },
  extension:        { label: "Extension",       icon: "puzzle" },
  queue_control:    { label: "Queue Control",   icon: "list" },
  proposal:         { label: "Proposal",        icon: "file" },
  execution_archive: { label: "Execution Archive", icon: "archive" },
  integration_queue: { label: "Integration Queue", icon: "git-branch" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTimestampShort(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return formatTimestamp(ts);
}

function getVerdictIcon(verdict: AuditVerdict) {
  switch (verdict) {
    case "allowed":
    case "approved":     return <CheckCircle size={14} className="text-emerald-500" />;
    case "denied":
    case "rejected":     return <XCircle size={14} className="text-red-500" />;
    case "pending":      return <AlertCircle size={14} className="text-amber-500" />;
    case "changes_requested": return <AlertTriangle size={14} className="text-purple-500" />;
    case "error":        return <XCircle size={14} className="text-red-500" />;
    case "info":
    default:             return <Info size={14} className="text-blue-500" />;
  }
}

function getSourceIcon(source: AuditEventSource) {
  switch (source) {
    case "skill":            return <FileText size={12} />;
    case "extension":        return <Archive size={12} />;
    case "queue_control":    return <Filter size={12} />;
    case "proposal":         return <FileText size={12} />;
    case "integration_queue": return <Filter size={12} />;
    default:                 return <Info size={12} />;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const API_BASE = "";

async function fetchEvents(params: Record<string, string | undefined>): Promise<AuditEventsResponse> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) searchParams.set(k, v); });
  const res = await fetch(`${API_BASE}/api/policy/audit-events?${searchParams.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEventDetail(id: string): Promise<{ success: boolean; event: UnifiedAuditEvent; relatedEvents?: UnifiedAuditEvent[] }> {
  const res = await fetch(`${API_BASE}/api/policy/audit-events/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRollbackPoints(): Promise<RollbackPointsResponse> {
  const res = await fetch(`${API_BASE}/api/policy/rollback-points`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/api/policy/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent, className }: {
  label: string;
  value: string | number;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`${SURF} border ${BORD} rounded-lg px-3 py-2.5 ${className ?? ""}`}>
      <p className={`text-[10px] font-medium uppercase tracking-widest ${MUT}`}>{label}</p>
      <p className={`text-lg font-semibold ${accent ? ACC_TXT : TXT} mt-0.5`}>{value}</p>
    </div>
  );
}

function EventsFilterBar({ sources, verdicts, filters, onChange, onRefresh, loading }: {
  sources: { value: string; label: string; count: number }[];
  verdicts: { value: string; label: string; count: number }[];
  filters: { source: string; verdict: string; protectedOnly: boolean; search: string };
  onChange: (f: typeof filters) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className={`shrink-0 border-b ${BORD} ${SURF} px-3 py-2 space-y-2`}>
      {/* First row: source filter + verdict filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Source filter */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`${MUT} font-medium mr-1`}>Source:</span>
          <button
            onClick={() => onChange({ ...filters, source: "" })}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              !filters.source ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
            }`}
          >
            All
          </button>
          {sources.map((s) => (
            <button
              key={s.value}
              onClick={() => onChange({ ...filters, source: s.value })}
              className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-colors ${
                filters.source === s.value ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
              }`}
            >
              {s.label}
              {s.count > 0 && <span className="text-[9px] opacity-60">({s.count})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Second row: verdict + protected-only toggle + search */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Verdict filter */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`${MUT} font-medium mr-1`}>Verdict:</span>
          <button
            onClick={() => onChange({ ...filters, verdict: "" })}
            className={`px-2 py-1 rounded font-medium transition-colors ${
              !filters.verdict ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
            }`}
          >
            All
          </button>
          {verdicts.map((v) => (
            <button
              key={v.value}
              onClick={() => onChange({ ...filters, verdict: v.value })}
              className={`flex items-center gap-1 px-2 py-1 rounded font-medium transition-colors ${
                filters.verdict === v.value ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
              }`}
            >
              {v.label}
              {v.count > 0 && <span className="text-[9px] opacity-60">({v.count})</span>}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Protected-only toggle */}
        <button
          onClick={() => onChange({ ...filters, protectedOnly: !filters.protectedOnly })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-colors border ${
            filters.protectedOnly
              ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
              : `${BORD} ${MUT} hover:text-stone-600 dark:hover:text-stone-300`
          }`}
        >
          <ShieldAlert size={12} />
          Protected Only
        </button>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] disabled:opacity-40"
        >
          <Loader2 size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );
}

function EventRow({ event, selected, onClick }: {
  event: UnifiedAuditEvent;
  selected: boolean;
  onClick: () => void;
}) {
  const vc = VERDICT_CONFIG[event.verdict] ?? VERDICT_CONFIG.info;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b ${BORD} transition-colors ${
        selected
          ? `${ACC_BG} border-l-2 border-l-blue-500`
          : `hover:bg-stone-50 dark:hover:bg-[#2A2A2A] border-l-2 border-l-transparent`
      } ${event.isProtectedSystemEvent ? "bg-amber-50/50 dark:bg-amber-900/10" : SURF}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Verdict icon */}
        <div className="shrink-0 mt-0.5">{getVerdictIcon(event.verdict)}</div>

        <div className="flex-1 min-w-0">
          {/* Top row: resource name + timestamp */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${TXT} truncate`}>
              {event.resourceName ?? "Unknown"}
            </span>
            <span className={`text-[9px] ${MUT} shrink-0`}>
              {formatTimestampShort(event.timestamp)}
            </span>
          </div>

          {/* Action and verdict */}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${vc.color} ${vc.bg}`}>
              {vc.label}
            </span>
            <span className={`text-[10px] ${MUT}`}>{event.action}</span>
            <span className={`text-[9px] ${MUT} flex items-center gap-0.5`}>
              {getSourceIcon(event.source)}
              {SOURCE_CONFIG[event.source]?.label ?? event.source}
            </span>
          </div>

          {/* Reason */}
          <p className={`text-[10px] ${MUT} mt-0.5 line-clamp-1`}>
            {event.reason}
          </p>

          {/* Footer: actor + rollback pointer + protected badge */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {event.actor && (
              <span className={`text-[9px] ${MUT}`}>By: {event.actor}</span>
            )}
            {event.isProtectedSystemEvent && (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                <ShieldAlert size={9} />
                Protected
              </span>
            )}
            {event.hasRollbackPointer && (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
                <Archive size={9} />
                Rollback Available
              </span>
            )}
            {event.policyRuleId && (
              <span className={`text-[9px] font-mono ${MUT}`}>
                Rule: {event.policyRuleId}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function EventDetailPanel({ event, onClose }: {
  event: UnifiedAuditEvent;
  onClose: () => void;
}) {
  const [detailData, setDetailData] = useState<{ event: UnifiedAuditEvent; relatedEvents?: UnifiedAuditEvent[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchEventDetail(event.id).then((data) => {
      setDetailData(data);
      setLoading(false);
    }).catch(() => {
      setDetailData(null);
      setLoading(false);
    });
  }, [event.id]);

  const vc = VERDICT_CONFIG[event.verdict] ?? VERDICT_CONFIG.info;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD} ${SURF}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
          Event Detail
        </span>
        <button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300`}>
          <XCircle size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-stone-400 dark:text-stone-500" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {/* Event header */}
          <div className={`px-4 py-3 border-b ${BORD} ${SURF}`}>
            <div className="flex items-center gap-2 mb-2">
              {getVerdictIcon(event.verdict)}
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${vc.color} ${vc.bg}`}>
                {vc.label}
              </span>
              <span className={`text-xs ${TXT}`}>{event.action}</span>
            </div>
            <p className={`text-sm font-semibold ${TXT}`}>
              {event.resourceName ?? "Unknown Resource"}
            </p>
            <p className={`text-[11px] ${MUT} mt-1`}>{event.reason}</p>
          </div>

          {/* Event properties */}
          <div className={`px-4 py-3 border-b ${BORD} space-y-2`}>
            <h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
              Properties
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className={MUT}>ID:</span>
                <p className={`font-mono text-[10px] ${TXT} break-all`}>{event.id}</p>
              </div>
              <div>
                <span className={MUT}>Source:</span>
                <p className={TXT}>{SOURCE_CONFIG[event.source]?.label ?? event.source}</p>
              </div>
              <div>
                <span className={MUT}>Timestamp:</span>
                <p className={TXT}>{formatTimestamp(event.timestamp)}</p>
              </div>
              <div>
                <span className={MUT}>Actor:</span>
                <p className={TXT}>{event.actor ?? "—"}</p>
              </div>
              <div>
                <span className={MUT}>Resource Type:</span>
                <p className={TXT}>{event.resourceType ?? "—"}</p>
              </div>
              <div>
                <span className={MUT}>Policy Rule:</span>
                <p className={`font-mono text-[10px] ${TXT}`}>{event.policyRuleId ?? "—"}</p>
              </div>
              <div>
                <span className={MUT}>Plan Exec:</span>
                <p className={`font-mono text-[10px] ${TXT} break-all`}>{event.planExecutionId ?? "—"}</p>
              </div>
              <div>
                <span className={MUT}>Workspace:</span>
                <p className={`font-mono text-[10px] ${TXT}`}>{event.workspaceId ?? "—"}</p>
              </div>
            </div>
          </div>

          {/* Protected system details */}
          {event.isProtectedSystemEvent && (
            <div className={`mx-4 mt-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20`}>
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={14} className="text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Protected System Event
                </span>
              </div>
              <p className={`text-[10px] ${MUT}`}>
                This action involved a protected system. Protection level: {event.protectionLevel ?? "unknown"}
              </p>
            </div>
          )}

          {/* Rollback pointer */}
          {event.hasRollbackPointer && event.rollbackPointer && (
            <div className={`mx-4 mt-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20`}>
              <div className="flex items-center gap-2 mb-1">
                <Archive size={14} className="text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Rollback Available
                </span>
              </div>
              <p className={`text-[10px] ${MUT}`}>
                {event.rollbackPointer.description}
              </p>
              <p className={`text-[9px] font-mono ${MUT} mt-1`}>
                Type: {event.rollbackPointer.type} | Created: {formatTimestampShort(event.rollbackPointer.createdAt)}
              </p>
            </div>
          )}

          {/* Metadata */}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="px-4 py-3">
              <h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
                Metadata
              </h4>
              <pre className={`text-[10px] font-mono ${MUT} bg-stone-50 dark:bg-[#161616] border ${BORD} rounded p-2 max-h-32 overflow-y-auto`}>
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}

          {/* Related events */}
          {detailData?.relatedEvents && detailData.relatedEvents.length > 0 && (
            <div className="px-4 py-3">
              <h4 className={`text-[10px] font-semibold uppercase tracking-widest ${MUT} mb-2`}>
                Related Events ({detailData.relatedEvents.length})
              </h4>
              <div className={`border ${BORD} rounded-lg overflow-hidden divide-y ${BORD}`}>
                {detailData.relatedEvents.map((re) => (
                  <div key={re.id} className={`px-3 py-2 ${SURF} flex items-center gap-2`}>
                    {getVerdictIcon(re.verdict)}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[10px] font-medium ${TXT} truncate`}>
                        {re.resourceName ?? "—"}
                      </p>
                      <p className={`text-[9px] ${MUT}`}>
                        {re.action} · {formatTimestampShort(re.timestamp)}
                      </p>
                    </div>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${VERDICT_CONFIG[re.verdict]?.color ?? ""} ${VERDICT_CONFIG[re.verdict]?.bg ?? ""}`}>
                      {VERDICT_CONFIG[re.verdict]?.label ?? re.verdict}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="h-6" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface PolicyAuditCenterProps {
  className?: string;
}

export function PolicyAuditCenter({ className = "" }: PolicyAuditCenterProps) {
  // State
  const [events, setEvents] = useState<UnifiedAuditEvent[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [stats, setStats] = useState<PolicyAuditStats | null>(null);
  const [rollbackPoints, setRollbackPoints] = useState<RollbackPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filters, setFilters] = useState({ source: "", verdict: "", protectedOnly: false, search: "" });
  const [activeTab, setActiveTab] = useState<"events" | "rollback">("events");

  // Compute source and verdict counts from current data
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.source] = (counts[e.source] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  const verdictCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.verdict] = (counts[e.verdict] ?? 0) + 1;
    }
    return counts;
  }, [events]);

  const sources = useMemo(() => [
    { value: "skill", label: "Skills", count: sourceCounts.skill ?? 0 },
    { value: "extension", label: "Extensions", count: sourceCounts.extension ?? 0 },
    { value: "proposal", label: "Proposals", count: sourceCounts.proposal ?? 0 },
    { value: "queue_control", label: "Queue", count: sourceCounts.queue_control ?? 0 },
  ], [sourceCounts]);

  const verdicts = useMemo(() => [
    { value: "allowed", label: "Allowed", count: verdictCounts.allowed ?? 0 },
    { value: "denied", label: "Denied", count: verdictCounts.denied ?? 0 },
    { value: "approved", label: "Approved", count: verdictCounts.approved ?? 0 },
    { value: "rejected", label: "Rejected", count: verdictCounts.rejected ?? 0 },
    { value: "pending", label: "Pending", count: verdictCounts.pending ?? 0 },
  ], [verdictCounts]);

  // Selected event
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  // Fetch data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, statsRes, rollbackRes] = await Promise.all([
        fetchEvents({}),
        fetchStats(),
        fetchRollbackPoints(),
      ]);
      setEvents(eventsRes.events);
      setTotalEvents(eventsRes.total);
      setStats(statsRes.stats);
      setRollbackPoints(rollbackRes.rollbackPoints);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle filters
  const handleFilterChange = useCallback(async (newFilters: typeof filters) => {
    setFilters(newFilters);
    setLoading(true);
    try {
      const res = await fetchEvents({
        source: newFilters.source || undefined,
        verdict: newFilters.verdict || undefined,
        protectedOnly: newFilters.protectedOnly ? "true" : undefined,
      });
      setEvents(res.events);
      setTotalEvents(res.total);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading && events.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${BG} ${className}`}>
        <div className={`flex items-center gap-2.5 ${MUT} text-sm`}>
          <Loader2 size={16} className="animate-spin" /> Loading Policy & Audit Center...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${BG} ${className}`}>
        <div className="flex flex-col items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle size={24} strokeWidth={1.5} />
          <p>Failed to load policy data</p>
          <p className={`text-xs ${MUT}`}>{error}</p>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full overflow-hidden ${BG} ${className}`}>
      {/* Left: Event list */}
      <div className={`w-96 shrink-0 border-r ${BORD} ${SURF} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className={`shrink-0 flex items-center gap-2 px-4 h-11 border-b ${BORD}`}>
          <ShieldAlert size={14} strokeWidth={1.8} className={ACC_TXT} />
          <span className={`text-xs font-semibold ${TXT}`}>
            Policy & Audit Center
          </span>
          <span className={`text-[9px] ${MUT} ml-auto`}>
            {totalEvents} events
          </span>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className={`shrink-0 grid grid-cols-3 gap-1.5 p-2 border-b ${BORD} bg-stone-50/50 dark:bg-[#1A1A1A]/50`}>
            <StatCard label="Protected" value={stats.protectedSystemEvents} accent />
            <StatCard label="Pending" value={stats.pendingApprovals} />
            <StatCard label="Rollbacks" value={stats.rollbackPointCount} accent />
          </div>
        )}

        {/* Tab bar: Events / Rollback Points */}
        <div className={`shrink-0 flex items-center border-b ${BORD}`}>
          <button
            onClick={() => setActiveTab("events")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
              activeTab === "events"
                ? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
                : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
            }`}
          >
            <Filter size={12} /> Events
            {stats && <span className="text-[9px] opacity-60">({stats.totalEvents})</span>}
          </button>
          <button
            onClick={() => setActiveTab("rollback")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-widest transition-colors ${
              activeTab === "rollback"
                ? `${ACC_TXT} border-b-2 border-blue-500 dark:border-blue-400`
                : `${MUT} hover:text-stone-600 dark:hover:text-stone-300`
            }`}
          >
            <Archive size={12} /> Rollback Points
            {rollbackPoints.length > 0 && <span className="text-[9px] opacity-60">({rollbackPoints.length})</span>}
          </button>
        </div>

        {/* Events tab */}
        {activeTab === "events" && (
          <>
            {/* Filters */}
            <EventsFilterBar
              sources={sources}
              verdicts={verdicts}
              filters={filters}
              onChange={handleFilterChange}
              onRefresh={loadData}
              loading={loading}
            />

            {/* Event list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Protected system events are already in the list but visually separated */}
              {events.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 p-6">
                  <ShieldOff size={28} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
                  <p className={`text-sm ${MUT}`}>No events found</p>
                  <p className={`text-xs ${MUT} text-center`}>
                    Try adjusting your filters or check back later.
                  </p>
                </div>
              ) : (
                events.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    selected={event.id === selectedEventId}
                    onClick={() => setSelectedEventId(event.id)}
                  />
                ))
              )}
            </div>
          </>
        )}

        {/* Rollback Points tab */}
        {activeTab === "rollback" && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {rollbackPoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 p-6">
                <Archive size={28} strokeWidth={1.2} className="text-stone-300 dark:text-stone-600" />
                <p className={`text-sm ${MUT}`}>No rollback points available</p>
                <p className={`text-xs ${MUT} text-center`}>
                  Rollback points are created when extensions are installed or updated.
                </p>
              </div>
            ) : (
              rollbackPoints.map((point) => (
                <div
                  key={point.id}
                  className={`px-4 py-3 border-b ${BORD} ${SURF} hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors`}
                >
                  <div className="flex items-start gap-2.5">
                    <Archive size={14} className="shrink-0 mt-0.5 text-blue-500" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${TXT}`}>{point.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400`}>
                          {point.type}
                        </span>
                        <span className={`text-[9px] ${MUT}`}>
                          Source: {SOURCE_CONFIG[point.source]?.label ?? point.source}
                        </span>
                        <span className={`text-[9px] ${MUT}`}>
                          Created: {formatTimestampShort(point.createdAt)}
                        </span>
                      </div>
                      {point.targetId && (
                        <p className={`text-[9px] font-mono ${MUT} mt-1`}>
                          Target: {point.targetId}
                        </p>
                      )}
                      {point.events && point.events.length > 0 && (
                        <p className={`text-[9px] ${MUT} mt-1`}>
                          {point.events.length} related event(s)
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Right: Event detail */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedEvent ? (
          <EventDetailPanel
            event={selectedEvent}
            onClose={() => setSelectedEventId(null)}
          />
        ) : (
          <div className={`flex flex-col items-center justify-center h-full ${MUT} gap-2`}>
            <ShieldAlert size={28} strokeWidth={1.2} />
            <p className="text-sm">Select an event to view details</p>
            <p className="text-xs">
              Showing {events.length} of {totalEvents} total events
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
