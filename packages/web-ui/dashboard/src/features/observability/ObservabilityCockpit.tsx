/**
 * ObservabilityCockpit — Local Observability Cockpit UI (25.H).
 *
 * The Observability Cockpit provides a unified dashboard for viewing
 * telemetry events, statistics, error analysis, and time-series data
 * collected from the local observability system.
 *
 * Acceptance Criteria:
 * 1. Dashboard renders summary cards, time-series chart, error analysis,
 *    recent events table, and retention policy info.
 * 2. All states are covered: loading, empty, error, and data-present.
 * 3. Filters allow narrowing by severity, source, event type, and time range.
 * 4. Clicking an event row expands the full event detail in a side panel.
 * 5. Time-series data updates when time range changes.
 * 6. All autonomous polling has explicit intervals and stop-condition handling.
 * 7. Failures surface evidence-backed diagnostics rather than silent errors.
 */

import { useCallback, useMemo, useState } from "react";
import {
	Activity,
	AlertCircle,
	AlertTriangle,
	ArrowDown,
	ArrowUp,
	BarChart3,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Clock,
	Database,
	ExternalLink,
	Filter,
	Info,
	Loader2,
	RefreshCw,
	Search,
	XCircle,
} from "lucide-react";
import {
	useTelemetryDashboard,
	useTelemetryEvents,
	useTelemetryErrors,
	useTelemetryRetentionPolicy,
	useTelemetryStats,
	useTelemetryTimeSeries,
} from "../../hooks/useTelemetry";
import { HealthSummary } from "./HealthSummary";
import { TraceTimeline } from "./TraceTimeline";
import type { ObservabilityEvent, ObservabilitySeverity } from "../../types-observability";

// ─── Style constants ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const GOOD_BG = "bg-emerald-50 dark:bg-emerald-900/20";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const INFO_BG = "bg-blue-50 dark:bg-blue-900/20";
const INFO_TXT = "text-blue-600 dark:text-blue-400";

// ─── Time range presets ───────────────────────────────────────────────────────

interface TimePreset {
	label: string;
	since: () => string;
}

