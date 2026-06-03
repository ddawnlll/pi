/**
 * TraceTimeline — Span tree waterfall visualizer for the Local Observability Cockpit (25.H).
 *
 * Displays a hierarchical waterfall view of spans with parent-child nesting,
 * duration bars, and severity indicators. Supports loading, empty, error,
 * and data-present states.
 *
 * Acceptance Criteria:
 * 1. Accepts spans array, loading, error, onSelectSpan, and className props.
 * 2. Renders spans in a waterfall layout with parent-child hierarchy.
 * 3. Each span shows name, duration, status, and severity.
 * 4. Supports loading, empty, error, and data states.
 * 5. Spans are clickable via onSelectSpan callback.
 */

import { useMemo, useState } from "react";
import { BG, SURF, SURF_ALT, BORD, BORD_B, TXT, MUT, ACC_BG, ACC_TXT, PRI, SHADOW_CARD, SHADOW_PANEL, SHADOW_ACTIVE, SHADOW_MODAL, FOCUS_RING } from "../../tokens";
import {
	Activity,
	AlertCircle,
	ChevronDown,
	ChevronRight,
	Loader2,
	Search,
} from "lucide-react";
import { useTelemetryEvents } from "../../hooks/useTelemetry";
import type { ObservabilityEvent } from "../../types-observability";

// ─── Style constants ──────────────────────────────────────────────────────────

const ERR_TXT = "text-red-600 dark:text-red-400";

// ─── Severity colors ──────────────────────────────────────────────────────────

function severityColor(severity: string): string {
	switch (severity) {
		case "critical": return "bg-red-500";
		case "error": return "bg-red-400";
		case "warning": return "bg-amber-400";
		case "info": return "bg-blue-400";
		case "debug": return "bg-stone-400";
		default: return "bg-stone-400";
	}
}

// ─── Span node component (internal recursive) ─────────────────────────────────

interface SpanNodeProps {
	span: ObservabilityEvent;
	children: ObservabilityEvent[];
	allSpans: Map<string, ObservabilityEvent[]>;
	depth: number;
	onSelect?: (span: ObservabilityEvent) => void;
}

