import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

export interface ControlButtonsProps {
	planStatus: string;
	onControl: (action: "pause" | "stop" | "cancel" | "resume") => void;
}

type PendingAction = "pause" | "stop" | "cancel" | "resume" | null;

const actionLabels: Record<string, string> = {
	pause: "Pause",
	stop: "Stop",
	cancel: "Cancel",
	resume: "Resume",
};

const actionColors: Record<string, string> = {
	pause: "bg-yellow-600 hover:bg-yellow-700",
	stop: "bg-orange-600 hover:bg-orange-700",
	cancel: "bg-red-600 hover:bg-red-700",
	resume: "bg-green-600 hover:bg-green-700",
};

export function ControlButtons({ planStatus, onControl }: ControlButtonsProps) {
	const [pendingAction, setPendingAction] = useState<PendingAction>(null);

	const handleConfirm = () => {
		if (pendingAction) {
			onControl(pendingAction);
			setPendingAction(null);
		}
	};

	return (
		<div className="flex gap-2 relative">
			{/* Resume — only visible when paused */}
			{planStatus === "paused" && (
				<ControlButton
					action="resume"
					onClick={() => setPendingAction("resume")}
				/>
			)}

			{/* Pause — disabled when not running */}
			<ControlButton
				action="pause"
				disabled={planStatus !== "running"}
				onClick={() => setPendingAction("pause")}
			/>

			<ControlButton
				action="stop"
				onClick={() => setPendingAction("stop")}
			/>

			<ControlButton
				action="cancel"
				onClick={() => setPendingAction("cancel")}
			/>

			{/* Confirmation popover */}
			<AnimatePresence>
				{pendingAction && (
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className="absolute top-full right-0 mt-2 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 min-w-64"
					>
						<p className="text-sm text-gray-200 mb-3">
							Are you sure you want to {pendingAction} the plan execution?
						</p>
						<div className="flex gap-2 justify-end">
							<button
								onClick={() => setPendingAction(null)}
								className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={handleConfirm}
								className={`px-3 py-1.5 text-xs rounded text-white transition-colors ${
									pendingAction === "cancel"
										? "bg-red-600 hover:bg-red-700"
										: pendingAction === "stop"
											? "bg-orange-600 hover:bg-orange-700"
											: pendingAction === "resume"
												? "bg-green-600 hover:bg-green-700"
												: "bg-yellow-600 hover:bg-yellow-700"
								}`}
							>
								Confirm
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

function ControlButton({
	action,
	disabled,
	onClick,
}: {
	action: string;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<motion.button
			whileTap={{ scale: 0.96 }}
			transition={{ duration: 0.1 }}
			disabled={disabled}
			onClick={onClick}
			className={`px-3 py-1 text-white rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${actionColors[action]}`}
		>
			{actionLabels[action]}
		</motion.button>
	);
}
