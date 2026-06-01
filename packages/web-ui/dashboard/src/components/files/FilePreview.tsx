/**
 * FilePreview — P42.07 File Content Preview
 *
 * Renders file content from the read model with syntax-aware formatting.
 * Falls back to the read model's file-content endpoint.
 */

import React, { useMemo } from "react";
import { FileCode, FileWarning, Loader2, ExternalLink } from "lucide-react";
import { useFileContent } from "../../hooks/useFileContent";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilePreviewProps {
	projectId: string | null;
	planExecId: string | null;
	workspaceId: string | null;
	filePath: string | null;
	/** Maximum lines to display */
	maxLines?: number;
	/** If true, show a pending state */
	pending?: boolean;
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function detectLanguage(ext: string): string {
	const langMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescriptreact",
		js: "javascript",
		jsx: "javascriptreact",
		json: "json",
		md: "markdown",
		css: "css",
		scss: "scss",
		less: "less",
		html: "html",
		py: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		h: "c",
		hpp: "cpp",
		sh: "bash",
		bash: "bash",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		xml: "xml",
		sql: "sql",
		graphql: "graphql",
		mjs: "javascript",
		cjs: "javascript",
		mts: "typescript",
		cts: "typescript",
		svelte: "svelte",
		vue: "vue",
	};
	return langMap[ext] || "plaintext";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilePreview({
	projectId,
	planExecId,
	workspaceId,
	filePath,
	maxLines = 1000,
	pending = false,
}: FilePreviewProps) {
	const { data: content, isLoading, error } = useFileContent(
		projectId,
		planExecId,
		workspaceId,
		filePath,
		!pending && !!projectId && !!planExecId && !!workspaceId && !!filePath,
	);

	const ext = useMemo(() => {
		if (!filePath) return "";
		const parts = filePath.split(".");
		return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
	}, [filePath]);

	const language = useMemo(() => detectLanguage(ext), [ext]);

	// No file selected
	if (!filePath) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs">Select a file to preview</p>
				<p className="text-[10px] mt-1 opacity-50">Click a file from the tree to view its content</p>
			</div>
		);
	}

	// Pending
	if (pending) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<Loader2 size={24} className="animate-spin mb-2" />
				<span className="text-xs">File content will be available once the workspace writes it</span>
			</div>
		);
	}

	// Loading
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<Loader2 size={24} className="animate-spin mb-2" />
				<span className="text-xs">Loading file content...</span>
			</div>
		);
	}

	// Error
	if (error) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-red-400">
				<FileWarning size={24} className="mb-2 opacity-50" />
				<p className="text-xs">Failed to load file content</p>
				<p className="text-[10px] mt-1 opacity-70">{(error as Error).message}</p>
			</div>
		);
	}

	// Not available
	if (!content) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileWarning size={24} className="mb-2 opacity-50" />
				<p className="text-xs">File content not available</p>
				<p className="text-[10px] mt-1 opacity-50">
					The file content could not be retrieved. It may not exist in the execution archive or worktree.
				</p>
			</div>
		);
	}

	// Binary file
	if (content.isBinary) {
		return (
			<div className="flex flex-col items-center justify-center py-8 text-stone-400 dark:text-stone-500">
				<FileCode size={24} className="mb-2 opacity-50" />
				<p className="text-xs font-mono">{filePath}</p>
				<p className="text-xs mt-1">Binary file</p>
				<p className="text-[10px] mt-0.5 opacity-50">{content.size.toLocaleString()} bytes</p>
			</div>
		);
	}

	// Render content
	const lines = content.content?.split("\n") ?? [];
	const displayedLines = lines.slice(0, maxLines);
	const truncated = content.truncated || lines.length > maxLines;

	return (
		<div className="flex flex-col h-full">
			{/* File info header */}
			<div className="flex items-center gap-2 px-3 py-1.5 bg-stone-100 dark:bg-[#222] border-b border-[#E8E6E1] dark:border-[#333] text-[11px] text-stone-500 dark:text-stone-400">
				<span className="font-mono text-stone-700 dark:text-stone-300 truncate">{filePath}</span>
				{language !== "plaintext" && (
					<span className="px-1.5 py-0.5 rounded bg-stone-200 dark:bg-[#333] text-[10px] shrink-0">
						{language}
					</span>
				)}
				<span className="shrink-0">{content.size.toLocaleString()} bytes</span>
			</div>

			{/* Truncation warning */}
			{truncated && (
				<div className="px-3 py-1 bg-amber-50 dark:bg-amber-950/30 border-b border-[#E8E6E1] dark:border-[#333] text-xs text-amber-600 dark:text-amber-400">
					File truncated (showing {displayedLines.length} of {lines.length} lines)
				</div>
			)}

			{/* File content */}
			<div className="flex-1 overflow-auto font-mono text-xs leading-[1.6]">
				<div className="flex">
					{/* Line numbers */}
					<div className="shrink-0 bg-stone-50 dark:bg-[#1A1A1A] border-r border-[#E8E6E1] dark:border-[#333] text-right select-none">
						{displayedLines.map((_, idx) => (
							<div
								key={idx}
								className="px-3 py-0 text-[10px] text-stone-300 dark:text-stone-600 leading-[1.6]"
							>
								{idx + 1}
							</div>
						))}
					</div>

					{/* Content */}
					<div className="flex-1 min-w-0">
						{displayedLines.map((line, idx) => (
							<div
								key={idx}
								className="px-3 py-0 whitespace-pre text-stone-700 dark:text-stone-300"
							>
								{line || " "}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