function SpanNodeRow({ span, children: directChildren, allSpans, depth, onSelect }: SpanNodeProps) {
	const [expanded, setExpanded] = useState(true);
	const hasChildren = directChildren.length > 0;
	const indent = depth * 16;

	const statusColor = span.status === "error" || span.severity === "error" || span.severity === "critical"
		? ERR_TXT
		: TXT;

	return (
		<div>
			{/* Span row */}
			<div
				className="flex items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-stone-50 dark:hover:bg-[#2A2A2A] cursor-pointer"
				style={{ paddingLeft: `${8 + indent}px` }}
				onClick={() => {
					if (hasChildren) setExpanded((e) => !e);
					onSelect?.(span);
				}}
				title={span.message ?? span.name}
			>
				{hasChildren ? (
					<span className={`shrink-0 ${MUT}`}>
						{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
					</span>
				) : (
					<span className="shrink-0 w-3" />
				)}
				<span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${severityColor(span.severity)}`} />
				<span className={`flex-1 truncate font-medium ${statusColor}`}>{span.name}</span>
				<span className={`text-xs font-mono ${MUT} shrink-0 w-14 text-right`}>
					{span.durationMs != null
						? span.durationMs >= 1000
							? `${(span.durationMs / 1000).toFixed(1)}s`
							: `${span.durationMs}ms`
						: "\u2014"}
				</span>
				<span className={`text-xs font-mono ${MUT} shrink-0 w-12 text-right capitalize`}>
					{span.status}
				</span>
			</div>

			{/* Children */}
			{expanded && hasChildren && directChildren.map((child) => {
				const grandchildren = allSpans.get(child.spanId) ?? [];
				return (
					<SpanNodeRow
						key={child.spanId}
						span={child}
						children={grandchildren}
						allSpans={allSpans}
						depth={depth + 1}
						onSelect={onSelect}
					/>
				);
			})}
		</div>
	);
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TraceTimelineProps {
	className?: string;
	/** Direct spans data (controlled mode). When omitted and `since` is provided, self-fetches. */
	spans?: ObservabilityEvent[];
	loading?: boolean;
	error?: string | null;
	onSelectSpan?: (span: ObservabilityEvent) => void;
	/** Self-fetching: ISO start timestamp. */
	since?: string;
	/** Self-fetching: ISO end timestamp. */
	until?: string;
	/** Self-fetching: max number of spans to fetch. */
	limit?: number;
}

/**
 * TraceTimeline — Renders a waterfall view of spans with parent-child hierarchy.
 *
 * Supports two modes:
 * 1. Controlled: pass `spans`, `loading`, `error` directly
 * 2. Self-fetching: pass `since`, `until`, `limit` to auto-fetch from the telemetry API
 *
 * When `since` is provided and `spans` is not, the component fetches data autonomously.
 */
export function TraceTimeline({ className = "", spans: directSpans, loading: directLoading = false, error: directError = null, onSelectSpan, since, until, limit }: TraceTimelineProps) {
	// ── Self-fetching mode ───────────────────────────────────────
	const isSelfFetching = since !== undefined && directSpans === undefined;

	const { events: fetchedSpans, loading: fetchLoading, error: fetchError } = useTelemetryEvents(
		isSelfFetching
			? { since, until, limit, order: "asc" }
			: {},
		0,
	);

	const spans = directSpans ?? fetchedSpans;
	const loading = directLoading || (isSelfFetching ? fetchLoading : false);
	const error = directError ?? (isSelfFetching ? fetchError : null);
	// ── Build span tree ───────────────────────────────────────────

	const { tree, childrenMap } = useMemo(() => {
		const children = new Map<string, ObservabilityEvent[]>();
		const roots: ObservabilityEvent[] = [];

		for (const span of spans) {
			const parentId = span.parentSpanId;
			if (!parentId || !spans.find((s) => s.spanId === parentId)) {
				roots.push(span);
			} else {
				const siblings = children.get(parentId) ?? [];
				siblings.push(span);
				children.set(parentId, siblings);
			}
		}

		return { tree: roots, childrenMap: children };
	}, [spans]);

	return (
		<div className={`flex flex-col min-h-0 ${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center justify-between px-3 h-9 border-b ${BORD}`}>
				<div className="flex items-center gap-1.5">
					<Activity size={13} className={ACC_TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>Trace Timeline</span>
				</div>
				{!loading && !error && spans.length > 0 && (
					<span className={`text-xs ${MUT}`}>
						{spans.length} span{spans.length !== 1 ? "s" : ""}
					</span>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 min-h-0 overflow-y-auto">
				{/* Loading state */}
				{loading && (
					<div className="flex flex-col items-center justify-center h-24 gap-2 text-xs text-stone-400">
						<Loader2 size={20} className="animate-spin" />
						<p>Loading trace...</p>
					</div>
				)}

				{/* Error state */}
				{error && !loading && (
					<div className={`flex flex-col items-center justify-center h-24 gap-1.5 text-xs ${ERR_TXT}`}>
						<AlertCircle size={16} />
						<span>{error}</span>
					</div>
				)}

				{/* Empty state */}
				{!loading && !error && spans.length === 0 && (
					<div className={`flex flex-col items-center justify-center h-32 gap-2 text-xs ${MUT}`}>
						<Search size={24} strokeWidth={1} className="text-stone-300 dark:text-stone-600" />
						<p>No trace spans available</p>
					</div>
				)}

				{/* Span tree */}
				{!loading && !error && spans.length > 0 && (
					<div className="divide-y divide-stone-100 dark:divide-stone-800">
						{tree.map((root) => {
							const directChildren = childrenMap.get(root.spanId) ?? [];
							return (
								<SpanNodeRow
									key={root.spanId}
									span={root}
									children={directChildren}
									allSpans={childrenMap}
									depth={0}
									onSelect={onSelectSpan}
								/>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
