/**
 * FileEvidencePanel — P42.07 File Evidence Panel
 *
 * Shows related workspace, command, and validation evidence for a selected file.
 * Provides links to the workspace detail page and execution logs.
 * Consumes read model data via hooks.
 */

import React from "react";
import {
	Box,
	Terminal,
	CheckCircle,
	XCircle,
	AlertTriangle,
	ExternalLink,
	Loader2,
	FileText,
} from "lucide-react";
import { usePlanWorkspaces } from "../../hooks/usePlanWorkspaces";
import { useChangedFiles } from "../../hooks/useChangedFiles";
import { useCommandHistory } from "../../hooks/useCommandHistory";
import { useValidationStatus } from "../../hooks/useValidationStatus";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileEvidencePanelProps {
	projectId: string | null;
	planExecId: string | null;
	workspaceId: string | null;
	filePath: string | null;
	/** Called when user wants to navigate to workspace detail */
	onNavigateToWorkspace?: (workspaceId: string) => void;
	/** Called when user wants to view logs for a workspace */
	onNavigateToLogs?: (workspaceId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileEvidencePanel({
	projectId,
	planExecId,
	workspaceId,
	filePath,
	onNavigateToWorkspace,
	onNavigateToLogs,
}: FileEvidencePanelProps) {
	// Fetch workspace list
	const { workspaces, isLoading: wsLoading } = usePlanWorkspaces({ projectId, planExecId });

	// Fetch changed files for the workspace
	const { data: changedFiles, isLoading: filesLoading } = useChangedFiles(
		projectId,
		planExecId,
		workspaceId,
		!!workspaceId,
	);

	// Fetch command history
	const { data: commands, isLoading: cmdLoading } = useCommandHistory(
		projectId,
		planExecId,
		workspaceId,
		!!workspaceId,
	);

	// Fetch validation status
	const { data: validation, isLoading: valLoading } = useValidationStatus(
		projectId,
		planExecId,
		workspaceId,
		!!workspaceId,
	);

	const isLoading = wsLoading || filesLoading || cmdLoading || valLoading;

	// No file selected
	if (!filePath) {
		return (
			<div className="flex flex-col items-center justify-center py-6 text-stone-400 dark:text-stone-500">
				<FileText size={20} className="mb-2 opacity-50" />
				<p className="text-xs">Select a file to view evidence</p>
				<p className="text-xs mt-1 opacity-50">Evidence includes related workspace, commands, and validation</p>
			</div>
		);
	}

	// Loading
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-6">
				<Loader2 size={16} className="animate-spin text-stone-400" />
				<span className="text-xs text-stone-400 ml-2">Loading evidence...</span>
			</div>
		);
	}

	// Find the workspace that contains this file
	const fileWorkspace = workspaces.find((w) => w.id === workspaceId);
	const fileEntry = changedFiles?.find((f) => f.path === filePath);

	// Find related commands (target/validation commands)
	const targetCommands = commands?.filter((c) => c.isTargetCommand) ?? [];
	const lastCommand = commands && commands.length > 0 ? commands[commands.length - 1] : null;

	return (
		<div className="flex flex-col gap-3 p-3 text-xs text-stone-600 dark:text-stone-400">
			{/* Section: Related Workspace */}
			<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-2.5">
				<div className="flex items-center gap-1.5 mb-1.5">
					<Box size={12} className="text-stone-400" />
					<span className="font-medium text-stone-800 dark:text-stone-200">Related Workspace</span>
				</div>
				{fileWorkspace ? (
					<div className="space-y-1">
						<div className="flex items-center justify-between">
							<span className="font-mono text-xs">{fileWorkspace.id.slice(0, 8)}...</span>
							<StatusBadge stage={fileWorkspace.stage} />
						</div>
						<div className="flex items-center justify-between text-xs text-stone-400">
							<span>
								{fileWorkspace.attempts > 0 ? `${fileWorkspace.attempts} attempt${fileWorkspace.attempts !== 1 ? "s" : ""}` : "No attempts yet"}
							</span>
							{fileWorkspace.error && (
								<span className="text-red-500 truncate max-w-[150px]" title={fileWorkspace.error}>
									{fileWorkspace.error}
								</span>
							)}
						</div>
						<div className="flex gap-2 mt-1.5">
							{onNavigateToWorkspace && (
								<button
									onClick={() => onNavigateToWorkspace(fileWorkspace.id)}
									className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline"
								>
									<ExternalLink size={10} />
									Workspace detail
								</button>
							)}
							{onNavigateToLogs && (
								<button
									onClick={() => onNavigateToLogs(fileWorkspace.id)}
									className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:underline"
								>
									<Terminal size={10} />
									View logs
								</button>
							)}
						</div>
					</div>
				) : (
					<p className="text-xs text-stone-400">No workspace data available</p>
				)}
			</div>

			{/* Section: Related Command */}
			<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-2.5">
				<div className="flex items-center gap-1.5 mb-1.5">
					<Terminal size={12} className="text-stone-400" />
					<span className="font-medium text-stone-800 dark:text-stone-200">Related Commands</span>
				</div>
				{commands && commands.length > 0 ? (
					<div className="space-y-1.5">
						{/* Last command */}
						{lastCommand && (
							<div className="flex items-start gap-1.5">
								<span
									className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
										lastCommand.exitCode === 0
											? "bg-emerald-400"
											: lastCommand.exitCode !== null
												? "bg-red-400"
												: "bg-amber-400"
									}`}
								/>
								<div className="min-w-0 flex-1">
									<code className="text-xs font-mono text-stone-800 dark:text-stone-200 block truncate">
										{lastCommand.command}
									</code>
									<div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
										<span>exit: {lastCommand.exitCode ?? "running"}</span>
										{lastCommand.isTargetCommand && (
											<span className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs">
												target
											</span>
										)}
									</div>
								</div>
							</div>
						)}
						{/* Target commands count */}
						{targetCommands.length > 0 && (
							<p className="text-xs text-stone-400">
								{targetCommands.length} target/validation command{targetCommands.length !== 1 ? "s" : ""} in this
								workspace
							</p>
						)}
						{/* All commands count */}
						<p className="text-xs text-stone-400">
							{commands.length} total command{commands.length !== 1 ? "s" : ""} executed
						</p>
					</div>
				) : (
					<p className="text-xs text-stone-400">No command history available</p>
				)}
			</div>

			{/* Section: Related Validation */}
			<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-2.5">
				<div className="flex items-center gap-1.5 mb-1.5">
					{validation?.passed === true ? (
						<CheckCircle size={12} className="text-emerald-400" />
					) : validation?.blocked ? (
						<XCircle size={12} className="text-red-400" />
					) : (
						<AlertTriangle size={12} className="text-amber-400" />
					)}
					<span className="font-medium text-stone-800 dark:text-stone-200">Validation</span>
				</div>
				{validation ? (
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span
								className={`text-xs px-1.5 py-0.5 rounded ${
									validation.passed === true
										? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
										: validation.blocked
											? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
											: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
								}`}
							>
								{validation.passed === true
									? "Passed"
									: validation.blocked
										? "Blocked"
										: validation.passed === false
											? "Failed"
											: "Pending"}
							</span>
							{!validation.required && (
								<span className="text-xs text-stone-400">Not required</span>
							)}
						</div>
						{validation.blockReasons.length > 0 && (
							<div className="mt-1">
								{validation.blockReasons.map((reason, idx) => (
									<p key={idx} className="text-xs text-red-500 truncate" title={reason}>
										{reason}
									</p>
								))}
							</div>
						)}
					</div>
				) : (
					<p className="text-xs text-stone-400">No validation data available</p>
				)}
			</div>

			{/* Section: File Metadata */}
			{fileEntry && (
				<div className="border border-[#E8E6E1] dark:border-[#333] rounded p-2.5">
					<div className="flex items-center gap-1.5 mb-1.5">
						<FileText size={12} className="text-stone-400" />
						<span className="font-medium text-stone-800 dark:text-stone-200">File Metadata</span>
					</div>
					<div className="space-y-0.5 text-xs">
						<div className="flex justify-between">
							<span className="text-stone-400">Status</span>
							<span
								className={`${
									fileEntry.status === "added"
										? "text-emerald-600 dark:text-emerald-400"
										: fileEntry.status === "deleted"
											? "text-red-600 dark:text-red-400"
											: "text-amber-600 dark:text-amber-400"
								}`}
							>
								{fileEntry.status}
							</span>
						</div>
						{fileEntry.additions !== undefined && (
							<div className="flex justify-between">
								<span className="text-stone-400">Additions</span>
								<span className="text-emerald-600 dark:text-emerald-400">+{fileEntry.additions}</span>
							</div>
						)}
						{fileEntry.deletions !== undefined && (
							<div className="flex justify-between">
								<span className="text-stone-400">Deletions</span>
								<span className="text-red-600 dark:text-red-400">-{fileEntry.deletions}</span>
							</div>
						)}
						{fileEntry.size !== undefined && (
							<div className="flex justify-between">
								<span className="text-stone-400">Size</span>
								<span>{fileEntry.size.toLocaleString()} B</span>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusBadge({ stage }: { stage: string }) {
	const colors: Record<string, string> = {
		Pending: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
		Running: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
		Complete: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
		Failed: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
		Blocked: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
		Cancelled: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
		Skipped: "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400",
	};
	const color = colors[stage] ?? colors.Pending;

	return (
		<span className={`text-xs px-1.5 py-0.5 rounded ${color}`}>
			{stage}
		</span>
	);
}
