import React from "react";

interface ErrorStateProps {
	message: string;
	details?: string;
	onRetry?: () => void;
}

export function ErrorState({ message, details, onRetry }: ErrorStateProps) {
	return (
		<div className="flex flex-col items-center justify-center py-12 px-6 text-center">
			<div className="mb-3 text-red-400 dark:text-red-500">
				<svg
					width="32"
					height="32"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
			</div>
			<h3 className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
				{message}
			</h3>
			{details && (
				<p className="text-xs text-stone-400 dark:text-stone-500 max-w-sm mb-4 font-mono">
					{details}
				</p>
			)}
			{onRetry && (
				<button
					onClick={onRetry}
					className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
				>
					Retry
				</button>
			)}
		</div>
	);
}
