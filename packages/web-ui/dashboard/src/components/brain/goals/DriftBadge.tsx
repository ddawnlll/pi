import React from "react";

interface DriftBadgeProps {
	drifted: boolean;
	reason?: string;
}

export function DriftBadge({ drifted, reason }: DriftBadgeProps) {
	if (!drifted) return null;
	return (
		<span
			className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 cursor-help"
			title={reason ?? "Goal has drifted from its original target"}
		>
			Drifted
		</span>
	);
}
