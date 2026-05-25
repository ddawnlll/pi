import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type BrainPrompt = {
	systemPrompt: string;
	observationRules: string[];
	scanPriorities: string[];
};

const API_BASE = "";

async function fetchBrainPrompt(): Promise<BrainPrompt> {
	try {
		const r = await fetch(`${API_BASE}/api/orchestrator/brain-prompt`);
		const data = await r.json();
		if (data.success && data.prompt) return data.prompt as BrainPrompt;
	} catch {
		// fall through
	}
	return {
		systemPrompt: "You are Pi's brain — a continuous improvement orchestrator.",
		observationRules: [],
		scanPriorities: [],
	};
}

async function saveBrainPrompt(prompt: BrainPrompt): Promise<boolean> {
	try {
		const r = await fetch(`${API_BASE}/api/orchestrator/brain-prompt`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt }),
		});
		const data = await r.json();
		return data.success === true;
	} catch {
		return false;
	}
}

export function BrainPromptEditor() {
	const [prompt, setPrompt] = useState<BrainPrompt | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [editMode, setEditMode] = useState(false);
	const [editPrompt, setEditPrompt] = useState("");
	const [editRules, setEditRules] = useState<string[]>([]);
	const [editPriorities, setEditPriorities] = useState<string[]>([]);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);

	useEffect(() => {
		fetchBrainPrompt()
			.then((p) => {
				setPrompt(p);
				setEditPrompt(p.systemPrompt);
				setEditRules([...p.observationRules]);
				setEditPriorities([...p.scanPriorities]);
			})
			.finally(() => setLoading(false));
	}, []);

	const handleEdit = useCallback(() => {
		if (!prompt) return;
		setEditPrompt(prompt.systemPrompt);
		setEditRules([...prompt.observationRules]);
		setEditPriorities([...prompt.scanPriorities]);
		setEditMode(true);
		setSuccessMsg(null);
		setErrorMsg(null);
	}, [prompt]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setSuccessMsg(null);
		setErrorMsg(null);
		const updated: BrainPrompt = {
			systemPrompt: editPrompt,
			observationRules: editRules.filter((r) => r.trim().length > 0),
			scanPriorities: editPriorities.filter((p) => p.trim().length > 0),
		};
		const ok = await saveBrainPrompt(updated);
		if (ok) {
			setPrompt(updated);
			setEditMode(false);
			setSuccessMsg("Brain prompt saved");
			setTimeout(() => setSuccessMsg(null), 3000);
		} else {
			setErrorMsg("Failed to save brain prompt");
		}
		setSaving(false);
	}, [editPrompt, editRules, editPriorities]);

	const handleCancel = useCallback(() => {
		if (!prompt) return;
		setEditPrompt(prompt.systemPrompt);
		setEditRules([...prompt.observationRules]);
		setEditPriorities([...prompt.scanPriorities]);
		setEditMode(false);
		setErrorMsg(null);
	}, [prompt]);

	const addRule = useCallback(() => {
		setEditRules((prev) => [...prev, ""]);
	}, []);

	const removeRule = useCallback((i: number) => {
		setEditRules((prev) => prev.filter((_, idx) => idx !== i));
	}, []);

	const addPriority = useCallback(() => {
		setEditPriorities((prev) => [...prev, ""]);
	}, []);

	const removePriority = useCallback((i: number) => {
		setEditPriorities((prev) => prev.filter((_, idx) => idx !== i));
	}, []);

	if (loading) {
		return (
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 flex items-center justify-center">
				<Loader2 size={14} className="animate-spin text-stone-400" />
			</div>
		);
	}

	return (
		<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
			<div className="flex items-center justify-between">
				<h3 className="text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">
					Brain Prompt
				</h3>
				{!editMode && (
					<button
						onClick={handleEdit}
						className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
					>
						Edit
					</button>
				)}
			</div>

			{/* Success/Error messages */}
			{successMsg && (
				<div className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded">
					{successMsg}
				</div>
			)}
			{errorMsg && (
				<div className="text-[10px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
					{errorMsg}
				</div>
			)}

			{editMode ? (
				<div className="space-y-3">
					{/* System Prompt */}
					<div>
						<label className="text-[10px] font-medium text-stone-500 dark:text-stone-400 block mb-1">
							System Prompt
						</label>
						<textarea
							value={editPrompt}
							onChange={(e) => setEditPrompt(e.target.value)}
							className="w-full px-2.5 py-1.5 text-[10px] font-mono rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1E1E1E] text-stone-800 dark:text-stone-200 resize-y min-h-[80px] outline-none focus:border-blue-500"
						/>
					</div>

					{/* Observation Rules */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
								Observation Rules
							</label>
							<button
								onClick={addRule}
								className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700"
							>
								+ Add rule
							</button>
						</div>
						<div className="space-y-1">
							{editRules.map((rule, i) => (
								<div key={i} className="flex items-center gap-1">
									<input
										value={rule}
										onChange={(e) => {
											const next = [...editRules];
											next[i] = e.target.value;
											setEditRules(next);
										}}
										className="flex-1 px-2 py-1 text-[10px] rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1E1E1E] text-stone-800 dark:text-stone-200 outline-none focus:border-blue-500"
									/>
									<button
										onClick={() => removeRule(i)}
										className="text-stone-400 hover:text-red-500 text-[10px] px-1"
									>
										&times;
									</button>
								</div>
							))}
						</div>
					</div>

					{/* Scan Priorities */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<label className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
								Scan Priorities
							</label>
							<button
								onClick={addPriority}
								className="text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700"
							>
								+ Add priority
							</button>
						</div>
						<div className="space-y-1">
							{editPriorities.map((p, i) => (
								<div key={i} className="flex items-center gap-1">
									<input
										value={p}
										onChange={(e) => {
											const next = [...editPriorities];
											next[i] = e.target.value;
											setEditPriorities(next);
										}}
										className="flex-1 px-2 py-1 text-[10px] rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1E1E1E] text-stone-800 dark:text-stone-200 outline-none focus:border-blue-500"
									/>
									<button
										onClick={() => removePriority(i)}
										className="text-stone-400 hover:text-red-500 text-[10px] px-1"
									>
										&times;
									</button>
								</div>
							))}
						</div>
					</div>

					{/* Action buttons */}
					<div className="flex gap-2 pt-1">
						<button
							onClick={handleSave}
							disabled={saving}
							className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-medium rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors disabled:opacity-50"
						>
							{saving && <Loader2 size={10} className="animate-spin" />}
							Save
						</button>
						<button
							onClick={handleCancel}
							className="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				/* Read-only view */
				prompt && (
					<div className="space-y-2">
						<div>
							<div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 mb-0.5">
								System Prompt
							</div>
							<p className="text-[10px] text-stone-600 dark:text-stone-400 leading-relaxed line-clamp-3">
								{prompt.systemPrompt}
							</p>
						</div>
						{prompt.observationRules.length > 0 && (
							<div>
								<div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 mb-0.5">
									Observation Rules ({prompt.observationRules.length})
								</div>
								<ul className="list-disc list-inside text-[10px] text-stone-600 dark:text-stone-400 space-y-0.5">
									{prompt.observationRules.slice(0, 3).map((r, i) => (
										<li key={i} className="truncate">{r}</li>
									))}
									{prompt.observationRules.length > 3 && (
										<li className="text-stone-400">+{prompt.observationRules.length - 3} more</li>
									)}
								</ul>
							</div>
						)}
						{prompt.scanPriorities.length > 0 && (
							<div>
								<div className="text-[10px] font-medium text-stone-400 dark:text-stone-500 mb-0.5">
									Scan Priorities
								</div>
								<div className="flex flex-wrap gap-1">
									{prompt.scanPriorities.map((p, i) => (
										<span key={i} className="px-1.5 py-0.5 text-[9px] rounded bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
											{p}
										</span>
									))}
								</div>
							</div>
						)}
					</div>
				)
			)}
		</div>
	);
}
