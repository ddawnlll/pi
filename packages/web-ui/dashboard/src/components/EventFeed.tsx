import { AnimatePresence, motion } from "framer-motion";
import type { ExecutionEvent } from "../types";

interface EventFeedProps {
	events: ExecutionEvent[];
	filter: "all" | "errors";
	onFilterChange: (filter: "all" | "errors") => void;
}

/**
 * Right-sidebar event feed with AnimatePresence on new entries.
 * Minimal list style (no TailGrids).
 */
export function EventFeed({
	events,
	filter,
	onFilterChange,
}: EventFeedProps) {
	const filteredEvents =
		filter === "all"
			? events
			: events.filter((e) => e.type === "failed" || e.type === "retry");

	return (
		<div className="w-80 border-l border-gray-700 flex flex-col overflow-hidden bg-gray-900">
			<div className="p-4 border-b border-gray-700 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
					Recent Events
				</h2>
				<select
					value={filter}
					onChange={(e) => onFilterChange(e.target.value as "all" | "errors")}
					className="text-xs bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-200"
				>
					<option value="all">all</option>
					<option value="errors">failed+retry only</option>
				</select>
			</div>
			<div className="flex-1 overflow-auto p-4">
				{filteredEvents.length === 0 ? (
					<div className="text-xs text-gray-500">No events yet</div>
				) : (
					<div className="space-y-2">
						<AnimatePresence initial={false}>
							{filteredEvents.map((event, i) => (
								<motion.div
									key={`${event.timestamp}-${i}`}
									initial={{ opacity: 0, y: -4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.1 }}
									className="text-xs border-b border-gray-700 pb-2"
								>
									<div className="text-gray-500 mb-0.5">{event.timestamp}</div>
									<div
										className={
											event.type === "failed"
												? "text-red-400"
												: event.type === "completed"
													? "text-green-400"
													: "text-gray-300"
										}
									>
										{eventIcon(event.type)} {event.message}
									</div>
								</motion.div>
							))}
						</AnimatePresence>
					</div>
				)}
			</div>
		</div>
	);
}

function eventIcon(type: string): string {
	switch (type) {
		case "completed":
			return "✓";
		case "failed":
			return "✗";
		case "retry":
			return "⟳";
		case "blocked":
			return "⊘";
		default:
			return "→";
	}
}
