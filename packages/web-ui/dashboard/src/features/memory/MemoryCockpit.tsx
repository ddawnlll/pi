/**
 * MemoryCockpit — Placeholder from P11.Q (Memory Cockpit UI).
 *
 * When P11.Q runs, this will be replaced with the full Memory Cockpit UI.
 * For now, shows a placeholder indicating the feature is coming from
 * a dependent workspace.
 */

import { Database } from "lucide-react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

interface MemoryCockpitProps {
	className?: string;
}

export const MemoryCockpit: FC<MemoryCockpitProps> = ({ className = "" }) => {
	return (
		<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
			<div className={`w-16 h-16 rounded-2xl ${SURF} border ${BORD} flex items-center justify-center`}>
				<Database size={28} strokeWidth={1.2} className={MUT} />
			</div>
			<div className="text-center">
				<h2 className={`text-sm font-semibold ${TXT}`}>Memory Cockpit</h2>
				<p className={`text-xs ${MUT} mt-1 max-w-xs`}>
					Memory health, provenance, and compaction management.
					This feature is provided by workspace P11.Q.
				</p>
			</div>
		</div>
	);
};
