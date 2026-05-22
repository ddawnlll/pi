import React from "react";

interface EmptyStateProps {
	icon?: React.ReactNode;
	title: string;
	description: string;
	action?: {
		label: string;
		onClick: () => void;
	};
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-12 px-6 text-center">
			{icon && (
				<div className="mb-4 text-stone-300 dark:text-stone-600">
					{icon}
				</div>
			)}
			<h3 className="text-sm font-medium text-stone-600 dark:text-stone-400 mb-1">
				{title}
			</h3>
			<p className="text-xs text-stone-400 dark:text-stone-500 max-w-xs mb-4">
				{description}
			</p>
			{action && (
				<button
					onClick={action.onClick}
					className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
				>
					{action.label}
				</button>
			)}
		</div>
	);
}
