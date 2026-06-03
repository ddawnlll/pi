import React from "react";
import type { ObservationSeverity } from "../../../types-brain";

interface SeverityBadgeProps {
	severity: ObservationSeverity;
	className?: string;
}

const COLORS: Record<ObservationSeverity, { bg: string; text: string; dot: string }> = {
	info: {
		bg: "bg-blue-50 dark:bg-blue-900/20",
		text: "text-blue-700 dark:text-blue-300",
		dot: "bg-blue-500",
	},
	warning: {
		bg: "bg-orange-50 dark:bg-orange-900/20",
		text: "text-orange-700 dark:text-orange-300",
		dot: "bg-orange-500",
	},
	critical: {
		bg: "bg-red-50 dark:bg-red-900/20",
		text: "text-red-700 dark:text-red-300",
		dot: "bg-red-500",
	},
};

export function SeverityBadge({ severity, className = "" }: SeverityBadgeProps) {
	const c = COLORS[severity];
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text} ${className}`}
		>
			<span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
			{severity}
		</span>
	);
}
