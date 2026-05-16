/**
 * PlanIntakePanel — Placeholder from P11.O (Plan Intake and DAG Diff UI).
 *
 * When P11.O runs, this will be replaced with the full Plan Intake UI.
 * For now, shows a placeholder indicating the feature is coming from
 * a dependent workspace.
 */

import { ScrollText } from "lucide-react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

interface PlanIntakePanelProps {
	className?: string;
}

export const PlanIntakePanel: FC<PlanIntakePanelProps> = ({ className = "" }) => {
	return (
		<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
			<div className={`w-16 h-16 rounded-2xl ${SURF} border ${BORD} flex items-center justify-center`}>
				<ScrollText size={28} strokeWidth={1.2} className={MUT} />
			</div>
			<div className="text-center">
				<h2 className={`text-sm font-semibold ${TXT}`}>Plan Intake</h2>
				<p className={`text-xs ${MUT} mt-1 max-w-xs`}>
					Plan analysis, DAG diff, and optimization approval.
					This feature is provided by workspace P11.O.
				</p>
			</div>
		</div>
	);
};
