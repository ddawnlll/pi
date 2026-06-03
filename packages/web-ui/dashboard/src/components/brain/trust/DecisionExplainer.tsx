import React, { useState } from "react";

interface DecisionExplainerProps {
	onExplain: (targetId: string) => Promise<string>;
}

export function DecisionExplainer({ onExplain }: DecisionExplainerProps) {
	const [targetId, setTargetId] = useState("");
	const [explanation, setExplanation] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleExplain = async () => {
		if (!targetId.trim()) return;
		setLoading(true);
		setError(null);
		setExplanation(null);
		try {
			const result = await onExplain(targetId.trim());
			setExplanation(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to get explanation");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
			<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Decision Explainer</h3>
			<p className="text-xs text-stone-400">Enter an audit entry ID to see why a decision was made.</p>
			<div className="flex gap-2">
				<input
					type="text"
					value={targetId}
					onChange={(e) => setTargetId(e.target.value)}
					placeholder="Audit entry ID"
					className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
				/>
				<button
					onClick={handleExplain}
					disabled={loading || !targetId.trim()}
					className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50"
				>
					{loading ? "..." : "Explain"}
				</button>
			</div>
			{error && <p className="text-xs text-red-500">{error}</p>}
			{explanation && (
				<div className="px-3 py-2 rounded-lg bg-stone-50 dark:bg-stone-800 text-xs text-stone-600 dark:text-stone-300 leading-relaxed">
					{explanation}
				</div>
			)}
		</div>
	);
}
