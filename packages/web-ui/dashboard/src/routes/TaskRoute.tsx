import { useState } from "react";
import { useSelectionStore } from "../stores/selectionStore";
import { useNavigation } from "../navigation/NavigationState";
import { TaskDetailView } from "../components/TaskDetailView";
import { Loader2 } from "lucide-react";
import type { MultiPhaseTask } from "../types";

const API_BASE = "";

export function TaskRoute() {
	const { selectedProjectId, selectedTaskId } = useSelectionStore();
	const { navigateToRun, navigateToEmpty } = useNavigation();
	const [task, setTask] = useState<MultiPhaseTask | null>(null);

	// Fetch task on mount if not already loaded
	// In a real refactor this would use a proper hook, but we're minimizing changes
	if (!task && selectedTaskId && selectedProjectId) {
		fetch(`${API_BASE}/api/projects/${encodeURIComponent(selectedProjectId)}/tasks/${encodeURIComponent(selectedTaskId)}`)
			.then((r) => r.json())
			.then((d) => { if (d.task) setTask(d.task); })
			.catch(() => {});
	}

	if (!task) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3 text-stone-400 dark:text-stone-500">
				<Loader2 size={20} className="animate-spin" />
				<p className="text-sm">Loading task...</p>
			</div>
		);
	}

	return (
		<div className="flex-1 min-h-0 overflow-y-auto p-4">
			<TaskDetailView
				task={task}
				projectId={selectedProjectId ?? ""}
				onBack={() => {
					setTask(null);
					// Navigation back is handled by the caller / nav state
				}}
				onTaskUpdated={(updated) => setTask(updated)}
				onPhasePlanClick={(planExecId) => {
					navigateToRun(planExecId);
				}}
			/>
		</div>
	);
}