function hoursAgo(h: number): string {
	return new Date(Date.now() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
	return new Date(Date.now() - d * 86_400_000).toISOString();
}

const TIME_PRESETS: TimePreset[] = [
	{ label: "Last hour", since: () => hoursAgo(1) },
	{ label: "Last 6 hours", since: () => hoursAgo(6) },
	{ label: "Last 24 hours", since: () => hoursAgo(24) },
	{ label: "Last 7 days", since: () => daysAgo(7) },
	{ label: "Last 30 days", since: () => daysAgo(30) },
];

const UNTIL_NOW = () => new Date().toISOString();

// ─── Severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_ORDER: ObservabilitySeverity[] = ["critical", "error", "warning", "info", "debug"];

const SEVERITY_META: Record<ObservabilitySeverity, { bg: string; txt: string; label: string }> = {
	critical: { bg: "bg-red-100 dark:bg-red-900/40", txt: "text-red-700 dark:text-red-300", label: "CRITICAL" },
	error: { bg: "bg-red-50 dark:bg-red-900/20", txt: "text-red-600 dark:text-red-400", label: "ERROR" },
	warning: { bg: "bg-amber-50 dark:bg-amber-900/20", txt: "text-amber-600 dark:text-amber-400", label: "WARN" },
	info: { bg: "bg-blue-50 dark:bg-blue-900/20", txt: "text-blue-600 dark:text-blue-400", label: "INFO" },
	debug: { bg: "bg-stone-100 dark:bg-stone-800/30", txt: "text-stone-500 dark:text-stone-400", label: "DEBUG" },
};

function SeverityBadge({ severity }: { severity: ObservabilitySeverity }) {
	const m = SEVERITY_META[severity] ?? SEVERITY_META.info;
	return (
		<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${m.bg} ${m.txt}`}>
			{m.label}
		</span>
	);
}

function SeverityDot({ severity }: { severity: ObservabilitySeverity }) {
	const colors: Record<string, string> = {
		critical: "bg-red-500",
		error: "bg-red-400",
		warning: "bg-amber-400",
		info: "bg-blue-400",
		debug: "bg-stone-400",
	};
	return <span className={`inline-block w-2 h-2 rounded-full ${colors[severity] ?? "bg-stone-400"}`} />;
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
	icon: React.ReactNode;
	label: string;
	value: string | number | null | undefined;
	sub?: string;
	accent?: boolean;
	loading?: boolean;
	error?: string | null;
}

function StatCard({ icon, label, value, sub, accent, loading, error: err }: StatCardProps) {
	return (
		<div className={`${SURF} rounded-lg border ${BORD} p-3 space-y-1 min-h-[80px] ${accent ? "ring-1 ring-blue-200 dark:ring-blue-800" : ""}`}>
			<div className="flex items-center gap-1.5">
				<span className={`${accent ? ACC_TXT : MUT}`}>{icon}</span>
				<span className={`text-[11px] font-medium uppercase tracking-wider ${MUT}`}>{label}</span>
			</div>
			{loading ? (
				<div className="flex items-center gap-2">
					<Loader2 size={14} className="animate-spin text-stone-400" />
					<span className={`text-sm ${MUT}`}>Loading...</span>
				</div>
			) : err ? (
				<div className="flex items-center gap-1.5">
					<AlertCircle size={14} className={ERR_TXT} />
					<span className={`text-sm ${ERR_TXT}`}>{err}</span>
				</div>
			) : (
				<>
					<div className={`text-lg font-semibold ${accent ? ACC_TXT : TXT}`}>
						{value != null ? value : "\u2014"}
					</div>
					{sub && <div className={`text-[11px] ${MUT}`}>{sub}</div>}
				</>
			)}
		</div>
	);
}

// ─── Simple bar chart component ───────────────────────────────────────────────

interface SimpleBarChartProps {
	data: Array<{
		label: string;
		value: number;
		color?: string;
	}>;
	height?: number;
	maxValue?: number;
}

function SimpleBarChart({ data, height = 80, maxValue }: SimpleBarChartProps) {
	const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);
	if (data.length === 0) {
		return (
			<div className={`flex items-center justify-center h-[${height}px] text-xs ${MUT}`}>
				No data
			</div>
		);
	}
	return (
		<div className="flex items-end gap-1" style={{ height }}>
			{data.map((d, i) => {
				const h = max > 0 ? (d.value / max) * 100 : 0;
				return (
					<div
						key={i}
						className="flex-1 flex flex-col items-center gap-1 group relative"
						title={`${d.label}: ${d.value}`}
					>
						<div
							className={`w-full rounded-t ${d.color ?? "bg-blue-400 dark:bg-blue-600"} transition-all duration-200 hover:opacity-80 min-h-[2px]`}
							style={{ height: `${Math.max(h, 2)}%` }}
						/>
						{data.length <= 12 && (
							<span className={`text-[8px] ${MUT} truncate w-full text-center`}>
								{d.label}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}

// ─── Event detail panel ───────────────────────────────────────────────────────

interface EventDetailPanelProps {
	event: ObservabilityEvent | null;
	onClose: () => void;
}

function EventDetailPanel({ event, onClose }: EventDetailPanelProps) {
	if (!event) return null;

	const meta = SEVERITY_META[event.severity] ?? SEVERITY_META.info;

	const rows: Array<{ label: string; value: string | null }> = [
		{ label: "ID", value: event.id },
		{ label: "Timestamp", value: event.timestamp },
		{ label: "Event Type", value: event.eventType },
		{ label: "Source", value: event.source },
		{ label: "Severity", value: event.severity },
		{ label: "Status", value: event.status },
		{ label: "Name", value: event.name },
		{ label: "Message", value: event.message },
		{ label: "Trace ID", value: event.traceId },
		{ label: "Span ID", value: event.spanId },
		{ label: "Parent Span ID", value: event.parentSpanId },
		{ label: "Correlation ID", value: event.correlationId },
		{ label: "Project ID", value: event.projectId },
		{ label: "Plan Execution ID", value: event.planExecutionId },
		{ label: "Workspace Execution ID", value: event.workspaceExecutionId },
		{ label: "Duration (ms)", value: event.durationMs != null ? String(event.durationMs) : null },
		{ label: "Error", value: event.error },
	];

	return (
		<div className={`border-l ${BORD} ${SURF} flex flex-col overflow-hidden w-80 shrink-0`}>
			<div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD}`}>
				<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>Event Detail</span>
				<button onClick={onClose} className={`${MUT} hover:text-stone-700 dark:hover:text-stone-300 p-1`}>
					<XCircle size={14} />
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
				<div className="flex items-center gap-2 mb-3">
					<SeverityBadge severity={event.severity} />
					<span className={`text-[11px] font-mono ${MUT}`}>{event.eventType}</span>
				</div>
				{rows.map((row) => (
					<div key={row.label} className="flex flex-col gap-0.5">
						<span className={`text-[10px] uppercase tracking-wider ${MUT}`}>{row.label}</span>
						<span className={`${TXT} font-mono text-[11px] break-all`}>
							{row.value ?? "\u2014"}
						</span>
					</div>
				))}
				{Object.keys(event.data).length > 0 && (
					<div className="flex flex-col gap-0.5">
						<span className={`text-[10px] uppercase tracking-wider ${MUT}`}>Data</span>
						<pre className={`text-[11px] font-mono ${TXT} bg-stone-50 dark:bg-[#161616] rounded p-2 border ${BORD} overflow-x-auto max-h-48`}>
							{JSON.stringify(event.data, null, 2)}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}

// ─── Tab type ─────────────────────────────────────────────────────────────────

type TabId = "overview" | "events" | "errors" | "traces";

// ─── Main component ───────────────────────────────────────────────────────────

interface ObservabilityCockpitProps {
	className?: string;
}

export function ObservabilityCockpit({ className = "" }: ObservabilityCockpitProps) {
	// ── State ──────────────────────────────────────────────────────────────
	const [activeTab, setActiveTab] = useState<TabId>("overview");
	const [selectedEvent, setSelectedEvent] = useState<ObservabilityEvent | null>(null);
	const [timePreset, setTimePreset] = useState<(typeof TIME_PRESETS)[number]>(TIME_PRESETS[2]); // Last 24h
	const [bucketWidthPreset, setBucketWidthPreset] = useState<string>("1h");
	const [severityFilter, setSeverityFilter] = useState<string>("");
	const [sourceFilter, setSourceFilter] = useState<string>("");
	const [eventTypeFilter, setEventTypeFilter] = useState<string>("");
	const [eventsPage, setEventsPage] = useState(0);
	const [showFilters, setShowFilters] = useState(false);
	const EVENTS_PER_PAGE = 50;

	const since = timePreset.since();
	const until = UNTIL_NOW();

	const bucketWidthMs = bucketWidthPreset === "30m" ? 1_800_000
		: bucketWidthPreset === "1h" ? 3_600_000
		: bucketWidthPreset === "6h" ? 21_600_000
		: bucketWidthPreset === "1d" ? 86_400_000
		: 3_600_000;

	// ── Data hooks ─────────────────────────────────────────────────────────
	const {
		summary,
		loading: dashLoading,
		error: dashError,
	} = useTelemetryDashboard({ since, until });

	const {
		stats,
		loading: statsLoading,
		error: statsError,
	} = useTelemetryStats({
		since,
		until,
		severity: severityFilter || undefined,
		source: sourceFilter || undefined,
		eventType: eventTypeFilter || undefined,
	});

	const {
		events,
		total: eventsTotal,
		loading: eventsLoading,
		error: eventsError,
	} = useTelemetryEvents({
		since,
		until,
		severity: severityFilter || undefined,
		source: sourceFilter || undefined,
		eventType: eventTypeFilter || undefined,
		limit: EVENTS_PER_PAGE,
		offset: eventsPage * EVENTS_PER_PAGE,
		order: "desc",
	});

	const {
		analysis,
		loading: errorsLoading,
		error: errorsError,
	} = useTelemetryErrors({
		limit: 10,
		since,
		until,
	});

	const {
		timeSeries,
		loading: tsLoading,
		error: tsError,
	} = useTelemetryTimeSeries(since, until, bucketWidthMs);

	const {
		policy,
		loading: policyLoading,
	} = useTelemetryRetentionPolicy();

	// ── Derived data ───────────────────────────────────────────────────────

	// Time-series bar data
	const tsBarData = useMemo(() => {
		if (!timeSeries?.buckets) return [];
		return timeSeries.buckets.map((b) => ({
			label: new Date(b.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
			value: b.count,
			color: b.count > 0
				? "bg-blue-400 dark:bg-blue-600"
				: "bg-stone-200 dark:bg-stone-700",
		}));
	}, [timeSeries]);

	// Severity breakdown for summary cards
	const severityCards = useMemo(() => {
		if (!stats?.bySeverity) return [];
		return SEVERITY_ORDER
			.filter((s) => (stats.bySeverity[s] ?? 0) > 0)
			.map((s) => ({
				severity: s,
				count: stats.bySeverity[s] ?? 0,
				meta: SEVERITY_META[s],
			}));
	}, [stats]);

	// Sources from stats
	const topSources = useMemo(() => {
		if (!summary?.topSources) return [];
		return summary.topSources.slice(0, 5);
	}, [summary]);

	// ── Handlers ───────────────────────────────────────────────────────────

	const handleViewEvent = useCallback((event: ObservabilityEvent) => {
		setSelectedEvent((prev) => (prev?.id === event.id ? null : event));
	}, []);

	const handleRetry = useCallback(() => {
		setSelectedEvent(null);
		setEventsPage(0);
	}, []);

	const formatTime = (iso: string) => {
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	};

	const formatDuration = (ms: number | null | undefined) => {
		if (ms == null) return "\u2014";
		if (ms < 1000) return `${ms.toFixed(0)}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60_000).toFixed(1)}m`;
	};

	const formatPercent = (v: number | null | undefined) => {
		if (v == null) return "\u2014";
		return `${(v * 100).toFixed(1)}%`;
	};

	const totalPages = Math.max(1, Math.ceil(eventsTotal / EVENTS_PER_PAGE));

	// ── Render ─────────────────────────────────────────────────────────────

	return (
		<div className={`flex min-h-0 ${className}`}>
			{/* Main content */}
			<div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
				{/* Header */}
				<div className={`shrink-0 flex items-center justify-between px-4 h-10 border-b ${BORD} ${SURF}`}>
					<div className="flex items-center gap-2">
						<Activity size={15} className={ACC_TXT} />
						<span className={`text-sm font-semibold ${TXT}`}>Observability Cockpit</span>
					</div>
					<div className="flex items-center gap-2">
						{/* Time range selector */}
						<select
							value={timePreset.label}
							onChange={(e) => {
								const preset = TIME_PRESETS.find((p) => p.label === e.target.value);
								if (preset) setTimePreset(preset);
							}}
							className={`text-[11px] px-2 py-1 rounded border ${BORD} ${SURF} ${TXT} outline-none`}
						>
							{TIME_PRESETS.map((p) => (
								<option key={p.label} value={p.label}>{p.label}</option>
							))}
						</select>
						<button
							onClick={handleRetry}
							className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
							title="Retry data fetch"
						>
							<RefreshCw size={12} />
							Refresh
						</button>
					</div>
				</div>

				{/* Tab bar */}
				<div className={`shrink-0 flex items-center gap-0.5 px-3 border-b ${BORD} ${SURF}`}>
					{([
						{ id: "overview" as TabId, label: "Overview", icon: BarChart3 },
						{ id: "events" as TabId, label: "Events", icon: Search },
						{ id: "errors" as TabId, label: "Errors", icon: AlertTriangle },
						{ id: "traces" as TabId, label: "Traces", icon: Activity },
					]).map((tab) => {
						const Icon = tab.icon;
						const isActive = activeTab === tab.id;
						return (
							<button
								key={tab.id}
								onClick={() => setActiveTab(tab.id)}
								className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
									isActive
										? "border-blue-500 text-blue-700 dark:text-blue-300"
										: `border-transparent ${MUT} hover:text-stone-700 dark:hover:text-stone-300`
								}`}
							>
								<Icon size={13} />
								{tab.label}
							</button>
						);
					})}
					<div className="flex-1" />
					{/* Filter toggle */}
					<button
						onClick={() => setShowFilters(!showFilters)}
						className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded ${
							showFilters ? `${ACC_BG} ${ACC_TXT}` : `${MUT} hover:text-stone-700 dark:hover:text-stone-300`
						}`}
					>
						<Filter size={12} />
						Filters
						{(severityFilter || sourceFilter || eventTypeFilter) && (
							<span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
						)}
					</button>
				</div>

				{/* Filter bar */}
				{showFilters && (
					<div className={`shrink-0 flex items-center gap-3 px-3 py-2 border-b ${BORD} ${SURF}`}>
						<div className="flex items-center gap-1.5">
							<span className={`text-[10px] uppercase tracking-wider ${MUT}`}>Severity</span>
							<select
								value={severityFilter}
								onChange={(e) => { setSeverityFilter(e.target.value); setEventsPage(0); }}
								className={`text-[11px] px-2 py-1 rounded border ${BORD} ${SURF} ${TXT} outline-none`}
							>
								<option value="">All</option>
								{SEVERITY_ORDER.map((s) => (
									<option key={s} value={s}>{s.toUpperCase()}</option>
								))}
							</select>
						</div>
						<div className="flex items-center gap-1.5">
							<span className={`text-[10px] uppercase tracking-wider ${MUT}`}>Source</span>
							<input
								type="text"
								value={sourceFilter}
								onChange={(e) => { setSourceFilter(e.target.value); setEventsPage(0); }}
								placeholder="Filter source..."
								className={`text-[11px] px-2 py-1 rounded border ${BORD} ${SURF} ${TXT} outline-none w-32`}
							/>
						</div>
						<div className="flex items-center gap-1.5">
							<span className={`text-[10px] uppercase tracking-wider ${MUT}`}>Event Type</span>
							<input
								type="text"
								value={eventTypeFilter}
								onChange={(e) => { setEventTypeFilter(e.target.value); setEventsPage(0); }}
								placeholder="Filter type..."
								className={`text-[11px] px-2 py-1 rounded border ${BORD} ${SURF} ${TXT} outline-none w-32`}
							/>
						</div>
						{(severityFilter || sourceFilter || eventTypeFilter) && (
							<button
								onClick={() => {
									setSeverityFilter("");
									setSourceFilter("");
									setEventTypeFilter("");
									setEventsPage(0);
								}}
								className={`text-[11px] px-2 py-1 rounded ${ERR_TXT} hover:${ERR_BG}`}
							>
								Clear
							</button>
						)}
					</div>
				)}

				{/* ── Tab content ── */}
				<div className="flex-1 min-h-0 overflow-y-auto">
					{activeTab === "overview" && (
						<div className="p-3 space-y-4">
							{/* Summary cards */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
								<StatCard
									icon={<Activity size={14} />}
									label="Total Events"
									value={summary?.totalEvents ?? stats?.totalCount}
									loading={dashLoading || statsLoading}
									error={dashError || statsError}
								/>
								<StatCard
									icon={<XCircle size={14} />}
									label="Errors"
									value={stats?.errorCount}
									sub={formatPercent(stats?.errorRate)}
									accent={(stats?.errorCount ?? 0) > 0}
									loading={statsLoading}
									error={statsError}
								/>
								<StatCard
									icon={<Clock size={14} />}
									label="Avg Duration"
									value={formatDuration(summary?.avgDurationMs)}
									loading={dashLoading}
									error={dashError}
								/>
								<StatCard
									icon={<Database size={14} />}
									label="Top Source"
									value={topSources[0]?.source ?? "\u2014"}
									sub={topSources[0] ? `${topSources[0].count} events` : undefined}
									loading={dashLoading}
									error={dashError}
								/>
							</div>

							{/* Severity breakdown */}
							{severityCards.length > 0 && (
								<div className={`${SURF} rounded-lg border ${BORD} p-3`}>
									<h3 className={`text-[11px] font-semibold uppercase tracking-wider ${MUT} mb-2`}>
										Severity Breakdown
									</h3>
									<div className="flex gap-2">
										{severityCards.map((sc) => (
											<div
												key={sc.severity}
												className={`flex-1 rounded-lg p-2.5 ${sc.meta.bg} border ${BORD}`}
											>
												<div className={`flex items-center gap-1.5 mb-1`}>
													<SeverityDot severity={sc.severity} />
													<span className={`text-[10px] font-semibold uppercase ${sc.meta.txt}`}>
														{sc.meta.label}
													</span>
												</div>
												<div className={`text-lg font-semibold ${TXT}`}>{sc.count}</div>
											</div>
										))}
									</div>
								</div>
							)}

							{/* Time-series chart */}
							<div className={`${SURF} rounded-lg border ${BORD} p-3`}>
								<div className="flex items-center justify-between mb-2">
									<h3 className={`text-[11px] font-semibold uppercase tracking-wider ${MUT}`}>
										Events Over Time
									</h3>
									<div className="flex items-center gap-1">
										{["30m", "1h", "6h", "1d"].map((w) => (
											<button
												key={w}
												onClick={() => setBucketWidthPreset(w)}
												className={`text-[10px] px-1.5 py-0.5 rounded ${
													bucketWidthPreset === w
														? `${ACC_BG} ${ACC_TXT}`
														: `${MUT} hover:text-stone-700 dark:hover:text-stone-300`
												}`}
											>
												{w}
											</button>
										))}
									</div>
								</div>
								{tsLoading ? (
									<div className="flex items-center justify-center h-20 text-xs text-stone-400">
										<Loader2 size={14} className="animate-spin mr-2" />
										Loading time-series...
									</div>
								) : tsError ? (
									<div className={`flex items-center justify-center h-20 text-xs ${ERR_TXT} gap-1.5`}>
										<AlertCircle size={14} />
										{tsError}
									</div>
								) : tsBarData.length === 0 ? (
									<div className={`flex items-center justify-center h-20 text-xs ${MUT}`}>
										No time-series data available
									</div>
								) : (
									<SimpleBarChart data={tsBarData} height={100} />
								)}
								{timeSeries?.buckets && (
									<div className={`text-[10px] ${MUT} mt-1 text-right`}>
										{timeSeries.buckets.reduce((s, b) => s + b.count, 0)} total events
										{timeSeries.buckets.length > 0 && ` in ${timeSeries.buckets.length} buckets`}
									</div>
								)}
							</div>

							{/* Top sources */}
							{topSources.length > 0 && (
								<div className={`${SURF} rounded-lg border ${BORD} p-3`}>
									<h3 className={`text-[11px] font-semibold uppercase tracking-wider ${MUT} mb-2`}>
										Top Sources
									</h3>
									<div className="space-y-1">
										{topSources.map((s) => {
											const maxCount = topSources[0]?.count ?? 1;
											const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
											return (
												<div key={s.source} className="flex items-center gap-2">
													<span className={`text-xs ${TXT} w-24 truncate`} title={s.source}>{s.source}</span>
													<div className="flex-1 h-4 bg-stone-100 dark:bg-stone-800 rounded overflow-hidden">
														<div
															className="h-full bg-blue-400 dark:bg-blue-600 rounded transition-all"
															style={{ width: `${pct}%` }}
														/>
													</div>
													<span className={`text-[11px] font-mono ${MUT} w-12 text-right`}>{s.count}</span>
												</div>
											);
										})}
									</div>
								</div>
							)}

							{/* Retention policy */}
							{policy && (
								<div className={`${SURF} rounded-lg border ${BORD} p-3`}>
									<h3 className={`text-[11px] font-semibold uppercase tracking-wider ${MUT} mb-2`}>
										Retention Policy: {policy.name}
									</h3>
									<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
										{policy.rules.map((rule) => (
											<div key={rule.name} className={`rounded-md p-2 border ${BORD} ${SURF}`}>
												<div className={`text-[10px] font-semibold uppercase ${rule.severity ? (SEVERITY_META[rule.severity as ObservabilitySeverity]?.txt ?? TXT) : TXT}`}>
													{rule.name}
												</div>
												<div className={`text-[10px] ${MUT} mt-1`}>
													Max age: {rule.maxAgeMs >= 86_400_000
														? `${Math.round(rule.maxAgeMs / 86_400_000)}d`
														: rule.maxAgeMs >= 3_600_000
															? `${Math.round(rule.maxAgeMs / 3_600_000)}h`
															: `${Math.round(rule.maxAgeMs / 60_000)}m`}
												</div>
												<div className={`text-[10px] ${MUT}`}>
													Max count: {rule.maxCount.toLocaleString()}
												</div>
											</div>
										))}
									</div>
									{policy.globalMaxCount && (
										<div className={`text-[10px] ${MUT} mt-2`}>
											Global max: {policy.globalMaxCount.toLocaleString()} events
										</div>
									)}
								</div>
							)}

							{/* No data state */}
							{!dashLoading && !statsLoading && !summary && !stats && (
								<div className={`flex flex-col items-center justify-center py-12 gap-3 ${MUT}`}>
									<BarChart3 size={32} strokeWidth={1} className="text-stone-300 dark:text-stone-600" />
									<p className="text-sm">No telemetry data available</p>
									<p className={`text-xs max-w-md text-center`}>
										Telemetry events are collected during plan execution. Upload and run a plan to populate the observability dashboard.
									</p>
								</div>
							)}
						</div>
					)}

					{activeTab === "events" && (
						<div className="flex flex-col h-full">
							{/* Events table */}
							<div className="flex-1 overflow-y-auto">
								{eventsLoading && events.length === 0 ? (
									<div className="flex items-center justify-center h-32 gap-2 text-xs text-stone-400">
										<Loader2 size={14} className="animate-spin" />
										Loading events...
									</div>
								) : eventsError ? (
									<div className={`flex flex-col items-center justify-center h-32 gap-2 text-xs ${ERR_TXT}`}>
										<AlertCircle size={16} />
										<span>{eventsError}</span>
										<button onClick={handleRetry} className={`underline hover:no-underline ${ACC_TXT}`}>
											Retry
										</button>
									</div>
								) : events.length === 0 ? (
									<div className={`flex flex-col items-center justify-center h-32 gap-2 text-xs ${MUT}`}>
										<Search size={16} />
										<span>No events match the current filters</span>
									</div>
								) : (
									<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
										{/* Header */}
										<div className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${MUT} sticky top-0 ${SURF} border-b ${BORD}`}>
											<span className="w-16">Severity</span>
											<span className="w-28">Timestamp</span>
											<span className="w-24">Type</span>
											<span className="w-28">Source</span>
											<span className="flex-1">Name / Message</span>
											<span className="w-16 text-right">Duration</span>
										</div>
										{events.map((event) => {
											const isSelected = selectedEvent?.id === event.id;
											return (
												<button
													key={event.id}
													onClick={() => handleViewEvent(event)}
													className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-stone-50 dark:hover:bg-[#2A2A2A] ${
														isSelected ? ACC_BG : ""
													}`}
												>
													<span className="w-16 shrink-0">
														<SeverityBadge severity={event.severity} />
													</span>
													<span className={`w-28 shrink-0 font-mono text-[10px] ${MUT}`}>
														{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
													</span>
													<span className={`w-24 shrink-0 font-mono text-[10px] ${TXT} truncate`}>
														{event.eventType}
													</span>
													<span className={`w-28 shrink-0 text-[10px] ${MUT} truncate`} title={event.source}>
														{event.source}
													</span>
													<span className={`flex-1 text-[11px] ${TXT} truncate`}>
														{event.name}
														{event.message && (
															<span className={`${MUT} ml-1`}>
																\u2014 {event.message}
															</span>
														)}
													</span>
													<span className={`w-16 shrink-0 text-right font-mono text-[10px] ${MUT}`}>
														{formatDuration(event.durationMs)}
													</span>
												</button>
											);
										})}
									</div>
								)}
							</div>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className={`shrink-0 flex items-center justify-between px-3 py-2 border-t ${BORD} ${SURF}`}>
									<span className={`text-[11px] ${MUT}`}>
										{eventsTotal} events total
									</span>
									<div className="flex items-center gap-1">
										<button
											onClick={() => setEventsPage((p) => Math.max(0, p - 1))}
											disabled={eventsPage === 0}
											className={`text-[11px] px-2 py-1 rounded ${
												eventsPage === 0
													? `${MUT} cursor-not-allowed`
													: `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
											}`}
										>
											<ArrowUp size={12} />
										</button>
										<span className={`text-[11px] ${MUT} px-2`}>
											{eventsPage + 1} / {totalPages}
										</span>
										<button
											onClick={() => setEventsPage((p) => Math.min(totalPages - 1, p + 1))}
											disabled={eventsPage >= totalPages - 1}
											className={`text-[11px] px-2 py-1 rounded ${
												eventsPage >= totalPages - 1
													? `${MUT} cursor-not-allowed`
													: `${TXT} hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
											}`}
										>
											<ArrowDown size={12} />
										</button>
									</div>
								</div>
							)}
						</div>
					)}

					{activeTab === "errors" && (
						<div className="p-3 space-y-4">
							{errorsLoading && !analysis ? (
								<div className="flex items-center justify-center h-32 gap-2 text-xs text-stone-400">
									<Loader2 size={14} className="animate-spin" />
									Loading error analysis...
								</div>
							) : errorsError ? (
								<div className={`flex flex-col items-center justify-center h-32 gap-2 text-xs ${ERR_TXT}`}>
									<AlertCircle size={16} />
									<span>{errorsError}</span>
								</div>
							) : !analysis || analysis.totalErrors === 0 ? (
								<div className={`flex flex-col items-center justify-center py-12 gap-3 ${MUT}`}>
									<CheckCircle2 size={32} strokeWidth={1} className="text-stone-300 dark:text-stone-600" />
									<p className="text-sm">No errors found</p>
									<p className={`text-xs max-w-md text-center`}>
										No error or critical events were recorded in the selected time range.
									</p>
								</div>
							) : (
								<>
									{/* Error summary */}
									<div className={`${SURF} rounded-lg border ${BORD} p-3`}>
										<div className="flex items-center gap-2 mb-2">
											<AlertTriangle size={16} className={ERR_TXT} />
											<h3 className={`text-sm font-semibold ${ERR_TXT}`}>
												{analysis.totalErrors} Error{analysis.totalErrors !== 1 ? "s" : ""} Found
											</h3>
										</div>
										<div className="grid grid-cols-2 gap-3">
											<div>
												<h4 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
													By Source
												</h4>
												<div className="space-y-1">
													{analysis.bySource.map((s) => (
														<div key={s.source} className="flex items-center justify-between text-xs">
															<span className={`${TXT} truncate flex-1`} title={s.source}>{s.source}</span>
															<span className={`font-mono ${ERR_TXT} ml-2`}>{s.count}</span>
														</div>
													))}
												</div>
											</div>
											<div>
												<h4 className={`text-[10px] font-semibold uppercase tracking-wider ${MUT} mb-1`}>
													By Event Type
												</h4>
												<div className="space-y-1">
													{analysis.byEventType.map((et) => (
														<div key={et.eventType} className="flex items-center justify-between text-xs">
															<span className={`${TXT}`}>{et.eventType}</span>
															<span className={`font-mono ${ERR_TXT}`}>{et.count}</span>
														</div>
													))}
												</div>
											</div>
										</div>
									</div>

									{/* Recent errors */}
									<div className={`${SURF} rounded-lg border ${BORD} overflow-hidden`}>
										<h3 className={`text-[11px] font-semibold uppercase tracking-wider ${MUT} px-3 py-2 border-b ${BORD}`}>
											Recent Errors
										</h3>
										<div className="divide-y divide-[#E8E6E1] dark:divide-[#333]">
											{analysis.recentErrors.map((event) => (
												<button
													key={event.id}
													onClick={() => handleViewEvent(event)}
													className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-stone-50 dark:hover:bg-[#2A2A2A] ${
														selectedEvent?.id === event.id ? ACC_BG : ""
													}`}
												>
													<SeverityDot severity={event.severity} />
													<span className={`font-mono text-[10px] ${MUT} w-20 shrink-0`}>
														{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
													</span>
													<span className={`font-mono text-[10px] ${MUT} w-20 shrink-0 truncate`}>
														{event.eventType}
													</span>
													<span className={`text-[10px] ${MUT} w-24 shrink-0 truncate`}>
														{event.source}
													</span>
													<span className={`flex-1 text-[11px] ${TXT} truncate`}>
														{event.message || event.name}
													</span>
													<ChevronRight size={12} className={`${MUT} shrink-0`} />
												</button>
											))}
										</div>
									</div>
								</>
							)}
						</div>
					)}

					{activeTab === "traces" && (
						<div className="p-3">
							<TraceTimeline
								className="w-full"
								since={since}
								until={until}
								limit={50}
							/>
						</div>
					)}
				</div>
			</div>

			{/* Event detail panel */}
			{selectedEvent && (
				<EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
			)}
		</div>
	);
}
