/**
 * FileExplorer — P22.D File Explorer for Live Worktrees
 *
 * Tree view of worktree files with directory navigation, file content preview,
 * diff view, and auto-refresh polling. Designed for monitoring files being
 * written during active workspace execution.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronRight,
	ChevronDown,
	File,
	FileText,
	Folder,
	FolderOpen,
	GitBranch,
	GitCommit,
	Plus,
	Minus,
	RefreshCw,
	Search,
	X,
	Loader2,
	AlertTriangle,
	FileCode,
	FileJson,
	FileType,
	Image,
	Terminal,
	Diff,
} from "lucide-react";
import {
	useWorktreeFiles,
	type DiffResult,
	type DiffFileChange,
	type FileContentResult,
	type FileEntry,
	type WorktreeEntry,
} from "../hooks/useWorktreeFiles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileExplorerProps {
	projectId: string;
	planExecId: string;
	/** Optional initial workspace ID to select */
	initialWorkspaceId?: string;
	/** Callback when a file is selected */
	onFileSelect?: (path: string, workspaceId: string) => void;
	/** Height of the component (default: "100%") */
	height?: string;
	/** Whether to show the diff tab by default */
	showDiffByDefault?: boolean;
}

type ViewTab = "files" | "diff" | "preview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get a display icon for a file based on its extension.
 */
function FileIcon({ ext, isDir, isOpen }: { ext: string; isDir: boolean; isOpen?: boolean }) {
	if (isDir) {
		return isOpen ? <FolderOpen size={16} className="text-amber-400 shrink-0" /> : <Folder size={16} className="text-amber-400 shrink-0" />;
	}

	switch (ext) {
		case "ts":
		case "tsx":
			return <FileCode size={16} className="text-blue-400 shrink-0" />;
		case "js":
		case "jsx":
			return <FileCode size={16} className="text-yellow-400 shrink-0" />;
		case "json":
			return <FileJson size={16} className="text-green-400 shrink-0" />;
		case "md":
			return <FileText size={16} className="text-stone-400 dark:text-stone-500 shrink-0" />;
		case "css":
		case "scss":
		case "less":
			return <FileType size={16} className="text-pink-400 shrink-0" />;
		case "html":
			return <FileType size={16} className="text-orange-400 shrink-0" />;
		case "py":
			return <Terminal size={16} className="text-blue-300 shrink-0" />;
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
		case "ico":
			return <Image size={16} className="text-purple-400 shrink-0" />;
		default:
			return <File size={16} className="text-stone-400 dark:text-stone-500 shrink-0" />;
	}
}

/**
 * Format file size in human-readable format.
 */
function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Truncate a string to a maximum length.
 */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen) + "...";
}

/**
 * Diff status badge color and label.
 */
