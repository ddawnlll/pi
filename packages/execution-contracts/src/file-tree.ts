/**
 * File Tree Utilities — P41.06 File Tree Read Model
 *
 * Utility functions for building and manipulating file tree structures
 * from file change entries. These are the standard way to convert a flat
 * list of changed files into a hierarchical tree for UI rendering.
 *
 * Usage:
 *   import { buildFileTreeFromEntries } from "@earendil-works/pi-execution-contracts";
 *
 *   const entries: ChangedFileEntry[] = [...];
 *   const tree = buildFileTreeFromEntries(entries);
 */

import type { ChangedFileEntry, FileTreeNode } from "./read-model.js";

// ---------------------------------------------------------------------------
// Build File Tree
// ---------------------------------------------------------------------------

/**
 * Build a hierarchical file tree from a flat list of file entries.
 * Directories are inferred from path segments.
 *
 * Sorting rules:
 * - Directories sort before files
 * - Entries within the same level sort alphabetically by path
 *
 * Directory statistics (additions/deletions) are aggregated from children.
 *
 * @param entries - Flat list of changed file entries
 * @returns Array of root-level tree nodes with nested children
 */
export function buildFileTreeFromEntries(entries: ChangedFileEntry[]): FileTreeNode[] {
	// Handle empty input
	if (entries.length === 0) return [];

	// Build a map of path → node for all directory entries
	const nodeMap = new Map<string, FileTreeNode>();
	const rootNodes: FileTreeNode[] = [];

	// First pass: create directory nodes from path segments
	for (const entry of entries) {
		const parts = entry.path.split("/");
		if (parts.length <= 1) continue; // File is at root level, no directory needed

		let accumulatedPath = "";
		for (let i = 0; i < parts.length - 1; i++) {
			const segment = parts[i];
			accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;
			if (!nodeMap.has(accumulatedPath)) {
				nodeMap.set(accumulatedPath, {
					path: accumulatedPath,
					name: segment,
					ext: "",
					status: "modified",
					isDir: true,
					additions: 0,
					deletions: 0,
					children: [],
				});
			}
		}
	}

	// Second pass: wire parent-child relationships for directories
	for (const [nodePath, node] of nodeMap) {
		const slashIdx = nodePath.lastIndexOf("/");
		if (slashIdx === -1) {
			rootNodes.push(node);
		} else {
			const parentPath = nodePath.slice(0, slashIdx);
			const parent = nodeMap.get(parentPath);
			if (parent?.children) {
				parent.children.push(node);
			} else {
				// Orphan directory — add to root
				rootNodes.push(node);
			}
		}
	}

	// Third pass: add file entries as leaf nodes
	for (const entry of entries) {
		const leaf: FileTreeNode = {
			path: entry.path,
			name: entry.name,
			ext: entry.ext,
			status: entry.status,
			isDir: false,
			additions: entry.additions,
			deletions: entry.deletions,
		};

		const slashIdx = entry.path.lastIndexOf("/");
		if (slashIdx === -1) {
			// File at root level
			rootNodes.push(leaf);
		} else {
			const parentPath = entry.path.slice(0, slashIdx);
			const parent = nodeMap.get(parentPath);
			if (parent?.children) {
				parent.children.push(leaf);
			} else {
				// Orphan file — add to root
				rootNodes.push(leaf);
			}
		}
	}

	// Sort: directories first, then files, alphabetical by path
	const sortNodes = (nodes: FileTreeNode[]) => {
		nodes.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.path.localeCompare(b.path);
		});
		for (const node of nodes) {
			if (node.children) {
				sortNodes(node.children);
			}
		}
	};

	sortNodes(rootNodes);

	// Aggregate directory statistics from children
	const aggregateDirStats = (node: FileTreeNode): void => {
		if (!node.isDir || !node.children) return;
		for (const child of node.children) {
			aggregateDirStats(child);
		}
		node.additions = node.children.reduce((sum, c) => sum + (c.additions ?? 0), 0);
		node.deletions = node.children.reduce((sum, c) => sum + (c.deletions ?? 0), 0);
	};

	for (const node of rootNodes) {
		aggregateDirStats(node);
	}

	return rootNodes;
}

// ---------------------------------------------------------------------------
// Flatten Tree
// ---------------------------------------------------------------------------

/**
 * Flatten a hierarchical file tree back into a flat list of file entries.
 * Directory nodes are omitted from the output; only leaf (file) nodes are
 * included.
 *
 * @param nodes - Hierarchical tree nodes
 * @returns Flat list of changed file entries (files only)
 */
export function flattenFileTree(nodes: FileTreeNode[]): ChangedFileEntry[] {
	const result: ChangedFileEntry[] = [];

	function walk(items: FileTreeNode[]) {
		for (const node of items) {
			if (!node.isDir) {
				result.push({
					path: node.path,
					name: node.name,
					ext: node.ext,
					status: node.status,
					additions: node.additions,
					deletions: node.deletions,
				});
			}
			if (node.children) {
				walk(node.children);
			}
		}
	}

	walk(nodes);
	return result;
}

// ---------------------------------------------------------------------------
// Parse File Extension
// ---------------------------------------------------------------------------

/**
 * Extract the lowercase file extension from a file path.
 * Returns an empty string for files with no extension.
 *
 * @param path - File path (e.g., "src/index.ts")
 * @returns Lowercase extension (e.g., "ts"), or "" if none
 */
export function getFileExt(path: string): string {
	const idx = path.lastIndexOf(".");
	if (idx === -1 || idx === path.length - 1) return "";
	return path.slice(idx + 1).toLowerCase();
}
