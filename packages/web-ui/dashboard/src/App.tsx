import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LogStream, WorkerInfo } from "./types";
import { usePlanState } from "./hooks/usePlanState";
import { useJournalStream } from "./hooks/useJournalStream";
import { useLogStream } from "./hooks/useLogStream";
import { Header } from "./components/Header";
import { PlanSummary } from "./components/PlanSummary";
import { QueuePanel } from "./components/QueuePanel";
import { WorkerList } from "./components/WorkerList";
import { WorkerDetail } from "./components/WorkerDetail";
import { LogViewer } from "./components/LogViewer";
import { EventFeed } from "./components/EventFeed";

const API_BASE = "";

async function sendControlCommand(
	action: "pause" | "stop" | "cancel" | "resume",
): Promise<{ success: boolean; error?: string }> {
	try {
		const response = await fetch(`${API_BASE}/api/control`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action,
				requestedAt: new Date().toISOString(),
				requestedBy: "dashboard",
			}),
		});
		return await response.json();
	} catch (error) {
		return { success: false, error: String(error) };
	}
}

export function App() {
	const { data: planState, isLoading } = usePlanState();
	const { events } = useJournalStream();

	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [activeLogStream, setActiveLogStream] = useState<LogStream>("stdout");
	const [eventFilter, setEventFilter] = useState<"all" | "errors">("all");
	const [errorBanner, setErrorBanner] = useState<string | null>(null);
	const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Used to track event filter changes for resetting scroll
	const [filterKey, setFilterKey] = useState(0);

	// Determine selected worker info for log stream
	const selectedWorker = planState?.workers.find(
		(w: WorkerInfo) => w.id === selectedWorkerId,
	);
	const logWorkspaceId = selectedWorkerId;
	const logAttempt = selectedWorker?.attempt ?? null;
	const logStream = selectedWorkerId ? activeLogStream : null;

	const { lines } = useLogStream(logWorkspaceId, logAttempt, logStream);

	// Auto-dismiss error banner after 5s
	const showError = useCallback((message: string) => {
		setErrorBanner(message);
		if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
		errorTimerRef.current = setTimeout(() => {
			setErrorBanner(null);
		}, 5000);
	}, []);

	useEffect(() => {
		return () => {
			if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
		};
	}, []);

	const handleControl = useCallback(
		async (action: "pause" | "stop" | "cancel" | "resume") => {
			const result = await sendControlCommand(action);
			if (!result.success) {
				showError(result.error || `Failed to ${action}`);
			}
		},
		[showError],
	);

	const handleSelectWorker = useCallback((workerId: string) => {
		setSelectedWorkerId(workerId);
	}, []);

	const handleSwitchStream = useCallback((stream: LogStream) => {
		setActiveLogStream(stream);
	}, []);

	const handleFilterChange = useCallback((filter: "all" | "errors") => {
		setEventFilter(filter);
		setFilterKey((k) => k + 1);
	}, []);

	if (isLoading) {
		return (
			<div className="w-full h-screen flex items-center justify-center bg-gray-950 text-gray-100">
				<div className="text-gray-500">Loading plan state...</div>
			</div>
		);
	}

	if (!planState) {
		return (
			<div className="w-full h-screen flex items-center justify-center bg-gray-950 text-gray-100">
				<div className="text-gray-500">No plan state available</div>
			</div>
		);
	}

	return (
		<div className="w-full h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
			{/* Header */}
			<Header
				status={planState.status}
				planStatus={planState.status}
				onControl={handleControl}
			/>

			{/* Error banner */}
			<AnimatePresence>
				{errorBanner && (
					<motion.div
						initial={{ opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.2 }}
						className="bg-red-900/80 border-b border-red-700 px-4 py-2 text-sm text-red-200"
					>
						{errorBanner}
					</motion.div>
				)}
			</AnimatePresence>

			{/* Main content */}
			<div className="flex-1 flex overflow-hidden">
				{/* Left sidebar — TailGrids sidebar pattern */}
				<div className="w-64 border-r border-gray-700 flex flex-col overflow-hidden bg-gray-900">
					<div className="p-3">
						<PlanSummary planState={planState} />
					</div>
					<div className="px-3 pb-3">
						<QueuePanel queue={planState.queue} />
					</div>
				</div>

				{/* Center content */}
				<div className="flex-1 flex flex-col overflow-hidden">
					<WorkerList
						workers={planState.workers.filter((w: WorkerInfo) => w.stage === "active")}
						selectedWorkerId={selectedWorkerId}
						onSelectWorker={handleSelectWorker}
					/>

					{selectedWorker ? (
						<>
							<WorkerDetail worker={selectedWorker} />
							<LogViewer
								lines={lines}
								activeStream={activeLogStream}
								onSwitchStream={handleSwitchStream}
								selectedWorkerId={selectedWorkerId}
							/>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
							Select a worker to view details and logs
						</div>
					)}
				</div>

				{/* Right sidebar */}
				<EventFeed
					key={filterKey}
					events={events}
					filter={eventFilter}
					onFilterChange={handleFilterChange}
				/>
			</div>
		</div>
	);
}
