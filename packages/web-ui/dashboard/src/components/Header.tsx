import { motion } from "framer-motion";
import type { ControlButtonsProps } from "./ControlButtons";
import { ControlButtons } from "./ControlButtons";

interface HeaderProps extends ControlButtonsProps {
	status: string;
}

export function Header({ status, planStatus, onControl }: HeaderProps) {
	return (
		<div className="flex items-center justify-between border-b border-[#E8E6E1] dark:border-[#333] px-4 py-3 shrink-0 bg-[#F7F6F3] dark:bg-[#161616]">
			<h1 className="text-lg font-semibold text-stone-800 dark:text-stone-200">Pi Plan Dashboard</h1>
			<div className="flex items-center gap-3">
				<motion.span
					animate={{ backgroundColor: getBadgeBg(status) }}
					transition={{ duration: 0.3 }}
					className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
				>
					{status}
				</motion.span>
				<ControlButtons planStatus={planStatus} onControl={onControl} />
			</div>
		</div>
	);
}

function getBadgeBg(status: string): string {
	switch (status) {
		case "running":
			return "#22c55e";
		case "paused":
			return "#eab308";
		case "completed":
			return "#3b82f6";
		case "failed":
			return "#ef4444";
		default:
			return "#6b7280";
	}
}
