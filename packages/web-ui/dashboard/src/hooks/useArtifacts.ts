/**
 * useArtifacts -- React hooks for the artifact browser (P5 Workstream 5.C).
 *
 * Provides hooks for listing and reading execution archive artifacts
 * via the `/api/artifacts/:planExecId` endpoints.
 */

import { useQuery } from "@tanstack/react-query";
import type { ArtifactEntry, ArtifactContent, ArtifactListResponse } from "../types-artifacts";

const API_BASE = "";

// ---------------------------------------------------------------------------
// List artifacts
// ---------------------------------------------------------------------------

/**
 * Fetch the artifact list for a plan execution.
 *
 * @param planExecId - Plan execution ID
 * @returns Artifact list response
 */
async function fetchArtifactList(planExecId: string): Promise<ArtifactListResponse> {
	const response = await fetch(`${API_BASE}/api/artifacts/${planExecId}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch artifacts: ${response.status}`);
	}
	return response.json();
}

/**
 * Hook to list artifacts for a plan execution.
 *
 * @param planExecId - Plan execution ID (null to disable)
 * @returns Query result with artifact entries
 */
export function useArtifactList(planExecId: string | null) {
	return useQuery<ArtifactListResponse>({
		queryKey: ["artifact-list", planExecId],
		queryFn: () => fetchArtifactList(planExecId!),
		enabled: !!planExecId,
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		staleTime: 10_000,
	});
}

// ---------------------------------------------------------------------------
// Read artifact content
// ---------------------------------------------------------------------------

/**
 * Fetch the content of a single artifact.
 *
 * @param planExecId - Plan execution ID
 * @param artifactPath - Relative path within the execution directory
 * @returns Artifact content response
 */
async function fetchArtifactContent(planExecId: string, artifactPath: string): Promise<ArtifactContent> {
	const encodedPath = encodeURIComponent(artifactPath);
	const response = await fetch(`${API_BASE}/api/artifacts/${planExecId}/${encodedPath}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch artifact: ${response.status}`);
	}
	return response.json();
}

/**
 * Hook to read a single artifact's content.
 *
 * @param planExecId - Plan execution ID (null to disable)
 * @param artifactPath - Relative artifact path (null to disable)
 * @returns Query result with artifact content
 */
export function useArtifactContent(planExecId: string | null, artifactPath: string | null) {
	return useQuery<ArtifactContent>({
		queryKey: ["artifact-content", planExecId, artifactPath],
		queryFn: () => fetchArtifactContent(planExecId!, artifactPath!),
		enabled: !!planExecId && !!artifactPath,
		staleTime: 60_000,
	});
}
