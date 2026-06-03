import React from "react";
import { SeverityBadge } from "../common";
import { LoadingSkeleton } from "../common";
import { EmptyState } from "../common";
import { ErrorState } from "../common";
import type { TimelineEvent } from "../../../types-brain";

interface TimelineListProps {
	events: TimelineEvent[];
	loading: boolean;
	error: string | null;
	maxItems?: number;
}

export function TimelineList({ events, loading, error, maxItems = 50 }: TimelineListProps) {
	if (loading) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-3">
					Timeline
				</h3>
				<LoadingSkeleton variant="row" count={5} />
			</div>
		);
	}

	if (error) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-3">
					Timeline
				</h3>
				<ErrorState message={error} />
			</div>
		);
	}

	const displayEvents = events.slice(0, maxItems);

	if (displayEvents.length === 0) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-3">
					Timeline
				</h3>
				<EmptyState
					title="No events yet"
					description="Timeline events will appear here as the brain processes observations."
				/>
			</div>
		);
	}

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg">
			<div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">
					Timeline
				</h3>
			</div>
			<div className="divide-y divide-stone-100 dark:divide-stone-800 max-h-80 overflow-y-auto">
				{displayEvents.map((ev) => (
					<div key={ev.id} className="flex items-start gap-2 px-4 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/50">
						<div className="shrink-0 mt-0.5">
							<SeverityBadge severity={ev.severity} />
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-xs text-stone-600 dark:text-stone-300 truncate">
								{ev.title}
							</p>
							{ev.description && (
								<p className="text-xs text-stone-400 dark:text-stone-500 truncate mt-0.5">
									{ev.description}
								</p>
							)}
						</div>
						<span className="shrink-0 text-xs text-stone-400 font-mono">
							{formatTime(ev.timestamp)}
						</span>
					</div>
				))}
			</div>
			{events.length > maxItems && (
				<div className="px-4 py-2 border-t border-stone-100 dark:border-stone-800 text-center">
					<span className="text-xs text-stone-400">
						Showing {maxItems} of {events.length} events
					</span>
				</div>
			)}
		</div>
	);
}

function formatTime(ts: string): string {
	try {
		const d = new Date(ts);
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	} catch {
		return "";
	}
}
