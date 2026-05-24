/**
 * TaskCreateDialog — Primary onboarding dialog for creating a new task (P22.E).
 *
 * Task creation replaces plan upload as the main entry point.
 * Users provide a name, optional description, and execution mode.
 * Plan/phase upload is done separately after task creation.
 */

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus, X } from "lucide-react";

const API_BASE = "";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskCreateDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onTaskCreated: (taskId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCreateDialog({ isOpen, onClose, projectId, onTaskCreated }: TaskCreateDialogProps) {
	// ── Form state ──
	const [taskName, setTaskName] = useState("");
	const [description, setDescription] = useState("");
	const [executionMode, setExecutionMode] = useState<"sequential" | "parallel">("sequential");

	// ── UI state ──
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// ── Handlers ──

	const handleCreate = useCallback(async () => {
		if (!taskName.trim()) {
			setError("Task name is required");
			return;
		}

		setCreating(true);
		setError(null);

		try {
			const body: Record<string, unknown> = {
				title: taskName.trim(),
				executionMode,
				origin: {
					type: "user_upload",
					sourcePlanFiles: [],
				},
				phases: [
					{
						id: "phase-1",
						title: description.trim() || taskName.trim(),
						planFile: "pending",
						dependsOn: [],
					},
				],
				planFiles: [],
			};

			const response = await fetch(`${API_BASE}/api/projects/${projectId}/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			const result = await response.json();

			if (!response.ok || !result.task?.id) {
				setError(result.error || "Failed to create task");
				return;
			}

			onTaskCreated(result.task.id);
			onClose();
		} catch (err) {
			setError(String(err));
		} finally {
			setCreating(false);
		}
	}, [taskName, description, executionMode, projectId, onTaskCreated, onClose]);

	// ── Reset on close ──

	const handleClose = useCallback(() => {
		setTaskName("");
		setDescription("");
		setExecutionMode("sequential");
		setCreating(false);
		setError(null);
		onClose();
	}, [onClose]);

	const isValid = taskName.trim().length > 0;

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
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-6 min-w-[480px] max-w-lg max-h-[85vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						{/* ── Header ── */}
						<div className="flex items-center justify-between mb-5">
							<h2 className="text-lg font-semibold text-gray-100">Create Task</h2>
							<button
								onClick={handleClose}
								className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
							>
								<X size={14} />
							</button>
						</div>

						{/* ── Form ── */}
						<div className="flex-1 min-h-0 overflow-y-auto space-y-4">
							{/* Task name */}
							<div>
								<label className="block text-xs text-gray-400 mb-1.5 font-medium">
									Task name <span className="text-red-400">*</span>
								</label>
								<input
									type="text"
									value={taskName}
									onChange={(e) => setTaskName(e.target.value)}
									placeholder="e.g., Implement user authentication"
									className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
									autoFocus
									onKeyDown={(e) => {
										if (e.key === "Enter" && isValid && !creating) {
											handleCreate();
										}
									}}
								/>
							</div>

							{/* Description */}
							<div>
								<label className="block text-xs text-gray-400 mb-1.5 font-medium">
									Description <span className="text-gray-500">(optional)</span>
								</label>
								<textarea
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									placeholder="What does this task involve?"
									className="w-full min-h-[60px] px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
									spellCheck={false}
								/>
							</div>

							{/* Execution mode */}
							<div>
								<label className="block text-xs text-gray-400 mb-1.5 font-medium">
									Execution mode
								</label>
								<div className="flex gap-2">
									<button
										onClick={() => setExecutionMode("sequential")}
										className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
											executionMode === "sequential"
												? "bg-blue-900/50 border-blue-600 text-blue-300"
												: "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
										}`}
									>
										Sequential
									</button>
									<button
										onClick={() => setExecutionMode("parallel")}
										className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
											executionMode === "parallel"
												? "bg-blue-900/50 border-blue-600 text-blue-300"
												: "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
										}`}
									>
										Parallel
									</button>
								</div>
							</div>

							{/* Info about adding plans later */}
							<div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3">
								<p className="text-xs text-blue-300">
									After creating the task, you can upload plan files as phases from the task detail view.
								</p>
							</div>

							{/* Error */}
							{error && (
								<div className="p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300">
									{error}
								</div>
							)}
						</div>

						{/* ── Footer ── */}
						<div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-gray-700 shrink-0">
							<button
								onClick={handleClose}
								className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={handleCreate}
								disabled={!isValid || creating}
								className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
							>
								{creating ? (
									<Loader2 size={12} className="animate-spin" />
								) : (
									<Plus size={12} />
								)}
								{creating ? "Creating..." : "Create task"}
							</button>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
