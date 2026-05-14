import type { WorkspacePerformanceMetrics } from "../types";
import { formatPercentOrUnknown, formatTokens, formatElapsed } from "../utils/format";

interface PerformancePanelProps {
	/** Performance metrics for a single workspace. null means loading or unavailable. */
	metrics: WorkspacePerformanceMetrics | null;
	/** Whether metrics are currently loading. */
	loading?: boolean;
}

/**
 * Performance telemetry panel for a single workspace.
 *
 * Displays:
 * - Cache hit rate (distinguishing "unknown" from 0%)
 * - Prefix/suffix token split
 * - Validation lock wait time
 *
 * Follows existing dashboard styling conventions: Tailwind utility classes,
 * dark mode support, consistent spacing with other StatCard-based panels.
 */
export function PerformancePanel({ metrics, loading }: PerformancePanelProps) {
	if (loading || !metrics) {
		return (
			<div className="flex flex-col gap-3 p-4 rounded-xl border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E]">
				<h3 className="text-xs font-semibold tracking-widest uppercase text-stone-400 dark:text-stone-500">
					Performance
				</h3>
				<p className="text-sm text-stone-400 dark:text-stone-500">
					{loading ? "Loading metrics..." : "No performance data available"}
				</p>
			</div>
		);
	}

	const { cache, tokenSplit, validationLock } = metrics;

	const cacheDisplay = formatPercentOrUnknown(cache.cacheHitRateKnown ? cache.cacheHitRate : null);
	const isCacheUnknown = !cache.cacheHitRateKnown;

	const prefixTokens = tokenSplit.prefixTokenCount;
	const suffixTokens = tokenSplit.suffixTokenCount;
	const totalTokens = tokenSplit.totalTokenCount;

	return (
		<div className="flex flex-col gap-3 p-4 rounded-xl border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E]">
			<h3 className="text-xs font-semibold tracking-widest uppercase text-stone-400 dark:text-stone-500">
				Performance
			</h3>

			{/* Cache hit rate */}
			<div className="flex items-baseline justify-between">
				<span className="text-[10px] font-semibold tracking-widest uppercase text-stone-400 dark:text-stone-500">
					Cache Hit
				</span>
				<span
					className={`text-sm font-semibold ${
						isCacheUnknown
							? "text-stone-400 dark:text-stone-500"
							: (cache.cacheHitRate ?? 0) >= 0.5
								? "text-green-600 dark:text-green-400"
								: (cache.cacheHitRate ?? 0) > 0
									? "text-yellow-600 dark:text-yellow-400"
									: "text-red-600 dark:text-red-400"
					}`}
				>
					{cacheDisplay}
				</span>
			</div>
			{cache.cacheCreationInputTokens != null && (
				<div className="flex items-baseline justify-between text-[9px] text-stone-400 dark:text-stone-500">
					<span>Created</span>
					<span>{formatTokens(cache.cacheCreationInputTokens)}</span>
				</div>
			)}
			{cache.cacheReadInputTokens != null && (
				<div className="flex items-baseline justify-between text-[9px] text-stone-400 dark:text-stone-500">
					<span>Read</span>
					<span>{formatTokens(cache.cacheReadInputTokens)}</span>
				</div>
			)}

			{/* Token split */}
			<div className="mt-1 border-t border-[#E8E6E1] dark:border-[#333] pt-2">
				<div className="flex items-baseline justify-between">
					<span className="text-[10px] font-semibold tracking-widest uppercase text-stone-400 dark:text-stone-500">
						Token Split
					</span>
					<span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
						{totalTokens != null ? formatTokens(totalTokens) : "—"}
					</span>
				</div>
				<div className="mt-1 h-1.5 w-full rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
					{prefixTokens != null && suffixTokens != null && totalTokens != null && totalTokens > 0 ? (
						<div
							className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
							style={{ width: `${(prefixTokens / totalTokens) * 100}%` }}
						/>
					) : null}
				</div>
				<div className="flex justify-between text-[9px] text-stone-400 dark:text-stone-500 mt-0.5">
					<span>Prefix: {prefixTokens != null ? formatTokens(prefixTokens) : "—"}</span>
					<span>Suffix: {suffixTokens != null ? formatTokens(suffixTokens) : "—"}</span>
				</div>
			</div>

			{/* Validation lock */}
			<div className="mt-1 border-t border-[#E8E6E1] dark:border-[#333] pt-2">
				<div className="flex items-baseline justify-between">
					<span className="text-[10px] font-semibold tracking-widest uppercase text-stone-400 dark:text-stone-500">
						Validation Lock
					</span>
					<span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
						{validationLock.lockWaits > 0
							? `${validationLock.lockWaits} wait${validationLock.lockWaits !== 1 ? "s" : ""}`
							: "No waits"}
					</span>
				</div>
				{validationLock.totalLockWaitMs != null && (
					<div className="flex items-baseline justify-between text-[9px] text-stone-400 dark:text-stone-500">
						<span>Total wait</span>
						<span>{formatElapsed(validationLock.totalLockWaitMs)}</span>
					</div>
				)}
				{validationLock.maxLockWaitMs != null && (
					<div className="flex items-baseline justify-between text-[9px] text-stone-400 dark:text-stone-500">
						<span>Max wait</span>
						<span>{formatElapsed(validationLock.maxLockWaitMs)}</span>
					</div>
				)}
				{validationLock.avgLockWaitMs != null && (
					<div className="flex items-baseline justify-between text-[9px] text-stone-400 dark:text-stone-500">
						<span>Avg wait</span>
						<span>{formatElapsed(validationLock.avgLockWaitMs)}</span>
					</div>
				)}
			</div>
		</div>
	);
}
