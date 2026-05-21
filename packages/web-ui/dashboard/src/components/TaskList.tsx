/**
 * TaskList — replaces PlanQueueTab.
 *
 * Fetches and displays all MultiPhaseTasks for the current project.
 * Each task is shown as a TaskCard. Clicking a card triggers onSelectTask.
 */

import React, { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { MultiPhaseTask } from "../types";
import { TaskCard } from "./TaskCard";

const API_BASE = "";

interface TaskListProps {
	projectId: string | null;
	onSelectTask: (taskId: string) => void;
}

export function TaskList({ projectId, onSelectTask }: TaskListProps) {
	const [tasks, setTasks] = useState<MultiPhaseTask[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const fetchTasks = async () => {
		if (!projectId) return;
		setIsLoading(true);
		try {
			const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks`);
			if (!res.ok) {
				if (res.status === 404) {
					setTasks([]);
					return;
				}
				throw new Error(`Failed to fetch tasks: ${res.status}`);
			}
			const data = await res.json();
			setTasks(data.tasks ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load tasks");
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchTasks();
	}, [projectId]);

	// Poll while there are running tasks
	useEffect(() => {
		if (!projectId) return;
		const hasActive = tasks.some((t) => t.status === "running" || t.status === "validating");
		if (!hasActive) return;

		const interval = setInterval(fetchTasks, 3000);
		return () => clearInterval(interval);
	}, [projectId, tasks]);

	if (!projectId) {
		return <p className="text-xs text-gray-500 px-3 py-2">Select a project to view tasks.</p>;
	}

	if (isLoading && tasks.length === 0) {
		return (
			<div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500">
				<Loader2 size={11} className="animate-spin" /> Loading tasks...
			</div>
		);
	}

	if (error) {
		return <p className="text-xs text-red-400 px-3 py-2">{error}</p>;
	}

	if (tasks.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 px-3 py-6 text-xs text-gray-500">
				<p>No tasks yet.</p>
				<p className="text-gray-600">Upload a plan to create a task.</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1.5 px-2 pb-2">
			{tasks.map((task) => (
				<TaskCard key={task.id} task={task} onClick={onSelectTask} />
			))}
		</div>
	);
}
