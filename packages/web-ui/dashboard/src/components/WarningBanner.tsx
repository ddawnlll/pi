import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PlanExecutionDetail, WorkspaceSummary, JournalEvent, ExecutionStats } from "../types";
import type { ContextBudgets } from "../hooks/useSettings";

interface WarningBannerProps {
	executionDetail: PlanExecutionDetail | null;
	workers: WorkspaceSummary[];
	events: JournalEvent[];
	/** Optional — wired in when telemetry step is complete */
	burnRatePerMin?: number;
	/** Optional — wired in when context budgets step is complete */
	contextBudgets?: ContextBudgets | null;
	/** Optional — execution stats for cache hit warnings */
	executionStats?: ExecutionStats | null;
}

interface Warning {
	id: string;
	message: string;
}

const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes
const RETRY_ATTEMPT_THRESHOLD = 2;

/** Threshold for total_tokens_in above which a 0% cache hit rate is concerning. */
const HIGH_TOKENS_IN_THRESHOLD = 100_000;

/** Stages that represent a terminal workspace state — never considered hung. */
const TERMINAL_STAGES = new Set(["complete", "failed"]);

export function WarningBanner({
	executionDetail,
	workers,
	events,
	burnRatePerMin,
	contextBudgets,
	executionStats,
}: WarningBannerProps) {
	const [dismissed, setDismissed] = useState<Set<string>>(new Set());

	const computeWarnings = useCallback((): Warning[] => {
		const result: Warning[] = [];

		if (!executionDetail || workers.length === 0) {
			return result;
		}

		// --- Context nearing limit ---
		for (const w of workers) {
			if (
				w.contextUsed !== undefined &&
				w.contextLimit !== undefined &&
				w.contextLimit > 0
			) {
				const pct = (w.contextUsed / w.contextLimit) * 100;
				if (pct > 80) {
					result.push({
						id: `context-${w.id}`,
						message: `⚠ Context nearing limit on worker ${w.id} (${Math.round(pct)}%)`,
					});
				}
			}
		}

		// --- Retry loop detected ---
		for (const w of workers) {
			if (w.attempts > RETRY_ATTEMPT_THRESHOLD) {
				result.push({
					id: `retry-${w.id}`,
					message: `⚠ Retry loop detected on worker ${w.id} (attempt ${w.attempts})`,
				});
			}
		}

		// --- Worker may be hung (idle > 3 min, only for non-terminal workspaces) ---
		const now = Date.now();
		for (const w of workers) {
			// Terminal workspaces are never considered hung
			if (TERMINAL_STAGES.has(w.stage)) continue;

			const lastActivityTime = w.lastActivityAt ?? w.updatedAt ?? w.startedAt;
			if (lastActivityTime == null) continue;

			const idleMs = now - lastActivityTime;
			if (idleMs > IDLE_THRESHOLD_MS) {
				const sourceInfo = w.lastActivitySource ? ` (last: ${w.lastActivitySource})` : "";
				result.push({
					id: `hang-${w.id}`,
					message: `⚠ Worker ${w.id} may be hung (no activity for ${Math.round(idleMs / 1000 / 60)}m)${sourceInfo}`,
				});
			}
		}

		// --- High token burn rate ---
		if (burnRatePerMin !== undefined && contextBudgets) {
			const threshold = contextBudgets.maxAuto ?? 4000;
			if (burnRatePerMin > threshold) {
				result.push({
					id: "burn-rate",
					message: `⚠ High token burn rate (${burnRatePerMin.toFixed(0)} tokens/min)`,
				});
			}
		}

		// --- Cache hit rate is exactly 0% with high token input ---
		// Only warn when cache_hit_rate is known to be 0 (not unknown/null)
		// and total_tokens_in exceeds a threshold indicating significant API usage
		if (
			executionStats &&
			executionStats.cache_hit_rate_known &&
			executionStats.cache_hit_rate === 0 &&
			(executionStats.total_tokens_in ?? 0) > HIGH_TOKENS_IN_THRESHOLD
		) {
			result.push({
				id: "cache-hit-zero",
				message: `⚠ Cache hit rate is 0% despite ${(executionStats.total_tokens_in ?? 0).toLocaleString()} input tokens — prompt caching may not be active`,
			});
		}

		// --- Execution stalled ---
		if (events.length > 0) {
			const newest = events[0];
			const lastEventTime =
				typeof newest.timestamp === "number"
					? newest.timestamp
					: new Date(newest.timestamp).getTime();
			const stallMs = Date.now() - lastEventTime;
			if (stallMs > STALL_THRESHOLD_MS) {
				result.push({
					id: "stalled",
					message: `⚠ Execution stalled (no events for ${Math.round(stallMs / 1000 / 60)}m)`,
				});
			}
		}

		return result;
	}, [executionDetail, workers, events, burnRatePerMin, contextBudgets, executionStats]);

	// Re-check every 30 seconds
	const [warnings, setWarnings] = useState<Warning[]>([]);
	useEffect(() => {
		setWarnings(computeWarnings());
		const interval = setInterval(() => {
			setWarnings(computeWarnings());
		}, 30_000);
		return () => clearInterval(interval);
	}, [computeWarnings]);

	const visible = warnings.filter((w) => !dismissed.has(w.id));

	if (visible.length === 0) return null;

	return (
		<div className="space-y-1 px-4 py-2 bg-amber-900/40 border-b border-amber-700">
			<AnimatePresence initial={false}>
				{visible.map((w) => (
					<motion.div
						key={w.id}
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={{ duration: 0.2 }}
						className="flex items-center justify-between text-amber-200 text-xs"
					>
						<span>{w.message}</span>
						<button
							onClick={() =>
								setDismissed((prev) => new Set(prev).add(w.id))
							}
							className="ml-3 text-amber-400 hover:text-amber-200 shrink-0"
							aria-label="Dismiss warning"
						>
							✕
						</button>
					</motion.div>
				))}
			</AnimatePresence>
		</div>
	);
}
