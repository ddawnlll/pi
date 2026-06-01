/**
 * ExecutionFileTree — P42.07 Execution-Aware File Tree
 *
 * Renders a hierarchical file tree from the read model, showing changed files
 * with execution status indicators (created/modified/deleted), last writer,
 * and links to related workspace/command/validation data.
 *
 * Unlike the legacy FileExplorer which reads filesystem directly,
 * this component consumes the ExecutionReadModel.getFileTree() API
 * and does not shell out to git or the filesystem from the UI.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
	ChevronRight,
	ChevronDown,
	File,
	FileCode,
	FileJson,
	FileText,
	FileType,
	Folder,
	FolderOpen,
	Image,
	Loader2,
	Plus,
	Minus,
	Terminal,
	AlertTriangle,
	ExternalLink,
	GitBranch,
} from "lucide-react";
import { useFileTree } from "../../hooks/useFileTree";
import { usePlanWorkspaces } from "../../hooks/usePlanWorkspaces";
import type { FileTreeNode as FileTreeNodeType, FileChangeStatus } from "../../hooks/useFileTree";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExecutionFileTreeProps {
	projectId: string | null;
	planExecId: string | null;
	/** Optional: filter to a specific workspace */
	workspaceId?: string | null;
	/** Called when a file is selected for preview/diff */
	onFileSelect?: (filePath: string, workspaceId: string) => void;
	/** Currently selected file path */
	selectedFilePath?: string;
	/** Height constraint */
	height?: string;
}

// ---------------------------------------------------------------------------
// Status color map
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<FileChangeStatus, { bg: string; text: string; label: string }> = {
	added: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-300", label: "added" },
	modified: {
		bg: "bg-amber-100 dark:bg-amber-900/30",
		text: "text-amber-700 dark:text-amber-300",
		label: "modified",
	},
	deleted: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "deleted" },
	renamed: {
		bg: "bg-blue-100 dark:bg-blue-900/30",
		text: "text-blue-700 dark:text-blue-300",
		label: "renamed",
	},
	copied: {
		bg: "bg-violet-100 dark:bg-violet-900/30",
		text: "text-violet-700 dark:text-violet-300",
		label: "copied",
	},
	unmerged: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-700 dark:text-red-300", label: "unmerged" },
};

// ---------------------------------------------------------------------------
// File icon helper
// ---------------------------------------------------------------------------

