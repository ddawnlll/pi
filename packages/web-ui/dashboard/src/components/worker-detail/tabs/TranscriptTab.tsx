import { useRef, useEffect, useState } from "react";
import { useWorkerTranscript } from "../../../hooks/useWorkerTranscript";
import { ThinkingAnimation, LiveWritingText } from "../../ThinkingAnimation";
import type { WorkerTranscriptEvent } from "../../../types";

interface TranscriptTabProps {
	planExecId: string | null;
	workerId: string;
}

export function TranscriptTab({ planExecId, workerId }: TranscriptTabProps) {
	const { events, isConnected, isReconnecting, error } = useWorkerTranscript({ planExecId, workspaceId: workerId });
	const containerRef = useRef<HTMLDivElement>(null);
	const [animateEventId, setAnimateEventId] = useState<string | null>(null);

	useEffect(() => {
		if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
	}, [events.length]);

	useEffect(() => {
		if (events.length > 0) {
			const last = events[events.length - 1];
			setAnimateEventId(`${last.timestamp}-${last.type}`);
		}
	}, [events.length]);

	return (
		<div className="flex flex-col gap-3 pt-3">
			<div className="flex items-center justify-between shrink-0">
				<h3 className="text-sm font-semibold text-stone-600 dark:text-stone-400">Live Transcript</h3>
				<div className="flex items-center gap-2 shrink-0">
					{isConnected && <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />Connected ({events.length} events)</span>}
					{isReconnecting && <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />Reconnecting...</span>}
					{!isConnected && !isReconnecting && !error && <span className="text-xs text-stone-400 dark:text-stone-500">Connecting...</span>}
					{error && !isReconnecting && <span className="text-xs text-red-500 dark:text-red-400">{error}</span>}
				</div>
			</div>
			<p className="text-xs text-stone-400 dark:text-stone-500">Sanitized worker transcript — worker_status, decision_summary, validation, and blocker events.</p>
			<div ref={containerRef} className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs" style={{ maxHeight: "50vh", minHeight: "120px" }}>
				{events.length === 0 && <div className="text-stone-400 dark:text-stone-500 italic">No transcript events yet...</div>}
				{events.map((event, i) => {
					const isLatest = i === events.length - 1;
					const eventId = `${event.timestamp}-${event.type}`;
					return <TranscriptEventLine key={eventId} event={event} animate={isLatest && animateEventId === eventId} />;
				})}
			</div>
		</div>
	);
}

function TranscriptEventLine({ event, animate }: { event: WorkerTranscriptEvent; animate: boolean }) {
	const ts = new Date(event.timestamp).toLocaleTimeString();
	const badgeColors: Record<string, string> = {
		worker_status: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
		worker_decision_summary: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
		validation: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
		blocker: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
		tool_call: "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200",
		workspace_start: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
		workspace_complete: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
		workspace_failed: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
		workspace_blocked: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
		retry_attempt: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
	};
	const badge = badgeColors[event.type] ?? "bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200";
	const passed = event.data?.passed as boolean | undefined;
	const validationIcon = passed === true ? "\u2713" : passed === false ? "\u2717" : null;

	return (
		<div className={`flex gap-2 py-1 border-b border-stone-100 dark:border-[#222] last:border-0 ${animate ? "bg-blue-50/50 dark:bg-blue-950/20 -mx-2 px-2 rounded" : ""}`}>
			<span className="text-stone-400 dark:text-stone-500 shrink-0 w-16">{ts}</span>
			<span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold shrink-0 ${badge}`}>{event.type}</span>
			<span className="text-stone-800 dark:text-stone-200 break-words flex-1">
				{validationIcon && <span className={passed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{validationIcon} </span>}
				{animate ? <LiveWritingText text={event.summary} tickMs={12} charsPerTick={2} /> : event.summary}
			</span>
		</div>
	);
}
