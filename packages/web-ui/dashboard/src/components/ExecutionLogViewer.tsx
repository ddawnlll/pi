import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ExecutionLogViewerProps {
	planExecId: string | null;
	isOpen: boolean;
	onClose: () => void;
}

const API_BASE = "";

async function fetchExecutionLog(planExecId: string): Promise<{ content: string; exists: boolean }> {
	try {
		const response = await fetch(`${API_BASE}/api/executions/${planExecId}/log`);
		if (!response.ok) {
			return { content: "", exists: false };
		}
		return await response.json();
	} catch (error) {
		console.error("Failed to fetch execution log:", error);
		return { content: "", exists: false };
	}
}

export function ExecutionLogViewer({ planExecId, isOpen, onClose }: ExecutionLogViewerProps) {
	const [logContent, setLogContent] = useState<string>("");
	const [loading, setLoading] = useState(false);
	const [exists, setExists] = useState(false);

	useEffect(() => {
		if (isOpen && planExecId) {
			setLoading(true);
			fetchExecutionLog(planExecId).then((result) => {
				setLogContent(result.content);
				setExists(result.exists);
				setLoading(false);
			});

			// Auto-refresh every 2 seconds while open
			const interval = setInterval(() => {
				fetchExecutionLog(planExecId).then((result) => {
					setLogContent(result.content);
					setExists(result.exists);
				});
			}, 2000);

			return () => clearInterval(interval);
		}
	}, [isOpen, planExecId]);

	if (!isOpen) return null;

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
				onClick={onClose}
			>
				<motion.div
					initial={{ scale: 0.95, opacity: 0 }}
					animate={{ scale: 1, opacity: 1 }}
					exit={{ scale: 0.95, opacity: 0 }}
					onClick={(e) => e.stopPropagation()}
					className="bg-[#F7F6F3] dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden"
				>
					{/* Header */}
					<div className="flex items-center justify-between p-4 border-b border-[#E8E6E1] dark:border-[#333] shrink-0">
						<h2 className="text-lg font-semibold text-stone-800 dark:text-stone-200">
							Execution Log
						</h2>
						<button
							onClick={onClose}
							className="text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:text-stone-200 transition-colors"
						>
							✕
						</button>
					</div>

					{/* Content */}
					<div className="flex-1 overflow-y-auto p-4 min-h-0">
						{loading ? (
							<div className="text-stone-400 dark:text-stone-500 text-sm">Loading...</div>
						) : !exists ? (
							<div className="text-stone-400 dark:text-stone-500 text-sm">
								No execution log found. The log file will be created when the plan starts executing.
							</div>
						) : logContent.length === 0 ? (
							<div className="text-stone-400 dark:text-stone-500 text-sm">Log file is empty</div>
						) : (
							<pre className="text-xs text-stone-700 dark:text-stone-300 font-mono whitespace-pre-wrap break-words">
								{logContent}
							</pre>
						)}
					</div>

					{/* Footer */}
					<div className="flex items-center justify-between p-4 border-t border-[#E8E6E1] dark:border-[#333]">
						<div className="text-xs text-stone-400 dark:text-stone-500">
							{exists && `${logContent.split("\n").length} lines`}
						</div>
						<button
							onClick={onClose}
							className="px-4 py-2 text-sm rounded bg-stone-100 dark:bg-[#2A2A2A] hover:bg-stone-200 dark:hover:bg-[#333] text-stone-800 dark:text-stone-200 transition-colors"
						>
							Close
						</button>
					</div>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
}
