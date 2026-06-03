import { useRef, useEffect, useState } from "react";
import type { LogStream } from "../../../types";

const LOG_STREAMS: LogStream[] = ["raw", "structured", "narrative", "audit", "decision", "stdout", "stderr", "test", "error", "transcript"];

const LOG_STREAM_DESCRIPTIONS: Record<LogStream, string> = {
	raw: "Raw console output from the worker process",
	structured: "Structured JSON log entries with metadata",
	narrative: "Human-readable narrative summaries of worker activity",
	audit: "Audit trail of control and safety actions",
	decision: "Agent decision log entries",
	stdout: "Standard output stream (legacy)",
	stderr: "Standard error stream (legacy)",
	test: "Test output stream",
	error: "Error output stream (legacy)",
	transcript: "Sanitized worker transcript events",
};

interface LogsTabProps {
	planExecId: string | null;
	workerId: string;
	activeStream: LogStream;
	onSwitchStream: (stream: LogStream) => void;
}

export function LogsTab({ planExecId, workerId, activeStream, onSwitchStream }: LogsTabProps) {
	const [logLines, setLogLines] = useState<string[]>([]);
	const [logLoading, setLogLoading] = useState(false);
	const [logError, setLogError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!planExecId || !workerId) { setLogLines([]); return; }
		setLogLoading(true);
		setLogError(null);
		setLogLines([]);

		const url = `/api/logs/v2/${planExecId}/${workerId}/${activeStream}`;
		const es = new EventSource(url);

		es.onmessage = (event) => {
			setLogLoading(false);
			if (event.data !== "__NO_LOGS__") {
				setLogLines((prev) => [...prev, event.data]);
			}
		};
		es.onerror = () => {
			setLogLoading(false);
			es.close();
			setLogError("Stream disconnected");
		};
		es.onopen = () => { setLogLoading(false); setLogError(null); };

		return () => es.close();
	}, [planExecId, workerId, activeStream]);

	useEffect(() => {
		if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
	}, [logLines.length]);

	return (
		<div className="flex flex-col gap-3 pt-3">
			<div className="flex flex-wrap gap-1">
				{LOG_STREAMS.map((stream) => (
					<button key={stream} onClick={() => onSwitchStream(stream)}
						className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
							activeStream === stream ? "bg-blue-600 text-white" : "bg-stone-100 dark:bg-[#333] text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-[#444]"
						}`}>{stream}</button>
				))}
			</div>
			<p className="text-xs text-stone-400 dark:text-stone-500">{LOG_STREAM_DESCRIPTIONS[activeStream]}</p>
			<div ref={containerRef} className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-800 dark:text-stone-200" style={{ maxHeight: "50vh", minHeight: "120px" }}>
				{logLoading && <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500"><span className="w-3 h-3 border-2 border-stone-400 border-t-transparent rounded-full animate-spin" />Loading...</div>}
				{!logLoading && logError && <div className="text-red-600 dark:text-red-400 italic">{logError}</div>}
				{!logLoading && !logError && logLines.length === 0 && <div className="text-stone-400 dark:text-stone-500 italic">No {activeStream} log entries yet</div>}
				{logLines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>)}
			</div>
		</div>
	);
}
