/**
 * PolicyAuditCenter — Placeholder from P11.R (Policy and Audit Center UI).
 *
 * When P11.R runs, this will be replaced with the full Policy and Audit Center UI.
 * For now, shows a placeholder indicating the feature is coming from
 * a dependent workspace.
 */

import { ShieldAlert } from "lucide-react";
import type { FC } from "react";

const SURF = "bg-white dark:bg-[#1E1E1E]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

interface PolicyAuditCenterProps {
	className?: string;
}

export const PolicyAuditCenter: FC<PolicyAuditCenterProps> = ({ className = "" }) => {
	return (
		<div className={`${SURF} h-full flex flex-col items-center justify-center gap-4 ${className}`}>
			<div className={`w-16 h-16 rounded-2xl ${SURF} border ${BORD} flex items-center justify-center`}>
				<ShieldAlert size={28} strokeWidth={1.2} className={MUT} />
			</div>
			<div className="text-center">
				<h2 className={`text-sm font-semibold ${TXT}`}>Policy & Audit Center</h2>
				<p className={`text-xs ${MUT} mt-1 max-w-xs`}>
					Permissions, approvals, and audit timeline.
					This feature is provided by workspace P11.R.
				</p>
			</div>
		</div>
	);
};
