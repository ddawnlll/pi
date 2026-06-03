import { useRef, useEffect, useState, useCallback } from "react";

interface PiCliTabProps {
	lines: string[];
	isConnected: boolean;
	isReconnecting: boolean;
	logError: string | null;
	workerId: string;
}

export function PiCliTab({ lines, isConnected, isReconnecting, logError, workerId }: PiCliTabProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [autoScroll, setAutoScroll] = useState(true);

	useEffect(() => {
		if (autoScroll && containerRef.current) {
			containerRef.current.scrollTop = containerRef.current.scrollHeight;
		}
	}, [lines.length, autoScroll]);

	const handleScroll = useCallback(() => {
		const el = containerRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
		setAutoScroll(nearBottom);
	}, []);

	return (
		<div className="flex flex-col gap-3 pt-3 h-full min-h-0">
			<div className="shrink-0 flex items-center justify-between gap-3">
				<div>
					<h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">Raw Pi CLI Mirror</h3>
					<p className="text-xs text-stone-400 dark:text-stone-500">
						Exact workspace agent log stream for {workerId}. This view is not the summarized transcript.
					</p>
				</div>
				<div className="flex items-center gap-2 text-xs shrink-0">
					{isConnected && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />live</span>}
					{isReconnecting && <span className="text-amber-600 dark:text-amber-400">reconnecting</span>}
					{logError && !isReconnecting && <span className="text-red-500 dark:text-red-400">{logError}</span>}
					<button
						onClick={() => setAutoScroll((v) => !v)}
						className={`px-2 py-1 rounded text-xs font-medium ${autoScroll ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" : "bg-stone-100 dark:bg-[#333] text-stone-600 dark:text-stone-400"}`}
					>
						{autoScroll ? "Auto-scroll" : "Paused"}
					</button>
				</div>
			</div>
			<div
				ref={containerRef}
				onScroll={handleScroll}
				className="flex-1 min-h-[360px] overflow-y-auto rounded border border-[#E8E6E1] dark:border-[#333] bg-[#050505] p-3 font-mono text-xs leading-relaxed text-[#D6D3D1] shadow-inner"
			>
				{lines.length === 0 && <div className="text-stone-500 italic">Waiting for raw Pi CLI output...</div>}
				{lines.map((line, i) => (
					<div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-words">{line}</div>
				))}
			</div>
		</div>
	);
}
