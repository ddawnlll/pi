import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePlanRunner } from "../hooks/usePlanRunner";

interface PlanUploadDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectId: string;
	onExecutionStarted: (planExecId: string) => void;
}

export function PlanUploadDialog({
	isOpen,
	onClose,
	projectId,
	onExecutionStarted,
}: PlanUploadDialogProps) {
	const {
		validating,
		running,
		validationResult,
		runResult,
		validate,
		run,
		clearResults,
	} = usePlanRunner(projectId);

	const [planContent, setPlanContent] = useState("");
	const [planFileName, setPlanFileName] = useState("uploaded-plan.md");
	const [error, setError] = useState<string | null>(null);
	const [showRunConfirmation, setShowRunConfirmation] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleClose = () => {
		setPlanContent("");
		setPlanFileName("uploaded-plan.md");
		setError(null);
		setShowRunConfirmation(false);
		clearResults();
		onClose();
	};

	const handleValidate = async () => {
		if (!planContent.trim()) {
			setError("Plan content is required");
			return;
		}
		setError(null);
		setShowRunConfirmation(false);
		await validate(planContent.trim());
	};

	const handleRun = async () => {
		if (!planContent.trim()) return;
		setError(null);
		const result = await run(planContent.trim(), planFileName || undefined);
		if (result?.success && result.planExecutionId) {
			onExecutionStarted(result.planExecutionId);
			handleClose();
		} else if (result?.errors) {
			setError(result.errors.join("\n"));
		}
	};

	const handleFileUpload = () => {
		fileInputRef.current?.click();
	};

	const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setPlanFileName(file.name);
		const reader = new FileReader();
		reader.onload = (evt) => {
			const content = evt.target?.result as string;
			setPlanContent(content);
		};
		reader.readAsText(file);
		// Reset the input so the same file can be re-uploaded
		e.target.value = "";
	};

	const canValidate = planContent.trim().length > 0 && !validating && !running;
	const canRun =
		validationResult?.success && !running;
	const validationFailed =
		validationResult && !validationResult.success;

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
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-6 min-w-[600px] max-w-2xl max-h-[80vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-gray-100">
								Upload & Run Plan
							</h2>
							<span className="text-xs text-gray-500 font-mono">
								Project: {projectId.slice(0, 8)}...
							</span>
						</div>

						{/* Plan input area */}
						<div className="flex-1 min-h-0 flex flex-col">
							<label className="text-xs text-gray-400 block mb-1.5">
								Plan Content
							</label>

							<textarea
								ref={textareaRef}
								value={planContent}
								onChange={(e) => {
									setPlanContent(e.target.value);
									// Reset validation on content change
									if (validationResult) clearResults();
								}}
								placeholder={`Paste your plan content here...\n\nExample:\n# Plan: Example Project\n\n## Workspace Queue\n\`\`\`json\n{\n  "workspaces": [\n    {\n      "id": "ws-setup",\n      "instructions": "Set up project",\n      "capabilities": {\n        "canEditFile": true,\n        "canRunCommand": true\n      }\n    }\n  ]\n}\n\`\`\``}
								className="w-full flex-1 min-h-[200px] px-3 py-2 text-sm font-mono bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y"
								spellCheck={false}
							/>

							{/* File upload option */}
							<div className="flex items-center gap-3 mt-2">
								<input
									ref={fileInputRef}
									type="file"
									accept=".md,.json,.txt"
									onChange={handleFileSelected}
									className="hidden"
								/>
								<button
									onClick={handleFileUpload}
									className="text-xs px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
								>
									Browse File...
								</button>
								{planFileName && (
									<span className="text-xs text-gray-500">{planFileName}</span>
								)}
								<span className="text-xs text-gray-600 ml-auto">
									{planContent.length} chars
								</span>
							</div>
						</div>

						{/* Error display */}
						{error && (
							<div className="mt-3 p-2.5 bg-red-900/40 border border-red-800 rounded text-xs text-red-300 whitespace-pre-wrap max-h-32 overflow-auto">
								{error}
							</div>
						)}

						{/* Validation result */}
						{validationResult && (
							<div
								className={`mt-3 p-3 rounded border text-xs ${
									validationResult.success
										? "bg-green-900/30 border-green-800 text-green-300"
										: "bg-red-900/30 border-red-800 text-red-300"
								}`}
							>
								{validationResult.success && validationResult.parseResult ? (
									<div className="space-y-1">
										<div className="font-semibold text-green-200 mb-1.5">
											Plan Valid
										</div>
										<div className="grid grid-cols-2 gap-x-4 gap-y-1">
											<span className="text-green-400/70">Title:</span>
											<span className="text-green-200 text-right">
												{validationResult.parseResult.title}
											</span>
											<span className="text-green-400/70">Phase:</span>
											<span className="text-green-200 text-right">
												{validationResult.parseResult.phase}
											</span>
											<span className="text-green-400/70">Workspaces:</span>
											<span className="text-green-200 text-right">
												{validationResult.parseResult.workspaceCount}
											</span>
											<span className="text-green-400/70">Max Parallel:</span>
											<span className="text-green-200 text-right">
												{validationResult.parseResult.maxParallel}
											</span>
										</div>
										{validationResult.safety &&
											!validationResult.safety.safe && (
												<div className="mt-2 pt-2 border-t border-green-700">
													<div className="font-semibold text-yellow-300 mb-1">
														Safety Warnings
													</div>
													{validationResult.safety.critical.map((s, i) => (
														<div key={i} className="text-yellow-300/80 ml-2">
															- [{s.type}] {s.message}
														</div>
													))}
												</div>
											)}
										{validationResult.warnings &&
											validationResult.warnings.length > 0 && (
												<div className="mt-1 text-yellow-400/70">
													{validationResult.warnings.map((w, i) => (
														<div key={i}>Warning: {w}</div>
													))}
												</div>
											)}
									</div>
								) : (
									<div>
										<div className="font-semibold text-red-200 mb-1">
											Validation Failed
										</div>
										{validationResult.errors?.map((e, i) => (
											<div key={i} className="ml-2">
												- {e}
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{/* Run result */}
						{runResult && runResult.success && (
							<div className="mt-3 p-3 bg-blue-900/30 border border-blue-800 rounded text-xs text-blue-300">
								<div className="font-semibold text-blue-200 mb-1">
									Plan Execution Started
								</div>
								<div>
									Execution ID:{" "}
									<span className="font-mono text-blue-100">
										{runResult.planExecutionId}
									</span>
								</div>
							</div>
						)}

						{/* Run confirmation */}
						<AnimatePresence>
							{showRunConfirmation && (
								<motion.div
									initial={{ opacity: 0, height: 0 }}
									animate={{ opacity: 1, height: "auto" }}
									exit={{ opacity: 0, height: 0 }}
									className="mt-3 p-3 bg-yellow-900/30 border border-yellow-800 rounded text-xs text-yellow-300"
								>
									Are you sure you want to run this plan? It will execute
									workspaces on the file system.
								</motion.div>
							)}
						</AnimatePresence>

						{/* Action buttons */}
						<div className="flex gap-2 justify-end mt-4 pt-3 border-t border-gray-700">
							{!showRunConfirmation ? (
								<>
									<button
										onClick={handleClose}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									<button
										onClick={handleValidate}
										disabled={!canValidate}
										className="px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
									>
										{validating ? "Validating..." : "Validate"}
									</button>
									{validationFailed && (
										<button
											onClick={() => {
												clearResults();
												setError(null);
											}}
											className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
										>
											Edit Plan
										</button>
									)}
									{canRun && (
										<button
											onClick={() => setShowRunConfirmation(true)}
											className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 text-white transition-colors"
										>
											Run Plan
										</button>
									)}
								</>
							) : (
								<>
									<button
										onClick={() => setShowRunConfirmation(false)}
										className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
									>
										Cancel
									</button>
									<button
										onClick={handleRun}
										disabled={running}
										className="px-3 py-1.5 text-xs rounded bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50"
									>
										{running
											? "Starting..."
											: "Confirm & Run Plan"}
									</button>
								</>
							)}
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