function diffStatusInfo(status: string): { label: string; color: string } {
	switch (status) {
		case "A":
			return { label: "added", color: "text-emerald-500 bg-emerald-500/10" };
		case "M":
			return { label: "modified", color: "text-blue-400 bg-blue-400/10" };
		case "D":
			return { label: "deleted", color: "text-red-400 bg-red-400/10" };
		case "R":
			return { label: "renamed", color: "text-purple-400 bg-purple-400/10" };
		default:
			return { label: status, color: "text-stone-400 dark:text-stone-500 bg-stone-400/10" };
	}
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

/**
 * Tree node for a single file or directory.
 */
function TreeNode({
	entry,
	depth,
	selectedFile,
	onSelect,
}: {
	entry: FileEntry;
	depth: number;
	selectedFile: string | null;
	onSelect: (path: string) => void;
}) {
	const [isOpen, setIsOpen] = React.useState(depth < 2); // Auto-open first two levels

	if (entry.isDir) {
		return (
			<div>
				<button
					type="button"
					className="flex items-center gap-1 px-1 py-0.5 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] rounded w-full text-left transition-colors"
					style={{ paddingLeft: `${depth * 16 + 4}px` }}
					onClick={() => setIsOpen(!isOpen)}
				>
					{isOpen ? (
						<ChevronDown size={14} className="text-stone-400 dark:text-stone-500 shrink-0" />
					) : (
						<ChevronRight size={14} className="text-stone-400 dark:text-stone-500 shrink-0" />
					)}
					<FileIcon ext="" isDir isOpen={isOpen} />
					<span className="text-sm text-stone-700 dark:text-stone-300 truncate">{entry.name}</span>
					{entry.children && (
						<span className="text-xs text-stone-400 dark:text-stone-500 ml-auto">
							{entry.children.filter((c) => !c.isDir).length} files
						</span>
					)}
				</button>
				{isOpen && entry.children && (
					<div>
						{entry.children.map((child) => (
							<TreeNode
								key={child.path}
								entry={child}
								depth={depth + 1}
								selectedFile={selectedFile}
								onSelect={onSelect}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	const isSelected = selectedFile === entry.path;

	return (
		<button
			type="button"
			className={`flex items-center gap-1 px-1 py-0.5 rounded w-full text-left transition-colors ${
				isSelected ? "bg-blue-500/20 text-blue-300" : "hover:bg-stone-100 dark:hover:bg-[#2A2A2A] text-stone-400 dark:text-stone-500"
			}`}
			style={{ paddingLeft: `${depth * 16 + 20}px` }}
			onClick={() => onSelect(entry.path)}
		>
			<FileIcon ext={entry.ext} isDir={false} />
			<span className="text-sm truncate flex-1">{entry.name}</span>
			<span className="text-xs text-stone-400 dark:text-stone-500">{formatSize(entry.size)}</span>
		</button>
	);
}

/**
 * File content preview with syntax highlighting (simple colorized version).
 */
function FilePreview({ content }: { content: FileContentResult }) {
	const [isWrapped, setIsWrapped] = useState(true);

	if (content.isBinary) {
		return (
			<div className="flex flex-col items-center justify-center h-full text-stone-400 dark:text-stone-500 gap-2">
				<Image size={32} />
				<p className="text-sm">Binary file: {content.name}</p>
				<p className="text-xs">{formatSize(content.size)}</p>
				{content.base64Content && content.ext === "svg" && (
					<div
						className="max-w-full max-h-96 overflow-auto"
						dangerouslySetInnerHTML={{
							__html: atob(content.base64Content),
						}}
					/>
				)}
			</div>
		);
	}

	const lines = content.content.split("\n");
	const lineCount = lines.length;

	return (
		<div className="h-full flex flex-col">
			{/* Toolbar */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#2A2A2A]">
				<div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
					<span className="font-medium text-stone-700 dark:text-stone-300">{content.name}</span>
					<span className="text-stone-400 dark:text-stone-500">|</span>
					<span>{lineCount} lines</span>
					<span>{formatSize(content.size)}</span>
					<span className="text-stone-400 dark:text-stone-500">|</span>
					<span className="text-stone-400 dark:text-stone-500">{content.language}</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className={`text-xs px-2 py-0.5 rounded ${
							isWrapped ? "bg-blue-50 dark:bg-blue-900/20 text-blue-500" : "hover:bg-stone-100 dark:hover:bg-[#2A2A2A] text-stone-400 dark:text-stone-500"
						}`}
						onClick={() => setIsWrapped(!isWrapped)}
					>
						Wrap
					</button>
					{content.truncated && (
						<span className="text-xs text-amber-500 flex items-center gap-1">
							<AlertTriangle size={10} />
							Truncated ({formatSize(content.size)})
						</span>
					)}
				</div>
			</div>

			{/* Source code */}
			<div className="flex-1 overflow-auto">
				<table className="w-full font-mono text-xs leading-relaxed">
					<tbody>
						{lines.slice(0, 5000).map((line, i) => (
							<tr key={i} className="hover:bg-stone-50 dark:bg-[#2A2A2A]">
								<td className="text-stone-400 dark:text-stone-500 text-right pr-4 select-none w-12 text-xs border-r border-[#E8E6E1] dark:border-[#333]">
									{i + 1}
								</td>
								<td
									className={`px-3 whitespace-pre ${isWrapped ? "" : "overflow-x-hidden text-ellipsis"}`}
								>
									{line || " "}
								</td>
							</tr>
						))}
						{lines.length > 5000 && (
							<tr>
								<td colSpan={2} className="text-center text-stone-400 dark:text-stone-500 py-2 text-xs">
									File truncated to first 5000 lines
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/**
 * Diff view showing changed files and unified diff content.
 */
function DiffView({
	diff,
	loading,
	onLoadDiff,
	onFileClick,
}: {
	diff: DiffResult | null;
	loading: boolean;
	onLoadDiff: () => void;
	onFileClick?: (path: string) => void;
}) {
	if (loading) {
		return (
			<div className="flex items-center justify-center h-32">
				<Loader2 size={20} className="animate-spin text-blue-400" />
				<span className="ml-2 text-sm text-stone-400 dark:text-stone-500">Loading diff...</span>
			</div>
		);
	}

	if (!diff) {
		return (
			<div className="flex flex-col items-center justify-center h-32 gap-2">
				<Diff size={20} className="text-stone-400 dark:text-stone-500" />
				<p className="text-sm text-stone-400 dark:text-stone-500">No diff data loaded</p>
				<button
					type="button"
					className="text-xs px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded hover:bg-blue-500/30 transition-colors"
					onClick={onLoadDiff}
				>
					Load diff
				</button>
			</div>
		);
	}

	if (diff.fileCount === 0) {
		return (
			<div className="flex flex-col items-center justify-center h-32 gap-1">
				<GitCommit size={20} className="text-emerald-500" />
				<p className="text-sm text-stone-400 dark:text-stone-500">No uncommitted changes</p>
				<p className="text-xs text-stone-400 dark:text-stone-500">Worktree is clean</p>
			</div>
		);
	}

	return (
		<div className="h-full flex flex-col">
			{/* Summary bar */}
			<div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#E8E6E1] dark:border-[#333] bg-white/5 text-xs">
				<span className="text-stone-400 dark:text-stone-500">
					{diff.fileCount} file{diff.fileCount !== 1 ? "s" : ""} changed
				</span>
				<span className="flex items-center gap-1 text-emerald-500">
					<Plus size={12} />
					{diff.totalAdditions}
				</span>
				<span className="flex items-center gap-1 text-red-400">
					<Minus size={12} />
					{diff.totalDeletions}
				</span>
			</div>

			{/* Changed files list */}
			<div className="flex-1 overflow-auto">
				<div className="p-2 space-y-0.5">
					{diff.filesChanged.map((file) => {
						const statusInfo = diffStatusInfo(file.status);
						return (
							<button
								key={file.path}
								type="button"
								className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-stone-100 dark:hover:bg-[#2A2A2A] text-left transition-colors"
								onClick={() => onFileClick?.(file.path)}
							>
								<span
									className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusInfo.color}`}
								>
									{statusInfo.label}
								</span>
								<span className="text-sm text-stone-700 dark:text-stone-300 truncate flex-1">{file.path}</span>
								<span className="text-xs text-emerald-500 font-mono">+{file.additions}</span>
								<span className="text-xs text-red-400 font-mono">-{file.deletions}</span>
							</button>
						);
					})}
				</div>

				{/* Full diff output */}
				{diff.diff && (
					<div className="border-t border-[#E8E6E1] dark:border-[#333] mt-2">
						<div className="px-3 py-1 text-xs text-stone-400 dark:text-stone-500 font-medium bg-stone-50 dark:bg-[#2A2A2A]">
							Unified diff
						</div>
						<pre className="text-xs font-mono p-3 overflow-auto max-h-96 text-stone-400 dark:text-stone-500 leading-relaxed whitespace-pre-wrap">
							{diff.diff.split("\n").slice(0, 500).map((line, i) => {
								let className = "";
								if (line.startsWith("+")) className = "text-emerald-500";
								else if (line.startsWith("-")) className = "text-red-400";
								else if (line.startsWith("@")) className = "text-cyan-400";
								else if (line.startsWith("diff --git")) className = "text-stone-400 dark:text-stone-500 font-bold";
								else if (line.startsWith("index")) className = "text-stone-400 dark:text-stone-500";
								else if (line.startsWith("---") || line.startsWith("+++")) className = "text-stone-400 dark:text-stone-500";
								return (
									<div key={i} className={className}>
										{line}
									</div>
								);
							})}
							{diff.diff.split("\n").length > 500 && (
								<div className="text-center text-stone-400 dark:text-stone-500 py-1">Diff truncated to 500 lines</div>
							)}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Worktree selector dropdown.
 */
function WorktreeSelector({
	worktrees,
	selected,
	onSelect,
}: {
	worktrees: WorktreeEntry[];
	selected: string | null;
	onSelect: (id: string) => void;
}) {
	if (worktrees.length === 0) {
		return (
			<div className="text-xs text-stone-400 dark:text-stone-500 px-3 py-2">
				No active worktrees
			</div>
		);
	}

	return (
		<div className="px-2 py-1.5 border-b border-[#E8E6E1] dark:border-[#333]">
			<label className="text-xs text-stone-400 dark:text-stone-500 font-semibold uppercase tracking-wider px-1 mb-1 block">
				Worktree
			</label>
			<div className="flex flex-wrap gap-1">
				{worktrees.map((wt) => (
					<button
						key={wt.workspaceId}
						type="button"
						className={`text-xs px-2 py-1 rounded transition-colors ${
							selected === wt.workspaceId
								? "bg-blue-50 dark:bg-blue-900/20 text-blue-500 border border-blue-200 dark:border-blue-800"
								: "bg-stone-50 dark:bg-stone-800/50 text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333]"
						}`}
						onClick={() => onSelect(wt.workspaceId)}
					>
						<GitBranch size={10} className="inline mr-1" />
						{wt.workspaceId}
						{wt.fileCount > 0 && (
							<span className="ml-1 text-xs text-stone-400 dark:text-stone-500">({wt.fileCount})</span>
						)}
					</button>
				))}
			</div>
		</div>
	);
}

/**
 * Filter bar for searching files.
 */
function FilterBar({
	query,
	onQueryChange,
	onClear,
}: {
	query: string;
	onQueryChange: (q: string) => void;
	onClear: () => void;
}) {
	return (
		<div className="relative px-2 py-1.5 border-b border-[#E8E6E1] dark:border-[#333]">
			<Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
			<input
				type="text"
				value={query}
				onChange={(e) => onQueryChange(e.target.value)}
				placeholder="Filter files..."
				className="w-full bg-stone-100 dark:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333] rounded-md text-xs px-6 py-1 text-stone-700 dark:text-stone-300 placeholder:text-stone-400 outline-none focus:border-blue-500/30 transition-colors"
			/>
			{query && (
				<button
					type="button"
					className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500 hover:text-stone-400 dark:text-stone-500"
					onClick={onClear}
				>
					<X size={12} />
				</button>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function FileExplorer({
	projectId,
	planExecId,
	initialWorkspaceId,
	onFileSelect,
	height = "100%",
	showDiffByDefault = false,
}: FileExplorerProps) {
	const [activeTab, setActiveTab] = useState<ViewTab>(showDiffByDefault ? "diff" : "files");
	const [filterQuery, setFilterQuery] = useState("");

	const {
		worktrees,
		selectedWorkspace,
		setSelectedWorkspace,
		files,
		fileContent,
		selectedFile,
		selectFile,
		diff,
		diffLoading,
		loadDiff,
		isLoading,
		error,
		refresh,
	} = useWorktreeFiles({
		projectId,
		planExecId,
	});

	// Set initial workspace
	useEffect(() => {
		if (initialWorkspaceId && worktrees.some((wt) => wt.workspaceId === initialWorkspaceId)) {
			setSelectedWorkspace(initialWorkspaceId);
		}
	}, [initialWorkspaceId, worktrees, setSelectedWorkspace]);

	// Filter files based on search query
	const filteredFiles = useMemo(() => {
		if (!filterQuery) return files;

		const q = filterQuery.toLowerCase();

		function filterTree(entries: FileEntry[]): FileEntry[] {
			return entries
				.map((entry) => {
					if (entry.isDir && entry.children) {
						const filteredChildren = filterTree(entry.children);
						if (filteredChildren.length > 0) {
							return { ...entry, children: filteredChildren };
						}
					}
					if (entry.name.toLowerCase().includes(q)) {
						return entry;
					}
					return null;
				})
				.filter((e): e is FileEntry => e !== null);
		}

		return filterTree(files);
	}, [files, filterQuery]);

	const handleFileSelect = useCallback(
		(path: string) => {
			selectFile(path);
			onFileSelect?.(path, selectedWorkspace ?? "");
		},
		[selectFile, onFileSelect, selectedWorkspace],
	);

	// Determine if the worktree is "live" (has any files being actively modified)
	const isLive = worktrees.length > 0 && worktrees.some((wt) => wt.fileCount > 0);

	// Tab labels
	const tabs: Array<{ id: ViewTab; label: string; icon: React.ReactNode }> = [
		{ id: "files", label: "Files", icon: <Folder size={12} /> },
		{ id: "diff", label: "Diff", icon: <Diff size={12} /> },
		{ id: "preview", label: "Preview", icon: <FileText size={12} /> },
	];

	return (
		<div
			className="flex flex-col bg-white dark:bg-[#1E1E1E] rounded-lg border border-[#E8E6E1] dark:border-[#333] overflow-hidden"
			style={{ height }}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#2A2A2A]">
				<div className="flex items-center gap-2">
					<FolderOpen size={14} className="text-amber-400" />
					<span className="text-xs font-medium text-stone-700 dark:text-stone-300">File Explorer</span>
					{isLive && (
						<span className="flex items-center gap-1 text-xs text-emerald-500">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
							Live
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
						onClick={refresh}
						title="Refresh"
					>
						<RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
					</button>
				</div>
			</div>

			{/* Worktree selector */}
			<WorktreeSelector
				worktrees={worktrees}
				selected={selectedWorkspace}
				onSelect={setSelectedWorkspace}
			/>

			{/* Tab bar */}
			<div className="flex border-b border-[#E8E6E1] dark:border-[#333]">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
							activeTab === tab.id
								? "text-blue-500 border-b-2 border-blue-500 bg-blue-50 dark:bg-blue-900/10"
								: "text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
						}`}
						onClick={() => setActiveTab(tab.id)}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{/* Error banner */}
			{error && (
				<div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
					<AlertTriangle size={10} />
					{error}
				</div>
			)}

			{/* Content area */}
			<div className="flex-1 overflow-hidden">
				{!selectedWorkspace ? (
					<div className="flex flex-col items-center justify-center h-full gap-1">
						<Folder size={24} className="text-stone-300 dark:text-stone-600" />
						<p className="text-xs text-stone-400 dark:text-stone-500">No worktree selected</p>
						{worktrees.length === 0 && (
							<p className="text-xs text-stone-400 dark:text-stone-500">
								No active worktrees found for this plan execution
							</p>
						)}
					</div>
				) : activeTab === "files" ? (
					<div className="h-full flex flex-col">
						<FilterBar
							query={filterQuery}
							onQueryChange={setFilterQuery}
							onClear={() => setFilterQuery("")}
						/>
						<div className="flex-1 overflow-auto p-1">
							{filteredFiles.length === 0 ? (
								<div className="flex flex-col items-center justify-center h-full gap-1">
									{filterQuery ? (
										<>
											<Search size={20} className="text-stone-300 dark:text-stone-600" />
											<p className="text-xs text-stone-400 dark:text-stone-500">No files match &quot;{filterQuery}&quot;</p>
										</>
									) : (
										<>
											<Folder size={24} className="text-stone-300 dark:text-stone-600" />
											<p className="text-xs text-stone-400 dark:text-stone-500">Empty worktree</p>
										</>
									)}
								</div>
							) : (
								<div>
									<div className="text-xs text-stone-400 dark:text-stone-500 px-2 py-1">
										{filterQuery
											? `Filtered: ${countFiles(filteredFiles)} files`
											: `${countFiles(filteredFiles)} files`}
									</div>
									{filteredFiles.map((entry) => (
										<TreeNode
											key={entry.path}
											entry={entry}
											depth={0}
											selectedFile={selectedFile}
											onSelect={handleFileSelect}
										/>
									))}
								</div>
							)}
						</div>
					</div>
				) : activeTab === "diff" ? (
					<DiffView
						diff={diff}
						loading={diffLoading}
						onLoadDiff={loadDiff}
						onFileClick={(path) => {
							setActiveTab("preview");
							selectFile(path);
						}}
					/>
				) : (
					/* Preview tab */
					<div className="h-full">
						{fileContent ? (
							<FilePreview content={fileContent} />
						) : (
							<div className="flex flex-col items-center justify-center h-full gap-1">
								<FileText size={24} className="text-stone-300 dark:text-stone-600" />
								<p className="text-xs text-stone-400 dark:text-stone-500">Select a file to preview</p>
								<p className="text-xs text-stone-400 dark:text-stone-500">
									Click a file in the Files tab to view its contents
								</p>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Status bar */}
			<div className="flex items-center justify-between px-3 py-1 border-t border-[#E8E6E1] dark:border-[#333] bg-stone-100 dark:bg-[#2A2A2A] text-xs text-stone-400 dark:text-stone-500">
				<div className="flex items-center gap-2">
					<span>
						{worktrees.length} worktree{worktrees.length !== 1 ? "s" : ""}
					</span>
					{selectedWorkspace && (
						<>
							<span className="text-stone-300 dark:text-stone-600">|</span>
							<span>WS: {selectedWorkspace}</span>
						</>
					)}
				</div>
				<div className="flex items-center gap-2">
					{diff && diff.fileCount > 0 && (
						<span className="text-amber-500">
							{diff.fileCount} changed
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(entries: FileEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.isDir && entry.children) {
			count += countFiles(entry.children);
		} else {
			count++;
		}
	}
	return count;
}