function FileIcon({ ext, isDir, isOpen }: { ext: string; isDir: boolean; isOpen?: boolean }) {
	if (isDir) {
		return isOpen ? (
			<FolderOpen size={16} className="text-amber-400 shrink-0" />
		) : (
			<Folder size={16} className="text-amber-400 shrink-0" />
		);
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
			return <FileText size={16} className="text-gray-400 shrink-0" />;
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
			return <File size={16} className="text-gray-500 shrink-0" />;
	}
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionFileTree({
	projectId,
	planExecId,
	workspaceId,
	onFileSelect,
	selectedFilePath,
	height = "100%",
}: ExecutionFileTreeProps) {
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [filter, setFilter] = useState("");

	// Fetch workspaces for the plan (to map files to workspaces)
	const { workspaces, isLoading: wsLoading } = usePlanWorkspaces({
		projectId,
		planExecId,
	});

	// Fetch file trees for all active workspaces if no specific workspaceId provided
	const workspaceIds = useMemo(() => {
		if (workspaceId) return [workspaceId];
		return workspaces.map((w) => w.id);
	}, [workspaceId, workspaces]);

	// Fetch file tree for the first/selected workspace
	const activeWorkspaceId = workspaceIds[0] ?? null;
	const { data: fileTree, isLoading: treeLoading } = useFileTree(projectId, planExecId, activeWorkspaceId, {
		flat: false,
		enabled: !!activeWorkspaceId,
	});

	const isLoading = wsLoading || treeLoading;

	// Auto-expand directories that contain the selected file
	useEffect(() => {
		if (!selectedFilePath || !fileTree) return;
		const parts = selectedFilePath.split("/");
		const dirs: string[] = [];
		for (let i = 1; i < parts.length; i++) {
			dirs.push(parts.slice(0, i).join("/"));
		}
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			for (const d of dirs) next.add(d);
			return next;
		});
	}, [selectedFilePath, fileTree]);

	// Filter tree by search text
	const filteredTree = useMemo(() => {
		if (!fileTree) return [];
		if (!filter.trim()) return fileTree;

		const q = filter.toLowerCase();
		const filterNodes = (nodes: FileTreeNodeType[]): FileTreeNodeType[] => {
			const result: FileTreeNodeType[] = [];
			for (const node of nodes) {
				const matches = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
				const filteredChildren = node.children ? filterNodes(node.children) : [];
				if (matches || filteredChildren.length > 0) {
					result.push({
						...node,
						children: matches ? node.children : filteredChildren,
					});
				}
			}
			return result;
		};
		return filterNodes(fileTree);
	}, [fileTree, filter]);

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	const handleFileClick = useCallback(
		(filePath: string) => {
			if (onFileSelect && activeWorkspaceId) {
				onFileSelect(filePath, activeWorkspaceId);
			}
		},
		[onFileSelect, activeWorkspaceId],
	);

	// Loading state
	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-stone-400 dark:text-stone-500">
				<Loader2 size={24} className="animate-spin mb-2" />
				<span className="text-xs">Loading file tree...</span>
			</div>
		);
	}

	// Empty state
	if (!filteredTree || filteredTree.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-stone-400 dark:text-stone-500">
				<GitBranch size={24} className="mb-2 opacity-50" />
				<p className="text-xs">No changed files detected for this execution</p>
				<p className="text-[10px] mt-1 opacity-50">Files will appear here once workspaces start writing changes</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full" style={{ height }}>
			{/* Search bar */}
			<div className="px-3 py-2 border-b border-[#E8E6E1] dark:border-[#333]">
				<input
					type="text"
					placeholder="Filter files..."
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					className="w-full bg-stone-100 dark:bg-[#1a1a1a] border border-[#E8E6E1] dark:border-[#333] rounded px-2 py-1 text-xs text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:border-stone-400 dark:focus:border-stone-500"
				/>
			</div>

			{/* Workspace selection info */}
			{workspaces.length > 1 && !workspaceId && (
				<div className="px-3 py-1.5 text-[10px] text-stone-400 dark:text-stone-500 border-b border-[#E8E6E1] dark:border-[#333]">
					Showing files from {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
					{activeWorkspaceId && (
						<span className="ml-1 text-stone-500 dark:text-stone-400">
							(active: {activeWorkspaceId.slice(0, 8)})
						</span>
					)}
				</div>
			)}

			{/* Tree */}
			<div className="flex-1 overflow-y-auto overflow-x-hidden">
				{filteredTree.map((node) => (
					<TreeNode
						key={node.path}
						node={node}
						depth={0}
						expandedDirs={expandedDirs}
						onToggle={toggleDir}
						onFileSelect={handleFileClick}
						selectedFilePath={selectedFilePath}
					/>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

interface TreeNodeProps {
	node: FileTreeNodeType;
	depth: number;
	expandedDirs: Set<string>;
	onToggle: (path: string) => void;
	onFileSelect: (path: string) => void;
	selectedFilePath?: string;
}

function TreeNode({ node, depth, expandedDirs, onToggle, onFileSelect, selectedFilePath }: TreeNodeProps) {
	const isExpanded = expandedDirs.has(node.path);
	const statusStyle = STATUS_COLORS[node.status] ?? STATUS_COLORS.modified;
	const isSelected = selectedFilePath === node.path;

	if (node.isDir) {
		const hasChildren = node.children && node.children.length > 0;
		return (
			<div>
				<button
					onClick={() => (hasChildren ? onToggle(node.path) : undefined)}
					className="w-full flex items-center gap-1.5 px-2 py-0.5 text-left hover:bg-stone-100 dark:hover:bg-[#1A1A1A] transition-colors"
					style={{ paddingLeft: `${depth * 16 + 8}px` }}
				>
					{hasChildren ? (
						isExpanded ? (
							<ChevronDown size={12} className="text-stone-400 shrink-0" />
						) : (
							<ChevronRight size={12} className="text-stone-400 shrink-0" />
						)
					) : (
						<span className="w-3 shrink-0" />
					)}
					<FileIcon ext={node.ext} isDir isOpen={isExpanded} />
					<span className="text-xs text-stone-700 dark:text-stone-300 truncate">{node.name}</span>
					{node.additions !== undefined && (
						<span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-auto shrink-0">
							+{node.additions}
						</span>
					)}
					{node.deletions !== undefined && (
						<span className="text-[10px] text-red-600 dark:text-red-400 shrink-0 ml-1">-{node.deletions}</span>
					)}
				</button>
				{isExpanded &&
					hasChildren &&
					node.children!.map((child) => (
						<TreeNode
							key={child.path}
							node={child}
							depth={depth + 1}
							expandedDirs={expandedDirs}
							onToggle={onToggle}
							onFileSelect={onFileSelect}
							selectedFilePath={selectedFilePath}
						/>
					))}
			</div>
		);
	}

	// File node
	return (
		<button
			onClick={() => onFileSelect(node.path)}
			className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-left hover:bg-stone-100 dark:hover:bg-[#1A1A1A] transition-colors ${
				isSelected ? "bg-blue-50 dark:bg-blue-900/20" : ""
			}`}
			style={{ paddingLeft: `${depth * 16 + 8}px` }}
		>
			<span className="w-3 shrink-0" />
			<FileIcon ext={node.ext} isDir={false} />
			<span className={`text-xs truncate ${isSelected ? "text-blue-700 dark:text-blue-300" : "text-stone-700 dark:text-stone-300"}`}>
				{node.name}
			</span>
			<span
				className={`text-[9px] px-1 py-0.5 rounded ml-auto shrink-0 ${statusStyle.bg} ${statusStyle.text}`}
				title={`Status: ${statusStyle.label}`}
			>
				{statusStyle.label}
			</span>
			{node.additions !== undefined && (
				<span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0 ml-1">+{node.additions}</span>
			)}
			{node.deletions !== undefined && (
				<span className="text-[10px] text-red-600 dark:text-red-400 shrink-0 ml-1">-{node.deletions}</span>
			)}
		</button>
	);
}
