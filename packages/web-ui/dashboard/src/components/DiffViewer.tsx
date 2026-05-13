import { useState } from "react";
import { ChevronDown, ChevronRight, FileCode } from "lucide-react";
import type { GitFilePatch } from "../types";

/**
 * Parse unified diff lines and return annotated segments for rendering.
 * Each segment has a type: "context" | "addition" | "deletion" | "header"
 */
function parseDiffLines(patch: string): { type: "context" | "addition" | "deletion" | "header"; text: string }[] {
	const lines = patch.split("\n");
	const parsed: { type: "context" | "addition" | "deletion" | "header"; text: string }[] = [];

	for (const line of lines) {
		if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
			parsed.push({ type: "header", text: line });
		} else if (line.startsWith("@@")) {
			parsed.push({ type: "header", text: line });
		} else if (line.startsWith("+")) {
			parsed.push({ type: "addition", text: line });
		} else if (line.startsWith("-")) {
			parsed.push({ type: "deletion", text: line });
		} else {
			parsed.push({ type: "context", text: line });
		}
	}

	return parsed;
}

interface DiffViewerProps {
	patches: GitFilePatch[];
	/** If true, show a "not available" message instead of empty state */
	pending?: boolean;
	pendingMessage?: string;
}

export function DiffViewer({ patches, pending = false, pendingMessage }: DiffViewerProps) {
	if (pending) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">{pendingMessage ?? "Diff will be available once the workspace completes"}</p>
			</div>
		);
	}

	if (patches.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">No file changes detected</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			{patches.map((filePatch) => (
				<DiffFile key={filePatch.path} filePatch={filePatch} />
			))}
		</div>
	);
}

function DiffFile({ filePatch }: { filePatch: GitFilePatch }) {
	const [collapsed, setCollapsed] = useState(false);
	const parsedLines = parseDiffLines(filePatch.patch);
	const addCount = parsedLines.filter((l) => l.type === "addition").length;
	const delCount = parsedLines.filter((l) => l.type === "deletion").length;

	return (
		<div className="border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
			{/* File header - clickable to collapse */}
			<button
				onClick={() => setCollapsed(!collapsed)}
				className="w-full flex items-center gap-2 px-3 py-2 bg-stone-100 dark:bg-[#222] hover:bg-stone-200 dark:hover:bg-[#2A2A2A] transition-colors text-left"
			>
				{collapsed ? <ChevronRight size={14} className="shrink-0 text-stone-400" /> : <ChevronDown size={14} className="shrink-0 text-stone-400" />}
				<span className="font-mono text-xs text-stone-700 dark:text-stone-300 truncate flex-1">{filePatch.path}</span>
				{addCount > 0 && <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono shrink-0">+{addCount}</span>}
				{delCount > 0 && <span className="text-xs text-red-600 dark:text-red-400 font-mono shrink-0">-{delCount}</span>}
				<StatusBadgeInline status={filePatch.status} />
			</button>

			{/* Diff content */}
			{!collapsed && (
				<div className="overflow-x-auto">
					{filePatch.truncated && (
						<div className="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-b border-[#E8E6E1] dark:border-[#333]">
							Diff truncated to 500 lines. {filePatch.truncatedLines} line{filePatch.truncatedLines !== 1 ? "s" : ""} omitted.
						</div>
					)}
					<div className="font-mono text-[11px] leading-[1.5]">
						{parsedLines.map((line, idx) => (
							<div
								key={idx}
								className={`whitespace-pre-wrap break-all px-3 ${
									line.type === "addition"
										? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
										: line.type === "deletion"
											? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
											: line.type === "header"
												? "bg-stone-50 dark:bg-[#161616] text-stone-500 dark:text-stone-400"
												: "text-stone-700 dark:text-stone-300"
								}`}
							>
								{line.text || "\u00A0"}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function StatusBadgeInline({ status }: { status: GitFilePatch["status"] }) {
	const colors: Record<string, string> = {
		added: "text-emerald-600 dark:text-emerald-400",
		modified: "text-amber-600 dark:text-amber-400",
		deleted: "text-red-600 dark:text-red-400",
		renamed: "text-blue-600 dark:text-blue-400",
		copied: "text-violet-600 dark:text-violet-400",
		unmerged: "text-orange-600 dark:text-orange-400",
	};
	return <span className={`text-[10px] uppercase tracking-wider font-medium shrink-0 ${colors[status] ?? "text-stone-500"}`}>{status}</span>;
}
