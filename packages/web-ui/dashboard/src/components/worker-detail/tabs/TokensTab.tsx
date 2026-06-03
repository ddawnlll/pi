import type { WorkspaceSummary } from "../../../types";

function fmt(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function TokensTab({ workspace }: { workspace?: WorkspaceSummary }) {
	const ctxUsed = workspace?.contextUsed;
	const ctxLimit = workspace?.contextLimit;
	if (ctxUsed === undefined || ctxLimit === undefined || ctxLimit === 0) {
		return <div className="pt-3 text-xs text-stone-400 dark:text-stone-500">No token data available</div>;
	}
	const pct = Math.round((ctxUsed / ctxLimit) * 100);
	const bar = pct > 80 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500";
	return (
		<div className="pt-3">
			<h3 className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-2">Context Window</h3>
			<div className="text-xs text-stone-400 dark:text-stone-500 mb-1">Context: {fmt(ctxUsed)} / {fmt(ctxLimit)} ({pct}%)</div>
			<div className="w-full h-2 bg-stone-100 dark:bg-[#333] rounded-full overflow-hidden">
				<div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
			</div>
		</div>
	);
}
