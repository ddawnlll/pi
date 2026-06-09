import { useQuery } from "@tanstack/react-query";
import type { Project } from "../types";

const API_BASE = "";

async function fetchProjects(): Promise<Project[]> {
	try {
		const response = await fetch(`${API_BASE}/api/projects`);
		if (!response.ok) return [];
		const data = await response.json();
		return data.projects ?? [];
	} catch (error) {
		console.error("Failed to fetch projects:", error);
		return [];
	}
}

async function createProject(name: string, rootPath?: string): Promise<Project | null> {
	try {
		const response = await fetch(`${API_BASE}/api/projects`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, rootPath }),
		});
		if (!response.ok) return null;
		return await response.json();
	} catch (error) {
		console.error("Failed to create project:", error);
		return null;
	}
}

async function deleteProject(projectId: string): Promise<boolean> {
	try {
		const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
			method: "DELETE",
		});
		return response.ok;
	} catch (error) {
		console.error("Failed to delete project:", error);
		return false;
	}
}

async function renameProject(projectId: string, name: string): Promise<boolean> {
	try {
		const response = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
		return response.ok;
	} catch (error) {
		console.error("Failed to rename project:", error);
		return false;
	}
}

export function useProjects() {
	const query = useQuery<Project[]>({
		queryKey: ["projects"],
		queryFn: fetchProjects,
		refetchInterval: 30_000,
	});

	return {
		projects: query.data ?? [],
		isLoading: query.isLoading,
		error: query.error,
		refetch: () => query.refetch(),
		createProject,
		deleteProject,
		renameProject,
	};
}
