import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LogStream, WorkerInfo } from "./types";
import type {
	PlanExecutionDetail,
	PlanExecution,
	WorkspaceSummary,
} from "./types";
import { usePlanState } from "./hooks/usePlanState";
import { useJournalStream } from "./hooks/useJournalStream";
import { useLogStream } from "./hooks/useLogStream";
import { useProjects } from "./hooks/useProjects";
import { usePlanExecutions, usePlanExecutionDetail } from "./hooks/usePlanExecutions";
import { usePlanEvents } from "./hooks/usePlanEvents";
import { Header } from "./components/Header";
import { PlanSummary } from "./components/PlanSummary";
import { QueuePanel } from "./components/QueuePanel";
import { WorkerList } from "./components/WorkerList";
import { WorkerDetail } from "./components/WorkerDetail";
import { LogViewer } from "./components/LogViewer";
import { EventFeed } from "./components/EventFeed";
import { ProjectList } from "./components/ProjectList";
import { PlanHistory } from "./components/PlanHistory";
import { OpenProjectDialog } from "./components/OpenProjectDialog";

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
	// ---------------------------------------------------------------------------
	// Multi-project state
	// ---------------------------------------------------------------------------
	const {
		projects,
		isLoading: projectsLoading,
		createProject,
	} = useProjects();
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
	const [selectedPlanExecId, setSelectedPlanExecId] = useState<string | null>(null);
	const [showProjectDialog, setShowProjectDialog] = useState(false);

	// Auto-select first project if none selected
	useEffect(() => {
		if (!selectedProjectId && projects.length > 0) {
			setSelectedProjectId(projects[0].id);
		}
	}, [projects, selectedProjectId]);

	// ---------------------------------------------------------------------------
	// Plan execution data
	// ---------------------------------------------------------------------------
	const { data: executions = [], isLoading: executionsLoading } =
		usePlanExecutions(selectedProjectId);
	const { data: executionDetail } = usePlanExecutionDetail(
		selectedProjectId,
		selectedPlanExecId,
	);
	const { events: planEvents } = usePlanEvents({
		projectId: selectedProjectId,
		planExecId: selectedPlanExecId,
	});

	// Auto-select most recent running execution, or first
	useEffect(() => {
		if (!selectedPlanExecId && executions.length > 0) {
			const running = executions.find((e) => e.status === "running");
			setSelectedPlanExecId(running?.id ?? executions[0].id);
		}
	}, [executions, selectedPlanExecId]);

	// ---------------------------------------------------------------------------
	// Legacy fallback (no project selected — single-plan mode)
	// ---------------------------------------------------------------------------
	const { data: legacyPlanState, isLoading: legacyLoading } = usePlanState();
	const { events: legacyEvents } = useJournalStream();

	// Decide whether to show legacy or new UI
	const isLegacyMode = !selectedProjectId && projects.length === 0;

	const activePlanTitle = executionDetail?.title ?? legacyPlanState?.title ?? "";
	const activePlanPhase = executionDetail?.phase ?? legacyPlanState?.phase ?? "";
	const activePlanStatus =
		executionDetail?.status ??
		legacyPlanState?.status ??
		("unknown" as string);
	const activeWorkspaces: WorkspaceSummary[] =
		executionDetail?.workspaces ?? [];
	const activeEvents = isLegacyMode ? legacyEvents : planEvents;

	// Build worker list for legacy UI compat
	const workers: WorkerInfo[] = isLegacyMode
		? (legacyPlanState?.workers ?? [])
		: activeWorkspaces.map((ws) => ({
				id: ws.id,
				stage: ws.stage as WorkerInfo["stage"],
				attempt: ws.attempts,
				retries: 0,
			}));

	// Build queue stats for legacy UI compat
	const queue =
		legacyPlanState?.queue ?? {
			pending: activeWorkspaces.filter((w) => w.stage === "pending").length,
			active: activeWorkspaces.filter((w) => w.stage === "active").length,
			blocked: activeWorkspaces.filter((w) => w.stage === "blocked").length,
			complete: activeWorkspaces.filter((w) => w.stage === "complete").length,
			failed: activeWorkspaces.filter((w) => w.stage === "failed").length,
		};

	// Compute elapsed time for legacy compat
	const elapsed = legacyPlanState?.elapsed ?? 0;

	// ---------------------------------------------------------------------------
	// Worker selection & log stream
	// ---------------------------------------------------------------------------
	const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
	const [activeLogStream, setActiveLogStream] = useState<LogStream>("stdout");
	const [eventFilter, setEventFilter] = useState<"all" | "errors">("all");
	const [errorBanner, setErrorBanner] = useState<string | null>(null);
	const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [filterKey, setFilterKey] = useState(0);

	const selectedWorker = workers.find(
		(w: WorkerInfo) => w.id === selectedWorkerId,
	);
	const logWorkspaceId = selectedWorkerId;
	const logAttempt = selectedWorker?.attempt ?? null;
	const logStream = selectedWorkerId ? activeLogStream : null;

	const { lines } = useLogStream(logWorkspaceId, logAttempt, logStream);

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

	// Reset worker selection when execution changes
	useEffect(() => {
		setSelectedWorkerId(null);
	}, [selectedPlanExecId]);

	const isLoading = projectsLoading || (isLegacyMode && legacyLoading);

	if (isLoading && !isLegacyMode) {
		return (
			<div className="w-full h-screen flex items-center justify-center bg-gray-950 text-gray-100">
				<div className="text-gray-500">Loading...</div>
			</div>
		);
	}

	return (
		<div className="w-full h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
			{/* Header */}
			<Header
				status={
					isLegacyMode && legacyPlanState
						? legacyPlanState.status
						: activePlanStatus
				}
				planStatus={
					isLegacyMode && legacyPlanState
						? legacyPlanState.status
						: activePlanStatus
				}
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
				{/* Left sidebar — Project list + Plan history */}
				<div className="w-64 border-r border-gray-700 flex flex-col overflow-hidden bg-gray-900">
					{/* Project list */}
					<div className="flex-1 overflow-hidden flex flex-col border-b border-gray-700">
						<ProjectList
							projects={projects}
							selectedProjectId={selectedProjectId}
							onSelectProject={(id) => {
								setSelectedProjectId(id);
								setSelectedPlanExecId(null);
							}}
							onOpenNewProject={() => setShowProjectDialog(true)}
							isLoading={projectsLoading}
						/>
					</div>

					{/* Plan history */}
					<div className="flex-1 overflow-hidden flex flex-col">
						<PlanHistory
							executions={executions}
							selectedExecId={selectedPlanExecId}
							onSelectExecution={setSelectedPlanExecId}
							isLoading={executionsLoading}
						/>
					</div>
				</div>

				{/* Center content */}
				<div className="flex-1 flex flex-col overflow-hidden">
					{/* Plan summary & queue for legacy mode */}
					{isLegacyMode && legacyPlanState && (
						<div className="flex gap-4 p-4 border-b border-gray-700 bg-gray-900">
							<div className="w-64">
								<PlanSummary planState={legacyPlanState} />
							</div>
							<div className="w-48">
								<QueuePanel queue={legacyPlanState.queue} />
							</div>
						</div>
					)}

					{/* Execution info for new mode */}
					{!isLegacyMode && executionDetail && (
						<div className="flex gap-4 p-4 border-b border-gray-700 bg-gray-900">
							<div className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex-1">
								<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
									Execution
								</h2>
								<div className="text-xs space-y-2 text-gray-400">
									<div className="flex justify-between">
										<span>Title</span>
										<span className="text-gray-200 font-medium truncate ml-2 max-w-[200px]">
											{executionDetail.title}
										</span>
									</div>
									<div className="flex justify-between">
										<span>Phase</span>
										<span className="text-gray-200">{executionDetail.phase}</span>
									</div>
									<div className="flex justify-between">
										<span>Status</span>
										<span className={`font-medium ${getStatusColor(executionDetail.status)}`}>
											{executionDetail.status}
										</span>
									</div>
									<div className="flex justify-between">
										<span>Workspaces</span>
										<span className="text-gray-200">{executionDetail.workspaces.length}</span>
									</div>
								</div>
							</div>
							<div className="bg-gray-800 border border-gray-700 rounded-lg p-4 w-48">
								<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
									Queue
								</h2>
								<div className="space-y-2">
									{queueItems(queue).map((item) => (
										<div key={item.label} className="flex justify-between text-xs">
											<span className="text-gray-400">{item.label}</span>
											<span className={`font-medium ${item.color}`}>{item.value}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					)}

					{/* Worker list */}
					<WorkerList
						workers={workers.filter(
							(w: WorkerInfo) =>
								w.stage === "active" || w.stage === "pending",
						)}
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

				{/* Right sidebar — Event feed */}
				<EventFeed
					key={filterKey}
					events={activeEvents as any}
					filter={eventFilter}
					onFilterChange={handleFilterChange}
				/>
			</div>

			{/* Project dialog */}
			<OpenProjectDialog
				isOpen={showProjectDialog}
				onClose={() => setShowProjectDialog(false)}
				onCreate={createProject}
				projects={projects}
				onSelectExisting={(id) => {
					setSelectedProjectId(id);
					setSelectedPlanExecId(null);
				}}
			/>
		</div>
	);
}

function getStatusColor(status: string): string {
	switch (status) {
		case "running":
			return "text-green-500";
		case "paused":
			return "text-yellow-500";
		case "complete":
			return "text-blue-500";
		case "failed":
			return "text-red-500";
		case "stopped":
			return "text-orange-500";
		case "cancelled":
			return "text-gray-500";
		default:
			return "text-gray-400";
	}
}

function queueItems(queue: {
	pending: number;
	active: number;
	blocked: number;
	complete: number;
	failed: number;
}) {
	return [
		{ label: "Pending", value: queue.pending, color: "text-gray-400" },
		{ label: "Active", value: queue.active, color: "text-green-400" },
		{ label: "Blocked", value: queue.blocked, color: "text-yellow-400" },
		{ label: "Complete", value: queue.complete, color: "text-blue-400" },
		{ label: "Failed", value: queue.failed, color: "text-red-400" },
	];
}
