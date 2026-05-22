import React from "react";
import type { ReflectionReport } from "../../../types-brain";

interface ReflectionDetailProps {
	reflection: ReflectionReport;
	onClose: () => void;
}

export function ReflectionDetail({ reflection, onClose }: ReflectionDetailProps) {
	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 w-full max-w-2xl shadow-xl max-h-[80vh] flex flex-col">
				<div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-700 shrink-0">
					<div>
						<h3 className="text-sm font-medium text-stone-800 dark:text-stone-200">{reflection.planTitle}</h3>
						<p className="text-[10px] text-stone-400">{reflection.phase} — {new Date(reflection.timestamp).toLocaleString()}</p>
					</div>
					<button onClick={onClose} className="text-stone-400 hover:text-stone-600">✕</button>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
					<p className="text-xs text-stone-600 dark:text-stone-300 leading-relaxed">{reflection.summary}</p>

					{reflection.worked.length > 0 && (
						<div>
							<h4 className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-1.5 flex items-center gap-1">
								<span>&#10003;</span> What worked
							</h4>
							<ul className="space-y-1">
								{reflection.worked.map((item, i) => (
									<li key={i} className="text-[10px] text-stone-600 dark:text-stone-300 pl-4">&#8226; {item}</li>
								))}
							</ul>
						</div>
					)}

					{reflection.failed.length > 0 && (
						<div>
							<h4 className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1.5 flex items-center gap-1">
								<span>&#10007;</span> What failed
							</h4>
							<ul className="space-y-1">
								{reflection.failed.map((item, i) => (
									<li key={i} className="text-[10px] text-stone-600 dark:text-stone-300 pl-4">&#8226; {item}</li>
								))}
							</ul>
						</div>
					)}

					<div className="flex items-center gap-4 text-[10px] text-stone-400 pt-2 border-t border-stone-100 dark:border-stone-800">
						<span>{reflection.memoryProposals} memory proposals</span>
						<span>{reflection.suggestions} suggestions</span>
						<span>{reflection.memoriesCreated} memories created</span>
					</div>
				</div>

				<div className="flex justify-end px-5 py-3 border-t border-stone-100 dark:border-stone-700 shrink-0">
					<button onClick={onClose} className="px-3 py-1.5 text-[10px] rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300">
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
