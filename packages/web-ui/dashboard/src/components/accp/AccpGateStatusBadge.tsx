import type { AccpGateVerdict, AccpMode } from "@earendil-works/pi-execution-contracts";

interface AccpGateStatusBadgeProps {
	verdict?: AccpGateVerdict;
	mode?: AccpMode;
	modeRequired: boolean;
	className?: string;
}

/**
 * ACCP Gate Status Badge — read-only display.
 * Shows gate pass/block status without providing UI affordances
 * that trigger mutation or route advancement.
 */
export function AccpGateStatusBadge({ verdict, mode, modeRequired, className = "" }: AccpGateStatusBadgeProps) {
	if (mode === "off") {
		return (
			<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 ${className}`}>
				ACCP: Off
			</span>
		);
	}

	if (!verdict) {
		return (
			<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 ${className}`}>
				ACCP: Unknown
			</span>
		);
	}

	if (!modeRequired) {
		return (
			<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 ${className}`}>
				<span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
				ACCP: Advisory
			</span>
		);
	}

	if (!verdict.valid) {
		return (
			<span
				className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 ${className}`}
				title={verdict.fatalErrors.join("; ")}
			>
				<span className="w-1.5 h-1.5 rounded-full bg-red-500" />
				ACCP: Blocked ({verdict.fatalErrors.length})
			</span>
		);
	}

	return (
		<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 ${className}`}>
			<span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
			ACCP: Pass
		</span>
	);
}
