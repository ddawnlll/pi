/**
 * Artifact API Routes -- P5 Workstream 5.C
 *
 * Fastify route plugin that provides read-only access to the execution
 * archive under `.pi/executions/{planExecId}/`. These routes enforce
 * strict path sandboxes so the artifact browser can never read arbitrary
 * repo files -- only generated artifacts under the archive directory are
 * accessible.
 *
 * Endpoints:
 *   GET /api/artifacts/:planExecId                     List artifacts
 *   GET /api/artifacts/:planExecId/*                   Read artifact content
 */

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { isForbiddenPath, readArchiveArtifact } from "./execution-archive.js";
import { getWorkspaceRoot } from "./state-store-provider.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum artifact content returned in a single read (256 KB) */
const MAX_ARTIFACT_BYTES = 256 * 1024;

/**
 * Allowed artifact file extensions and filenames.
 * The browser will only show files that match these patterns,
 * preventing access to arbitrary files even if someone bypasses the API.
 */
const ALLOWED_EXTENSIONS = new Set([
	".md",
	".json",
	".ndjson",
	".patch",
	".log",
	".txt",
	".csv",
	".yaml",
	".yml",
	".toml",
]);

const ALLOWED_FILENAMES = new Set([
	"diff.patch",
	"packet.md",
	"raw.log",
	"original-plan.md",
	"parsed-contract.json",
	"doctor-report.json",
	"dry-run-report.json",
	"workspace-dag.json",
	"safety-policy.json",
	"commits.json",
	"tool-calls.ndjson",
	"events.ndjson",
	"decisions.ndjson",
	"narrative.ndjson",
	"audit.ndjson",
	"structured.ndjson",
	"files-touched.json",
	"reviewer-verdict.md",
	"final-summary.md",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file path is an allowed artifact type.
 *
 * @param filePath - Relative file path within the archive
 * @returns True if the file is allowed to be listed/read
 */
function isAllowedArtifact(filePath: string): boolean {
	// Always reject forbidden paths
	if (isForbiddenPath(filePath)) return false;

	const basename = filePath.split("/").pop() ?? "";
	if (ALLOWED_FILENAMES.has(basename)) return true;

	const ext = basename.includes(".") ? `.${basename.split(".").pop()!.toLowerCase()}` : "";
	return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Get execution archive directory for a plan execution.
 */
function getArchiveDir(workspaceRoot: string, planExecId: string): string {
	return join(workspaceRoot, ".pi", "executions", planExecId);
}

/**
 * Recursively list files under a directory, returning relative paths.
 */
async function listFilesRecursive(baseDir: string, subDir: string = ""): Promise<string[]> {
	const fullDir = subDir ? join(baseDir, subDir) : baseDir;
	if (!existsSync(fullDir)) return [];

	const entries = await readdir(fullDir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const relPath = subDir ? `${subDir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			const subFiles = await listFilesRecursive(baseDir, relPath);
			files.push(...subFiles);
		} else {
			files.push(relPath);
		}
	}

	return files;
}

/**
 * Check if a planExecId is valid (no path traversal).
 */
function isValidPlanExecId(id: string): boolean {
	return !id.includes("..") && !id.includes("/") && !id.includes("/");
}

/**
 * Validate that an artifact path is safe to access.
 * Returns the safe resolved absolute path, or null if the path is forbidden.
 */
function validateArtifactPath(workspaceRoot: string, planExecId: string, artifactPath: string): string | null {
	// Reject forbidden patterns
	if (isForbiddenPath(artifactPath)) return null;

	// Normalize the planExecId (no traversal)
	if (!isValidPlanExecId(planExecId)) return null;

	// Reject path traversal in artifact path
	if (artifactPath.startsWith("/") || artifactPath.includes("..")) return null;

	const archiveDir = resolve(getArchiveDir(workspaceRoot, planExecId));
	const fullPath = resolve(join(archiveDir, artifactPath));

	// Ensure resolved path is within archive
	if (!fullPath.startsWith(`${archiveDir}/`) && fullPath !== archiveDir) {
		return null;
	}

	// Ensure file type is allowed
	if (!isAllowedArtifact(artifactPath)) return null;

	return fullPath;
}

// ---------------------------------------------------------------------------
// Route Plugin
// ---------------------------------------------------------------------------

/**
 * Register artifact API routes on the Fastify instance.
 */
export async function registerArtifactRoutes(fastify: FastifyInstance): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();

	// -----------------------------------------------------------------------
	// GET /api/artifacts/:planExecId -- List artifacts for a plan execution
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string };
	}>("/api/artifacts/:planExecId", async (request, reply) => {
		const { planExecId } = request.params as { planExecId: string };

		// Validate planExecId
		if (!isValidPlanExecId(planExecId)) {
			return reply.code(400).send({ error: "Invalid plan execution ID" });
		}

		const archiveDir = getArchiveDir(workspaceRoot, planExecId);
		if (!existsSync(archiveDir)) {
			return reply.code(404).send({ error: "Execution archive not found", planExecId });
		}

		try {
			const allFiles = await listFilesRecursive(archiveDir);
			// Filter to only allowed artifact types
			const allowedFiles = allFiles.filter(isAllowedArtifact);

			// Get file metadata
			const artifacts = await Promise.all(
				allowedFiles.map(async (relPath) => {
					const fullPath = join(archiveDir, relPath);
					let size = 0;
					let modifiedAt: string | null = null;
					try {
						const s = await stat(fullPath);
						size = s.size;
						modifiedAt = s.mtime.toISOString();
					} catch {
						// skip stat errors
					}
					return {
						path: relPath,
						isDirectory: false,
						size,
						modifiedAt,
					};
				}),
			);

			return { planExecId, artifacts };
		} catch (error) {
			fastify.log.error({ error, planExecId }, "Failed to list artifacts");
			return reply.code(500).send({ error: "Failed to list artifacts" });
		}
	});

	// -----------------------------------------------------------------------
	// GET /api/artifacts/:planExecId/* -- Read artifact content
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; "*": string };
	}>("/api/artifacts/:planExecId/*", async (request, reply) => {
		const rawParams = request.params as Record<string, string>;
		const { planExecId } = rawParams;
		const artifactPath = rawParams["*"] ?? "";

		if (!artifactPath) {
			return reply.code(400).send({ error: "Artifact path is required" });
		}

		// Validate planExecId
		if (!isValidPlanExecId(planExecId)) {
			return reply.code(400).send({ error: "Invalid plan execution ID" });
		}

		const fullPath = validateArtifactPath(workspaceRoot, planExecId, artifactPath);
		if (fullPath === null) {
			return reply.code(403).send({ error: "Access denied: artifact path is not allowed" });
		}

		// Also confirm via the archive reader (defense in depth)
		const content = await readArchiveArtifact(workspaceRoot, planExecId, artifactPath);
		if (content === null) {
			return reply.code(404).send({ error: "Artifact not found", path: artifactPath });
		}

		const totalSize = Buffer.byteLength(content, "utf-8");
		const truncated = totalSize > MAX_ARTIFACT_BYTES;
		const returnedContent = truncated ? content.slice(0, MAX_ARTIFACT_BYTES) : content;

		return {
			path: artifactPath,
			content: returnedContent,
			totalSize,
			truncated,
			returnedSize: Buffer.byteLength(returnedContent, "utf-8"),
			maxBytes: MAX_ARTIFACT_BYTES,
		};
	});
}
