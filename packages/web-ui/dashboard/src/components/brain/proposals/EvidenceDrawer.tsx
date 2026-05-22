import React from "react";

interface EvidenceDrawerProps {
	memories: number;
	observations: number;
}

export function EvidenceDrawer({ memories, observations }: EvidenceDrawerProps) {
	return (
		<div className="p-3 bg-stone-50 dark:bg-stone-800/30 border-t border-stone-100 dark:border-stone-800">
			<h4 className="text-[10px] font-medium text-stone-500 mb-2">Evidence</h4>
			<div className="space-y-2">
				<div className="flex items-center gap-2 text-[10px]">
					<span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
					<span className="text-stone-500">Memories: {memories}</span>
				</div>
				<div className="flex items-center gap-2 text-[10px]">
					<span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
					<span className="text-stone-500">Observations: {observations}</span>
				</div>
			</div>
		</div>
	);
}
