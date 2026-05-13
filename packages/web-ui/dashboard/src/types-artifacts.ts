/**
 * Artifact Browser Types
 *
 * Types for the execution archive artifact browser UI.
 */

/** Artifact entry returned by the list endpoint */
export interface ArtifactEntry {
	/** Relative path within the execution directory */
	path: string;
	/** Whether this is a directory */
	isDirectory: boolean;
	/** File size in bytes (0 for directories) */
	size: number;
	/** ISO timestamp of last modification */
	modifiedAt: string | null;
}

/** Artifact tree node for the UI */
export interface ArtifactTreeNode {
	/** Display name */
	name: string;
	/** Relative path within the execution directory */
	path: string;
	/** Whether this is a directory */
	isDirectory: boolean;
	/** Child nodes (for directories) */
	children: ArtifactTreeNode[];
	/** File size in bytes */
	size: number;
	/** Whether the node is expanded in the tree UI */
	expanded?: boolean;
}

/** Artifact content response from the read endpoint */
export interface ArtifactContent {
	/** Relative path of the artifact */
	path: string;
	/** Content of the artifact (truncated if too large) */
	content: string;
	/** Total size of the artifact in bytes */
	totalSize: number;
	/** Whether the content was truncated */
	truncated: boolean;
	/** Number of bytes returned */
	returnedSize: number;
	/** Max bytes allowed per request */
	maxBytes: number;
}

/** Artifact list response from the list endpoint */
export interface ArtifactListResponse {
	/** Plan execution ID */
	planExecId: string;
	/** List of artifact entries */
	artifacts: ArtifactEntry[];
}
