import { motion } from "framer-motion";

export type PulseState = "streaming" | "thinking" | "blocked" | "idle" | "retrying";

/**
 * Map WorkspaceSummary stage to a pulse state.
 */
export function stageToPulseState(stage: string): PulseState {
	switch (stage) {
		case "active":
			return "streaming";
		case "blocked":
			return "blocked";
		case "pending":
			return "idle";
		case "complete":
			return "idle";
		case "failed":
			return "retrying";
		default:
			return "idle";
	}
}

function pulseColor(state: PulseState): string {
	switch (state) {
		case "streaming":
		case "thinking":
			return "bg-green-500 shadow-green-500/50";
		case "idle":
		case "blocked":
			return "bg-yellow-500 shadow-yellow-500/50";
		case "retrying":
			return "bg-red-500 shadow-red-500/50";
	}
}

/** Whether this state should animate with a pulse */
function isActiveState(state: PulseState): boolean {
	return state === "streaming" || state === "thinking";
}

interface ActivityDotProps {
	state: PulseState;
}

/**
 * A small colored status dot that pulses on active states.
 */
export function ActivityDot({ state }: ActivityDotProps) {
	const active = isActiveState(state);

	return (
		<motion.span
			className={`inline-block w-2.5 h-2.5 rounded-full ${pulseColor(state)}`}
			animate={
				active
					? {
							scale: [1, 1.3, 1],
							opacity: [0.8, 1, 0.8],
						}
					: { scale: 1, opacity: 1 }
			}
			transition={
				active
					? {
							duration: 1.5,
							ease: "easeInOut",
							repeat: Infinity,
						}
					: { duration: 0.2 }
			}
		/>
	);
}
