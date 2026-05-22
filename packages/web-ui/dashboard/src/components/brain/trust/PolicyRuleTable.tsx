import React from "react";
import type { PolicyRule } from "../../../types-brain";

interface PolicyRuleTableProps {
	rules: PolicyRule[];
	onToggle: (id: string) => Promise<void>;
	loading: boolean;
}

export function PolicyRuleTable({ rules, onToggle, loading }: PolicyRuleTableProps) {
	if (rules.length === 0) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300 mb-3">Policy Rules</h3>
				<p className="text-[10px] text-stone-400">No policy rules configured.</p>
			</div>
		);
	}

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
			<div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
				<h3 className="text-xs font-semibold text-stone-700 dark:text-stone-300">
					Policy Rules ({rules.length})
				</h3>
			</div>
			<div className="divide-y divide-stone-100 dark:divide-stone-800">
				{rules.map((rule) => (
					<div key={rule.id} className="flex items-center gap-3 px-4 py-2.5">
						<button
							onClick={() => onToggle(rule.id)}
							disabled={loading}
							className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${
								rule.enabled ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-600"
							}`}
						>
							<span
								className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${
									rule.enabled ? "translate-x-4" : "translate-x-0.5"
								}`}
							/>
						</button>
						<div className="flex-1 min-w-0">
							<p className="text-[10px] font-medium text-stone-700 dark:text-stone-300 truncate">
								{rule.name}
							</p>
							<p className="text-[9px] text-stone-400 truncate">{rule.description}</p>
						</div>
						<span className={`shrink-0 px-1.5 py-0.5 text-[8px] font-medium rounded-full ${
							rule.effect === "allow"
								? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400"
								: rule.effect === "deny"
									? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
									: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
						}`}>
							{rule.effect.replace("_", " ")}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
