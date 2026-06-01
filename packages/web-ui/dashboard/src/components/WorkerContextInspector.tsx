/**
 * WorkerContextInspector — Minimal panel showing the worker context (P41.08).
 *
 * Displays a compact summary of the worker context including:
 * - Goal / role
 * - Allowed and touched files
 * - Last command
 * - Log summary
 * - Active directives and escalations count
 * - Link to transcript
 *
 * Acceptance Criteria:
 * - Shows worker context summary from the read model API
 * - Supports loading, empty, error, and data states
 * - Minimal footprint (no full dashboard redesign)
 */

import {
	Activity,
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	FileCode,
	FileText,
	Loader2,
	Terminal,
	User,
} from "lucide-react";
import { useWorkerContext } from "../hooks/useWorkerContext";

// ─── Style tokens ──────────────────────────────────────────────────────────

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ERR_TXT = "text-red-600 dark:text-red-400";
const GOOD_TXT = "text-emerald-600 dark:text-emerald-400";
const WARN_TXT = "text-amber-600 dark:text-amber-400";

// ─── Component ─────────────────────────────────────────────────────────────

interface WorkerContextInspectorProps {
	/** Plan execution ID */
	planExecId: string | null;
	/** Workspace ID */
	workspaceId: string | null;
	/** Optional class name */
	className?: string;
}

/**
 * Minimal Worker Context Inspector panel.
 *
 * Shows essential context about a running/failed worker workspace:
 * goal, role, touched files, recent commands, and active escalations/directives.
 */
export function WorkerContextInspector({
	planExecId,
	workspaceId,
	className = "",
}: WorkerContextInspectorProps) {
	const { data: context, isLoading, error } = useWorkerContext(planExecId, workspaceId);

	// ── Loading state ───────────────────────────────────────────────
	if (isLoading) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className="flex items-center gap-2 text-xs text-stone-400">
					<Loader2 size={12} className="animate-spin" />
					Loading worker context...
				</div>
			</div>
		);
	}

	// ── Error state ────────────────────────────────────────────────
	if (error) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className="flex items-center gap-2 text-xs text-red-500">
					<AlertCircle size={12} />
					Failed to load worker context
				</div>
			</div>
		);
	}

	// ── Empty state ────────────────────────────────────────────────
	if (!context) {
		return (
			<div className={`${SURF} rounded-lg border ${BORD} p-3 ${className}`}>
				<div className="flex items-center gap-2 text-xs text-stone-400">
					<Activity size={12} />
					No worker context available
				</div>
			</div>
		);
	}

	// ── Data state ─────────────────────────────────────────────────
	const directiveCount = context.activeDirectives?.length ?? 0;
	const escalationCount = context.activeEscalations?.length ?? 0;
	const touchedCount = context.touchedFiles?.length ?? 0;

	return (
		<div className={`${SURF} rounded-lg border ${BORD} ${className}`}>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b ${BORD}">
				<div className="flex items-center gap-2">
					<Activity size={13} className={ACC_TXT} />
					<span className={`text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Worker Context
					</span>
				</div>
				{context.stage && (
					<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
						context.stage === "active" ? `${ACC_BG} ${ACC_TXT}` :
						context.stage === "failed" ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" :
						context.stage === "complete" ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400" :
						"bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400"
					}`}>
						{context.stage}
					</span>
				)}
			</div>

			<div className="p-3 space-y-2.5 text-xs">
				{/* Goal / Role */}
				<div className="flex items-start gap-2">
					<User size={13} className={`mt-0.5 shrink-0 ${MUT}`} />
					<div className="min-w-0 flex-1">
						{context.goal && (
							<p className={`${TXT} truncate`} title={context.goal}>
								{context.goal}
							</p>
						)}
						{context.role && (
							<p className={`text-[10px] ${MUT}`}>
								Role: {context.role} &middot; Attempt {context.attempts}
							</p>
						)}
					</div>
				</div>

				{/* Touched files */}
				{context.touchedFiles && context.touchedFiles.length > 0 && (
					<div className="flex items-start gap-2">
						<FileCode size={13} className={`mt-0.5 shrink-0 ${MUT}`} />
						<div className="min-w-0 flex-1 space-y-0.5">
							<span className={`text-[10px] ${MUT}`}>
								{context.touchedFiles.length} file{context.touchedFiles.length !== 1 ? "s" : ""} changed
							</span>
							{context.touchedFiles.slice(0, 5).map((f) => (
								<div key={f.path} className="flex items-center gap-1 text-[10px] font-mono">
									<span className={
										f.change === "created" ? GOOD_TXT :
										f.change === "modified" ? ACC_TXT :
										ERR_TXT
									}>
										{f.change === "created" ? "+" : f.change === "modified" ? "~" : "-"}
									</span>
									<span className={`${MUT} truncate`}>{f.path}</span>
								</div>
							))}
							{context.touchedFiles.length > 5 && (
								<p className={`text-[10px] ${MUT}`}>
									...and {context.touchedFiles.length - 5} more
								</p>
							)}
						</div>
					</div>
				)}

				{/* Last command */}
				{context.lastCommand && (
					<div className="flex items-start gap-2">
						<Terminal size={13} className={`mt-0.5 shrink-0 ${MUT}`} />
						<div className="min-w-0 flex-1">
							<p className={`text-[10px] font-mono ${TXT} truncate`} title={context.lastCommand}>
								{context.lastCommand.length > 80
									? context.lastCommand.slice(0, 80) + "..."
									: context.lastCommand}
							</p>
						</div>
					</div>
				)}

				{/* Directives and Escalations status */}
				<div className="flex items-center gap-3 pt-1">
					{directiveCount > 0 && (
						<div className="flex items-center gap-1">
							<FileText size={11} className={ACC_TXT} />
							<span className={`text-[10px] ${ACC_TXT}`}>
								{directiveCount} directive{directiveCount !== 1 ? "s" : ""}
							</span>
						</div>
					)}
					{escalationCount > 0 && (
						<div className="flex items-center gap-1">
							<AlertTriangle size={11} className={WARN_TXT} />
							<span className={`text-[10px] ${WARN_TXT}`}>
								{escalationCount} escalation{escalationCount !== 1 ? "s" : ""}
							</span>
						</div>
					)}
					{context.humanDirective && (
						<div className="flex items-center gap-1">
							<AlertCircle size={11} className={ACC_TXT} />
							<span className={`text-[10px] ${ACC_TXT}`}>Has human directive</span>
						</div>
					)}
				</div>

				{/* Transcript link */}
				{context.transcriptUrl && (
					<div className="flex items-center gap-1 pt-1">
						<CheckCircle size={11} className={GOOD_TXT} />
						<a
							href={context.transcriptUrl}
							className={`text-[10px] ${ACC_TXT} hover:underline`}
							target="_blank"
							rel="noopener noreferrer"
						>
							Open transcript
						</a>
					</div>
				)}
			</div>
		</div>
	);
}
