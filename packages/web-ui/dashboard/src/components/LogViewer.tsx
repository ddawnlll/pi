import { useEffect, useRef } from "react";
import type { LogStream } from "../types";

interface LogViewerProps {
	lines: string[];
	isConnected: boolean;
	hasData?: boolean;
	activeStream: LogStream;
	onSwitchStream: (stream: LogStream) => void;
	selectedWorkerId: string | null;
}

const LOG_STREAMS: LogStream[] = ["raw", "structured", "narrative", "audit", "decision", "stdout", "stderr", "error"];

/**
 * Monospace terminal-style log viewer with auto-scroll.
 * No Framer Motion animation (performance).
 * Auto-scrolls to bottom on new lines unless user has scrolled up.
 */
export function LogViewer({
	lines,
	isConnected,
	hasData,
	activeStream,
	onSwitchStream,
	selectedWorkerId,
}: LogViewerProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const userScrolledUpRef = useRef(false);

	// Track whether user has manually scrolled up
	const handleScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		const { scrollTop, scrollHeight, clientHeight } = el;
		// If user scrolls more than 40px from bottom, mark as manual scroll-up
		userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 40;
	};

	// Reset user-scrolled state and scroll to bottom when stream or worker changes
	useEffect(() => {
		userScrolledUpRef.current = false;
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [activeStream, selectedWorkerId]);

	// Auto-scroll when new lines arrive (if user hasn't scrolled up)
	useEffect(() => {
		if (!userScrolledUpRef.current && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [lines.length]);

	if (!selectedWorkerId) {
		return (
			<div className="flex-1 flex items-center justify-center text-stone-400 dark:text-stone-500 text-sm">
				Select a worker to view details and logs
			</div>
		);
	}

	return (
		<div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4">
			<div className="flex items-center justify-between mb-2 shrink-0">
				<h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300 uppercase tracking-wider">
					Worker Logs
				</h2>
				<div className="flex gap-1">
					{LOG_STREAMS.map((stream) => (
						<button
							key={stream}
							onClick={() => onSwitchStream(stream)}
							className={`px-2 py-1 text-xs rounded transition-colors ${
								activeStream === stream
									? "bg-blue-600 text-white"
									: "bg-stone-100 dark:bg-[#2A2A2A] text-stone-700 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-[#333]"
							}`}
						>
							{stream}
						</button>
					))}
				</div>
			</div>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-black text-green-400 p-3 rounded font-mono text-xs leading-relaxed"
			>
				{lines.length === 0 && !isConnected && hasData !== false ? (
					<div className="text-stone-400 dark:text-stone-500">Connecting...</div>
				) : lines.length === 0 && hasData === false ? (
					<div className="text-stone-400 dark:text-stone-500">No logs available</div>
				) : lines.length === 0 ? (
					<div className="text-stone-400 dark:text-stone-500">No logs yet...</div>
				) : (
					lines.map((line, i) => (
						<div key={`${line}-${i}`} className="whitespace-pre-wrap break-words">
							{line}
						</div>
					))
				)}
			</div>
		</div>
	);
}
