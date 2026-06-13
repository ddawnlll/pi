import type { AccpDiagnostic } from "@earendil-works/pi-execution-contracts";
import { AlertTriangle, Info, XCircle } from "lucide-react";

interface AccpDiagnosticsPanelProps {
	diagnostics: AccpDiagnostic[];
	className?: string;
}

const severityConfig: Record<string, { icon: typeof AlertTriangle; containerClass: string; textClass: string }> = {
	error: { icon: XCircle, containerClass: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800", textClass: "text-red-700 dark:text-red-300" },
	warning: { icon: AlertTriangle, containerClass: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800", textClass: "text-amber-700 dark:text-amber-300" },
	info: { icon: Info, containerClass: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800", textClass: "text-blue-700 dark:text-blue-300" },
};

/**
 * ACCP Diagnostics Panel — read-only display.
 * Renders structured ACCP diagnostics with severity icons and fatal badges.
 */
export function AccpDiagnosticsPanel({ diagnostics, className = "" }: AccpDiagnosticsPanelProps) {
	if (!diagnostics || diagnostics.length === 0) {
		return (
			<div className={`rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900/50 p-4 ${className}`}>
				<p className="text-xs text-stone-400 dark:text-stone-500 text-center">No ACCP diagnostics</p>
			</div>
		);
	}

	const fatalCount = diagnostics.filter((d) => d.fatal).length;
	const errorCount = diagnostics.filter((d) => d.severity === "error" && !d.fatal).length;
	const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

	return (
		<div className={`rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 ${className}`}>
			<div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-200 dark:border-stone-700">
				<h3 className="text-sm font-semibold text-stone-700 dark:text-stone-300">
					ACCP Diagnostics ({diagnostics.length})
				</h3>
				<div className="flex items-center gap-2 text-xs">
					{fatalCount > 0 && (
						<span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium">
							{fatalCount} fatal
						</span>
					)}
					{errorCount > 0 && (
						<span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium">
							{errorCount} error
						</span>
					)}
					{warnCount > 0 && (
						<span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
							{warnCount} warn
						</span>
					)}
				</div>
			</div>
			<ul className="divide-y divide-stone-100 dark:divide-stone-800 max-h-80 overflow-y-auto">
				{diagnostics.map((d, i) => {
					const config = severityConfig[d.severity] ?? severityConfig.info;
					const Icon = config.icon;
					return (
						<li key={i} className="px-4 py-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors">
							<div className="flex items-start gap-2.5">
								<Icon size={14} className={`mt-0.5 shrink-0 ${config.textClass}`} />
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="text-xs font-mono font-semibold text-stone-600 dark:text-stone-400">
											{d.code}
										</span>
										{d.fatal && (
											<span className="px-1 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
												FATAL
											</span>
										)}
									</div>
									<p className={`text-xs mt-0.5 ${config.textClass}`}>
										{d.message}
									</p>
									{d.sourcePath && (
										<p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1 font-mono truncate">
											{d.sourcePath}
										</p>
									)}
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
