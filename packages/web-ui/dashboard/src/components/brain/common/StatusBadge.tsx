import React from "react";

interface StatusBadgeProps {
	status: string;
	mapping: Record<string, { color: string; label: string }>;
	className?: string;
}

const DOT_COLORS: Record<string, string> = {
	green: "bg-emerald-500",
	yellow: "bg-amber-500",
	orange: "bg-orange-500",
	red: "bg-red-500",
	blue: "bg-blue-500",
	slate: "bg-stone-400",
	purple: "bg-violet-500",
};

export function StatusBadge({ status, mapping, className = "" }: StatusBadgeProps) {
	const entry = mapping[status];
	if (!entry) {
		return (
			<span
				className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 ${className}`}
			>
				<span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
				{status}
			</span>
		);
	}

	const dotClass = DOT_COLORS[entry.color] ?? "bg-stone-400";

	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
		>
			<span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
			{entry.label}
		</span>
	);
}
