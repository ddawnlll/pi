import React, { useEffect, useRef, useState } from "react";

interface ActivityEntry {
	timestamp: number;
	level: "info" | "warn" | "error" | "debug";
	message: string;
	scanCycle?: number;
}

const LEVEL_COLORS: Record<string, string> = {
	info: "text-stone-400 dark:text-stone-500",
	warn: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
	debug: "text-stone-400 dark:text-stone-500",
};
const LEVEL_BG: Record<string, string> = {
	info: "border-l-stone-300 dark:border-l-stone-600",
	warn: "border-l-amber-400 dark:border-l-amber-500",
	error: "border-l-red-400 dark:border-l-red-500",
	debug: "border-l-stone-200 dark:border-l-stone-700",
};

export function LiveDaemonActivity({ piDir }: { piDir?: string }) {
	const [entries, setEntries] = useState<ActivityEntry[]>([]);
	const [connected, setConnected] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const eventSource = new EventSource("/api/orchestrator/activity/stream");

		eventSource.onopen = () => setConnected(true);
		eventSource.onerror = () => setConnected(false);

		eventSource.addEventListener("message", (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === "activity" && data.entry) {
					setEntries((prev) => [data.entry, ...prev].slice(0, 200));
				}
			} catch {
				// ignore parse errors
			}
		});

		return () => {
			eventSource.close();
		};
	}, []);

	// Auto-scroll to top (newest entries are at the top)
	useEffect(() => {
		if (listRef.current && entries.length > 0) {
			listRef.current.scrollTop = 0;
		}
	}, [entries.length]);

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2 bg-stone-50 dark:bg-[#1E1E1E] border-b border-stone-200 dark:border-stone-700">
				<h3 className="text-xs font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">
					Daemon Activity
				</h3>
				<div className="flex items-center gap-2">
					<span
						className={`w-1.5 h-1.5 rounded-full ${
							connected ? "bg-emerald-500" : "bg-red-500"
						}`}
					/>
					<span className="text-xs text-stone-400">
						{connected ? "Live" : "Disconnected"}
					</span>
					<span className="text-xs text-stone-400">
						{entries.length > 0 ? `${entries.length} events` : ""}
					</span>
				</div>
			</div>

			<div
				ref={listRef}
				className="overflow-y-auto max-h-80"
				style={{ scrollBehavior: "smooth" }}
			>
				{entries.length === 0 ? (
					<div className="px-4 py-8 text-center text-xs text-stone-400 dark:text-stone-500">
						{connected
							? "Waiting for daemon activity..."
							: "Connecting to daemon stream..."}
					</div>
				) : (
					<div className="flex flex-col">
						{entries.map((entry, i) => {
							const time = new Date(entry.timestamp).toLocaleTimeString();
							return (
								<div
									key={`${entry.timestamp}-${i}`}
									className={`px-3 py-1.5 border-l-2 text-xs leading-relaxed font-mono ${
										LEVEL_BG[entry.level] ?? LEVEL_BG.info
									} ${
										LEVEL_COLORS[entry.level] ?? LEVEL_COLORS.info
									} border-b border-stone-100 dark:border-stone-800 last:border-b-0`}
								>
									<span className="text-stone-400 dark:text-stone-500 mr-2">
										{time}
									</span>
									{entry.scanCycle != null && (
										<span className="text-blue-500 dark:text-blue-400 mr-1">
											[#{entry.scanCycle}]
										</span>
									)}
									{entry.message}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
