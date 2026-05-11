import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Project } from "../types";

interface OpenProjectDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onCreate: (name: string, rootPath?: string) => Promise<Project | null>;
	projects: Project[];
	onSelectExisting: (projectId: string) => void;
}

export function OpenProjectDialog({
	isOpen,
	onClose,
	onCreate,
	projects,
	onSelectExisting,
}: OpenProjectDialogProps) {
	const [name, setName] = useState("");
	const [rootPath, setRootPath] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleCreate = async () => {
		if (!name.trim()) return;

		setIsCreating(true);
		setError(null);

		try {
			const project = await onCreate(name.trim(), rootPath.trim() || undefined);
			if (project) {
				onSelectExisting(project.id);
				handleClose();
			} else {
				setError("Failed to create project");
			}
		} catch (err) {
			setError(String(err));
		} finally {
			setIsCreating(false);
		}
	};

	const handleClose = () => {
		setName("");
		setRootPath("");
		setError(null);
		onClose();
	};

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={handleClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-6 min-w-96 max-w-lg"
						onClick={(e) => e.stopPropagation()}
					>
						<h2 className="text-lg font-semibold text-gray-100 mb-4">
							Open / Create Project
						</h2>

						{/* Existing projects */}
						{projects.length > 0 && (
							<div className="mb-4">
								<label className="text-xs text-gray-400 block mb-2">
									Existing Projects
								</label>
								<div className="space-y-1 max-h-32 overflow-auto">
									{projects.map((p) => (
										<button
											key={p.id}
											onClick={() => {
												onSelectExisting(p.id);
												handleClose();
											}}
											className="w-full text-left px-3 py-2 text-xs rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition-colors"
										>
											<span className="font-medium">{p.name}</span>
											{p.rootPath && (
												<span className="text-gray-500 ml-2">{p.rootPath}</span>
											)}
										</button>
									))}
								</div>
							</div>
						)}

						<div className="border-t border-gray-700 pt-4">
							<label className="text-xs text-gray-400 block mb-2">
								Or Create New
							</label>

							<div className="space-y-3">
								<div>
									<input
										type="text"
										placeholder="Project name (required)"
										value={name}
										onChange={(e) => setName(e.target.value)}
										className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
										onKeyDown={(e) => e.key === "Enter" && handleCreate()}
									/>
								</div>
								<div>
									<input
										type="text"
										placeholder="Root path (optional)"
										value={rootPath}
										onChange={(e) => setRootPath(e.target.value)}
										className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
										onKeyDown={(e) => e.key === "Enter" && handleCreate()}
									/>
								</div>

								{error && (
									<div className="text-xs text-red-400">{error}</div>
								)}

								<div className="flex gap-2 justify-end">
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									<button
										onClick={handleCreate}
										disabled={!name.trim() || isCreating}
										className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
									>
										{isCreating ? "Creating..." : "Create"}
									</button>
								</div>
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
