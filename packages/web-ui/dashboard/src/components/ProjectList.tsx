import { motion } from "framer-motion";
import type { Project } from "../types";

interface ProjectListProps {
	projects: Project[];
	selectedProjectId: string | null;
	onSelectProject: (projectId: string) => void;
	onOpenNewProject: () => void;
	isLoading: boolean;
}

export function ProjectList({
	projects,
	selectedProjectId,
	onSelectProject,
	onOpenNewProject,
	isLoading,
}: ProjectListProps) {
	return (
		<div className="flex flex-col h-full">
			<div className="p-3 border-b border-gray-700 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
					Projects
				</h2>
				<button
					onClick={onOpenNewProject}
					className="text-xs px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors"
				>
					+ New
				</button>
			</div>

			<div className="flex-1 overflow-auto">
				{isLoading ? (
					<div className="p-4 text-xs text-gray-500">Loading projects...</div>
				) : projects.length === 0 ? (
					<div className="p-4 text-xs text-gray-500">
						No projects yet. Create one to get started.
					</div>
				) : (
					<div className="space-y-0.5 p-2">
						{projects.map((project) => (
							<motion.button
								key={project.id}
								layout
								initial={{ opacity: 0, x: -8 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ duration: 0.15 }}
								onClick={() => onSelectProject(project.id)}
								className={`w-full text-left px-3 py-2 text-xs rounded transition-colors ${
									selectedProjectId === project.id
										? "bg-blue-700 text-white"
										: "text-gray-300 hover:bg-gray-700"
								}`}
							>
								<div className="font-medium truncate">{project.name}</div>
								<div className="text-gray-500 truncate mt-0.5">
									{project.rootPath ?? project.description ?? "No path"}
								</div>
							</motion.button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
