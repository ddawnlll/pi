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
	};
}
