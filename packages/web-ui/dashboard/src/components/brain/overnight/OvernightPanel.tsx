import React, { useState } from "react";
import { useOvernight } from "../../../hooks/useOvernight";
import { RunHistoryTable } from "./RunHistoryTable";

const AVAILABLE_PLANS = [
	{ id: "plan-factory-reflection", label: "P17 Plan Factory & Reflection" },
	{ id: "proposal-engine", label: "P16 Proposal Engine" },
	{ id: "goals-preferences", label: "P15 Goals & Preferences" },
	{ id: "memory-consolidation", label: "P14 Memory Consolidation" },
];

const AUTONOMY_LEVELS = [
	{ value: 1, label: "Level 1 — Approval required for all actions" },
	{ value: 2, label: "Level 2 — Approval for high-risk actions only" },
	{ value: 3, label: "Level 3 — Operator (non-critical auto-approve)" },
];

const STOP_CONDITIONS = [
	{ id: "integration_dirty", label: "Integration queue dirty" },
	{ id: "merge_conflict", label: "Merge conflict" },
	{ id: "policy_violation", label: "Policy violation" },
	{ id: "low_confidence", label: "Low confidence unsafe" },
];

interface OvernightPanelProps {
	onRefresh?: () => void;
}

export function OvernightPanel({ onRefresh }: OvernightPanelProps) {
	const { history, loading, error, queue, cancel, refresh } = useOvernight();
	const [selectedPlans, setSelectedPlans] = useState<string[]>(
		AVAILABLE_PLANS.slice(0, 2).map((p) => p.id),
	);
	const [autonomyLevel, setAutonomyLevel] = useState(3);
	const [maxDuration, setMaxDuration] = useState(8);
	const [selectedStops, setSelectedStops] = useState<string[]>(
		STOP_CONDITIONS.slice(0, 3).map((s) => s.id),
	);
	const [queueLoading, setQueueLoading] = useState(false);
	const [resultMsg, setResultMsg] = useState<string | null>(null);

	const togglePlan = (id: string) => {
		setSelectedPlans((prev) =>
			prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
		);
	};

	const toggleStop = (id: string) => {
		setSelectedStops((prev) =>
			prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
		);
	};

	const handleRun = async () => {
		setQueueLoading(true);
		setResultMsg(null);
		const sessionId = await queue({
			queueSelection: selectedPlans,
			autonomyLevel,
			maxDurationHours: maxDuration,
			stopConditions: selectedStops,
		});
		setQueueLoading(false);
		if (sessionId) {
			setResultMsg(`Overnight session queued: ${sessionId.slice(0, 12)}...`);
		} else {
			setResultMsg("Failed to queue overnight run.");
		}
		onRefresh?.();
	};

	return (
		<div className="space-y-4">
			{/* Queue selection */}
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-3">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Queue Selection</h3>
				<div className="space-y-1.5">
					{AVAILABLE_PLANS.map((p) => (
						<label key={p.id} className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedPlans.includes(p.id)}
								onChange={() => togglePlan(p.id)}
								className="rounded border-stone-300 dark:border-stone-600"
							/>
							<span className="text-xs text-stone-600 dark:text-stone-300">{p.label}</span>
						</label>
					))}
				</div>
			</div>

			{/* Autonomy level */}
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-2">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Autonomy Level</h3>
				<select
					value={autonomyLevel}
					onChange={(e) => setAutonomyLevel(Number(e.target.value))}
					className="w-full px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200"
				>
					{AUTONOMY_LEVELS.map((l) => (
						<option key={l.value} value={l.value}>{l.label}</option>
					))}
				</select>
			</div>

			{/* Duration */}
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-2">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Max Duration</h3>
				<input
					type="number"
					value={maxDuration}
					onChange={(e) => setMaxDuration(Number(e.target.value))}
					min={1}
					max={24}
					className="w-20 px-3 py-1.5 text-xs rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-200"
				/>
				<span className="text-xs text-stone-400 ml-2">hours</span>
			</div>

			{/* Stop conditions */}
			<div className="border border-stone-200 dark:border-stone-700 rounded-lg p-4 space-y-2">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200">Stop Conditions</h3>
				<div className="space-y-1.5">
					{STOP_CONDITIONS.map((s) => (
						<label key={s.id} className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={selectedStops.includes(s.id)}
								onChange={() => toggleStop(s.id)}
								className="rounded border-stone-300 dark:border-stone-600"
							/>
							<span className="text-xs text-stone-600 dark:text-stone-300">{s.label}</span>
						</label>
					))}
				</div>
			</div>

			{/* Run button */}
			<button
				onClick={handleRun}
				disabled={queueLoading || selectedPlans.length === 0}
				className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors"
			>
				{queueLoading ? "Queuing..." : "Run Now"}
			</button>

			{resultMsg && (
				<p className={`text-xs text-center ${resultMsg.includes("Failed") ? "text-red-500" : "text-emerald-600"}`}>
					{resultMsg}
				</p>
			)}

			{/* History */}
			<div className="pt-4 border-t border-stone-100 dark:border-stone-800">
				<h3 className="text-xs font-semibold text-stone-800 dark:text-stone-200 mb-3">Past Runs</h3>
				<RunHistoryTable sessions={history} loading={loading} error={error} />
			</div>
		</div>
	);
}
