import type { WorkspacePerformanceMetrics } from "../../../types";
import { formatPercent } from "../../../utils/format";

function fmt(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-stone-400 dark:text-stone-500 w-24 shrink-0">{label}:</span>
			<span className="text-stone-800 dark:text-stone-200">{value}</span>
		</div>
	);
}

interface PerformanceTabProps {
	metrics: WorkspacePerformanceMetrics | null;
	loading: boolean;
	error: string | null;
}

export function PerformanceTab({ metrics, loading, error }: PerformanceTabProps) {
	if (loading) {
		return (
			<div className="flex items-center gap-2 pt-3 text-xs text-stone-400 dark:text-stone-500">
				<span className="w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" />
				Loading performance data...
			</div>
		);
	}
	if (error) {
		return <div className="pt-3 text-xs text-amber-600 dark:text-amber-400">Performance data unavailable: {error}</div>;
	}
	if (!metrics) {
		return <div className="pt-3 text-xs text-stone-400 dark:text-stone-500">No performance data available</div>;
	}

	const { cache, tokenSplit, validationLock } = metrics;
	const cacheDisplay = cache.cacheHitRateKnown ? formatPercent(cache.cacheHitRate) : "unknown";

	return (
		<div className="flex flex-col gap-4 pt-3">
			<div>
				<h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Cache Performance</h3>
				<div className="text-xs space-y-1 text-stone-400 dark:text-stone-500">
					<Row label="Cache hit" value={cacheDisplay} />
					{cache.cacheCreationInputTokens != null && <Row label="Cache created" value={fmt(cache.cacheCreationInputTokens)} />}
					{cache.cacheReadInputTokens != null && <Row label="Cache read" value={fmt(cache.cacheReadInputTokens)} />}
				</div>
			</div>
			<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
				<h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Token Split (Prefix / Suffix)</h3>
				{tokenSplit.totalTokenCount != null ? (
					<div className="text-xs space-y-1 text-stone-400 dark:text-stone-500">
						<Row label="Prefix" value={fmt(tokenSplit.prefixTokenCount ?? 0)} />
						<Row label="Suffix" value={fmt(tokenSplit.suffixTokenCount ?? 0)} />
						<Row label="Total" value={fmt(tokenSplit.totalTokenCount)} />
						<div className="mt-2">
							<div className="flex items-center gap-1 text-xs text-stone-400 dark:text-stone-500 mb-1">
								<span className="inline-block w-2 h-2 bg-blue-500 rounded-sm" /> Prefix
								<span className="ml-2 inline-block w-2 h-2 bg-amber-500 rounded-sm" /> Suffix
							</div>
							<div className="w-full h-2 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden flex">
								{tokenSplit.totalTokenCount > 0 && (
									<>
										<div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${((tokenSplit.prefixTokenCount ?? 0) / tokenSplit.totalTokenCount) * 100}%` }} />
										<div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${((tokenSplit.suffixTokenCount ?? 0) / tokenSplit.totalTokenCount) * 100}%` }} />
									</>
								)}
							</div>
						</div>
					</div>
				) : (
					<div className="text-xs text-stone-400 dark:text-stone-500">Token split data not available</div>
				)}
			</div>
			<div className="border-t border-[#E8E6E1] dark:border-[#333] pt-3">
				<h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Validation Lock</h3>
				<div className="text-xs space-y-1 text-stone-400 dark:text-stone-500">
					<Row label="Lock waits" value={String(validationLock.lockWaits)} />
					{validationLock.totalLockWaitMs != null && <Row label="Total wait" value={`${validationLock.totalLockWaitMs}ms`} />}
					{validationLock.maxLockWaitMs != null && <Row label="Max wait" value={`${validationLock.maxLockWaitMs}ms`} />}
					{validationLock.avgLockWaitMs != null && <Row label="Avg wait" value={`${validationLock.avgLockWaitMs}ms`} />}
					{validationLock.lockWaits === 0 && <div className="text-stone-400 dark:text-stone-500 italic mt-1">No validation lock contention</div>}
				</div>
			</div>
		</div>
	);
}
