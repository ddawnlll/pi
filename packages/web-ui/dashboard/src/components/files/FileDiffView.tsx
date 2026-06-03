/**
 * FileDiffView — P42.07 Unified Diff Viewer
 *
 * Renders unified diffs from the read model with syntax highlighting,
 * copy diff functionality, and patch download support.
 * Does NOT shell out to git from the UI; diffs come from the read model API.
 */

import React, { useMemo, useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Copy, Download, FileCode, Loader2 } from "lucide-react";
import { useFileDiff } from "../../hooks/useFileDiff";
import type { FileDiffView as FileDiffViewType } from "../../hooks/useFileDiff";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FileDiffViewProps {
	projectId: string | null;
	planExecId: string | null;
	workspaceId: string | null;
	/** Specific file to diff, or omit for all files */
	filePath?: string;
	/** Maximum lines of diff to show */
	maxDiffLines?: number;
	/** If true, show a pending/loading message */
	pending?: boolean;
	/** Custom pending message */
	pendingMessage?: string;
}

// ---------------------------------------------------------------------------
// Diff line parser
// ---------------------------------------------------------------------------

type DiffLineType = "context" | "addition" | "deletion" | "header";

interface ParsedDiffLine {
	type: DiffLineType;
	text: string;
}

function parseDiffLines(diff: string): ParsedDiffLine[] {
	return diff.split("\n").map((line) => {
		if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
			return { type: "header", text: line };
		}
		if (line.startsWith("@@")) {
			return { type: "header", text: line };
		}
		if (line.startsWith("+")) {
			return { type: "addition", text: line };
		}
		if (line.startsWith("-")) {
			return { type: "deletion", text: line };
		}
		return { type: "context", text: line };
	});
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileDiffView({
	projectId,
	planExecId,
	workspaceId,
	filePath,
	maxDiffLines = 500,
	pending = false,
	pendingMessage,
}: FileDiffViewProps) {
	const { data: diffs, isLoading, error } = useFileDiff(projectId, planExecId, workspaceId, {
		filePath,
		maxDiffLines,
		enabled: !pending && !!projectId && !!planExecId && !!workspaceId,
	});

	const [copiedFile, setCopiedFile] = useState<string | null>(null);

	const handleCopyDiff = useCallback(async (path: string, diff: string) => {
		try {
			await navigator.clipboard.writeText(diff);
			setCopiedFile(path);
			setTimeout(() => setCopiedFile(null), 2000);
		} catch {
			// Clipboard not available
		}
	}, []);

	const handleDownloadPatch = useCallback(
		(path: string, diff: string) => {
			const blob = new Blob([diff], { type: "text/plain" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			const safeName = path.replace(/\//g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
			a.download = `${safeName}.patch`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		},
		[],
	);

	// Pending state
	if (pending) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">{pendingMessage ?? "Diff will be available once the workspace completes"}</p>
			</div>
		);
	}

	// Loading state
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<Loader2 size={24} className="animate-spin mb-2" />
				<span className="text-xs">Loading diff...</span>
			</div>
		);
	}

	// Error state
	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-red-400">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">Failed to load diff</p>
				<p className="text-xs mt-1 opacity-70">{(error as Error).message}</p>
			</div>
		);
	}

	// No diffs available
	if (!diffs || diffs.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">No file changes to display</p>
				<p className="text-xs mt-1 opacity-50">
					Select a changed file from the tree to view its diff, or the diff may not yet be available
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{diffs.map((fileDiff) => (
				<DiffFileCard
					key={fileDiff.path}
					fileDiff={fileDiff}
					copied={copiedFile === fileDiff.path}
					onCopy={() => handleCopyDiff(fileDiff.path, fileDiff.diff)}
					onDownload={() => handleDownloadPatch(fileDiff.path, fileDiff.diff)}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// DiffFileCard
// ---------------------------------------------------------------------------

interface DiffFileCardProps {
	fileDiff: FileDiffViewType;
	copied: boolean;
	onCopy: () => void;
	onDownload: () => void;
}

function DiffFileCard({ fileDiff, copied, onCopy, onDownload }: DiffFileCardProps) {
	const [collapsed, setCollapsed] = useState(false);
	const parsedLines = useMemo(() => parseDiffLines(fileDiff.diff), [fileDiff.diff]);

	const addCount = fileDiff.additions;
	const delCount = fileDiff.deletions;

	return (
		<div className="border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
			{/* File header */}
			<div className="flex items-center gap-2 px-3 py-2 bg-stone-100 dark:bg-[#222] border-b border-[#E8E6E1] dark:border-[#333]">
				<button
					onClick={() => setCollapsed(!collapsed)}
					className="hover:bg-stone-200 dark:hover:bg-[#2A2A2A] rounded p-0.5 transition-colors"
				>
					{collapsed ? (
						<ChevronRight size={14} className="text-stone-400" />
					) : (
						<ChevronDown size={14} className="text-stone-400" />
					)}
				</button>
				<span className="font-mono text-xs text-stone-800 dark:text-stone-200 truncate flex-1">{fileDiff.path}</span>

				{addCount > 0 && (
					<span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono shrink-0">+{addCount}</span>
				)}
				{delCount > 0 && (
					<span className="text-xs text-red-600 dark:text-red-400 font-mono shrink-0">-{delCount}</span>
				)}

				{/* Status badge */}
				<span
					className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
						fileDiff.status === "added"
							? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
							: fileDiff.status === "deleted"
								? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
								: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
					}`}
				>
					{fileDiff.status}
				</span>

				{/* Actions */}
				<div className="flex items-center gap-1 shrink-0">
					<button
						onClick={onCopy}
						className="p-1 hover:bg-stone-200 dark:hover:bg-[#2A2A2A] rounded transition-colors"
						title="Copy diff"
					>
						{copied ? (
							<span className="text-xs text-emerald-600 dark:text-emerald-400">Copied</span>
						) : (
							<Copy size={12} className="text-stone-400" />
						)}
					</button>
					<button
						onClick={onDownload}
						className="p-1 hover:bg-stone-200 dark:hover:bg-[#2A2A2A] rounded transition-colors"
						title="Download patch"
					>
						<Download size={12} className="text-stone-400" />
					</button>
				</div>
			</div>

			{/* Truncation warning */}
			{fileDiff.truncated && (
				<div className="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-b border-[#E8E6E1] dark:border-[#333]">
					Diff truncated. Download patch for full content.
				</div>
			)}

			{/* Diff content */}
			{!collapsed && (
				<div className="overflow-x-auto">
					<div className="font-mono text-xs leading-[1.5]">
						{parsedLines.map((line, idx) => (
							<div
								key={idx}
								className={`whitespace-pre-wrap break-all px-3 ${
									line.type === "addition"
										? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
										: line.type === "deletion"
											? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
											: line.type === "header"
												? "bg-stone-50 dark:bg-[#1A1A1A] text-stone-400 dark:text-stone-500 font-semibold"
												: "text-stone-800 dark:text-stone-200"
								}`}
							>
								{line.text || " "}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
