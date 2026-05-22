import React, { useState } from "react";

interface EmergencyStopButtonProps {
	active: boolean;
	onStop: () => Promise<void>;
	onRelease: () => Promise<void>;
	loading: boolean;
}

export function EmergencyStopButton({ active, onStop, onRelease, loading }: EmergencyStopButtonProps) {
	const [confirming, setConfirming] = useState(false);

	const handleClick = () => {
		if (!active) {
			setConfirming(true);
		} else {
			onRelease();
		}
	};

	if (confirming) {
		return (
			<div className="border border-red-200 dark:border-red-800 rounded-lg p-4 bg-red-50 dark:bg-red-900/20 space-y-3">
				<p className="text-xs font-medium text-red-700 dark:text-red-300">
					Are you sure? This will immediately halt all autonomous actions.
				</p>
				<div className="flex gap-2">
					<button
						onClick={() => { onStop(); setConfirming(false); }}
						disabled={loading}
						className="px-4 py-2 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
					>
						{loading ? "Stopping..." : "Confirm Emergency Stop"}
					</button>
					<button
						onClick={() => setConfirming(false)}
						disabled={loading}
						className="px-4 py-2 text-xs rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-300"
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<button
			onClick={handleClick}
			disabled={loading}
			className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
				active
					? "bg-emerald-500 text-white hover:bg-emerald-600"
					: "bg-red-500 text-white hover:bg-red-600"
			}`}
		>
			{active ? "Release Emergency Stop" : "Emergency Stop"}
		</button>
	);
}
