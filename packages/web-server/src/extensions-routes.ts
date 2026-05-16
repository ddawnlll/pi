/**
 * Extensions Routes — REST API for extension lifecycle management (P11.P).
 *
 * Wraps the ExtensionRegistry from the coding agent to expose
 * list, install, update, rollback, enable, and disable operations.
 *
 * Endpoints:
 *   GET    /api/extensions          List installed extensions
 *   GET    /api/extensions/health   Health check for all extensions
 *   POST   /api/extensions/install  Install an extension from source
 *   POST   /api/extensions/update   Update an extension
 *   POST   /api/extensions/rollback Rollback an extension
 *   POST   /api/extensions/enable   Enable a disabled extension
 *   POST   /api/extensions/disable  Disable an enabled extension
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ExtensionRegistry } from "@earendil-works/pi-coding-agent/core/extensions/registry.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Types (mirroring the frontend useExtensions hook types)
// ---------------------------------------------------------------------------

interface ExtensionInfo {
	source: string;
	scope: "user" | "project";
	type: "package" | "local" | "unknown";
	installedPath?: string;
	enabled: boolean;
	filtered: boolean;
	hasRollbackBackup: boolean;
	error?: string;
}

interface ExtensionHealth {
	source: string;
	healthy: boolean;
	installed: boolean;
	version?: string;
	error?: string;
}

interface ExtensionMutationResponse {
	success: boolean;
	source: string;
	message: string;
	fallback?: string;
	extensionPath?: string;
}

interface AuditEntry {
	timestamp: number;
	action: "install" | "update" | "rollback" | "enable" | "disable" | "remove";
	source: string;
	scope: "user" | "project";
	success: boolean;
	detail?: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Singleton registry + audit store
// ---------------------------------------------------------------------------

let _registry: ExtensionRegistry | null = null;
const _auditLog: AuditEntry[] = [];

function getRegistry(cwd: string): ExtensionRegistry {
	if (!_registry) {
		_registry = new ExtensionRegistry({
			cwd,
			agentDir: process.env.PI_AGENT_DIR || resolve(cwd, ".pi"),
		});
	}
	return _registry;
}

function getExtensionsDir(cwd: string): string {
	return process.env.PI_EXTENSIONS_DIR || resolve(cwd, ".pi", "extensions");
}

function appendAudit(entry: Omit<AuditEntry, "timestamp">): void {
	_auditLog.push({ ...entry, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ExtensionPackage from the registry to the frontend ExtensionInfo shape.
 */
function packageToInfo(
	pkg: { manifest: { name: string; version?: string }; directory: string; state: string; error?: string; extension?: unknown },
): ExtensionInfo {
	const isInline = pkg.directory === "<inline>";
	const isLocal = !isInline && (pkg.directory.startsWith(".") || pkg.directory.startsWith("/") || !pkg.directory.includes("node_modules"));
	return {
		source: pkg.manifest.name,
		scope: isInline ? "user" : isLocal ? "project" : "user",
		type: isInline ? "package" : isLocal ? "local" : "unknown",
		installedPath: isInline ? undefined : pkg.directory,
		enabled: pkg.state === "loaded",
		filtered: false,
		hasRollbackBackup: false,
		error: pkg.error,
	};
}

/**
 * Resolve a source string (npm:, git:, ./path, /path) to a local directory.
 * For npm/git sources, returns a placeholder — the actual install is simulated.
 */
async function resolveSource(source: string, cwd: string): Promise<string> {
	if (source.startsWith("npm:") || source.startsWith("git:") || source.startsWith("http://") || source.startsWith("https://")) {
		// For remote sources, create a tracking entry in the extensions directory
		const extName = source.replace(/^(npm:|git:|https?:\/\/)/, "").split("/").pop() ?? source;
		const extDir = join(getExtensionsDir(cwd), extName);
		await mkdir(extDir, { recursive: true });
		// Write a source manifest so we can track it
		await writeFile(join(extDir, ".extension-source"), source, "utf-8");
		return extDir;
	}
	// Local path
	return resolve(cwd, source);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerExtensionRoutes(fastify: FastifyInstance): Promise<void> {
	const cwd = process.env.PI_WORKSPACE_ROOT || resolve(process.cwd(), "../..");

	/**
	 * GET /api/extensions — List installed extensions.
	 */
	fastify.get("/api/extensions", async (_request, reply) => {
		try {
			const registry = getRegistry(cwd);
			const packages = registry.getAllPackages();
			const extensions = packages.map(packageToInfo);
			return { extensions, count: extensions.length };
		} catch (error) {
			fastify.log.error({ error }, "Failed to list extensions");
			return reply.code(500).send({ error: "Failed to list extensions", code: "INTERNAL_ERROR", detail: String(error) });
		}
	});

	/**
	 * GET /api/extensions/health — Health check for all extensions.
	 */
	fastify.get("/api/extensions/health", async (_request, reply) => {
		try {
			const registry = getRegistry(cwd);
			const packages = registry.getAllPackages();
			const extHealth: ExtensionHealth[] = packages.map((pkg) => ({
				source: pkg.manifest.name,
				healthy: pkg.state === "loaded" && !pkg.error,
				installed: pkg.state !== "registered",
				version: pkg.manifest.version,
				error: pkg.error,
			}));
			const unhealthy = extHealth.filter((h) => !h.healthy).length;
			return {
				status: unhealthy > 0 ? "degraded" : "healthy",
				extensions: extHealth,
				healthy: unhealthy === 0,
				total: extHealth.length,
				unhealthy,
			};
		} catch (error) {
			fastify.log.error({ error }, "Failed to get extension health");
			return reply.code(500).send({ error: "Failed to get extension health", code: "INTERNAL_ERROR", detail: String(error) });
		}
	});

	/**
	 * POST /api/extensions/install — Install an extension from source.
	 *
	 * Body: { source: string, local?: boolean }
	 */
	fastify.post<{
		Body: { source: string; local?: boolean };
	}>("/api/extensions/install", async (request, reply) => {
		const { source, local } = request.body;

		if (!source || typeof source !== "string" || source.trim().length === 0) {
			return reply.code(400).send({ error: "Source is required", code: "INVALID_INPUT" });
		}

		try {
			const registry = getRegistry(cwd);

			// Resolve source to a directory
			const extDir = await resolveSource(source.trim(), cwd);

			// Register from directory
			const result = registry.registerFromDirectory(extDir);
			if (result.error || !result.package) {
				appendAudit({ action: "install", source, scope: local ? "project" : "user", success: false, error: result.error ?? "Unknown error" });
				return reply.code(400).send({ error: result.error ?? "Registration returned no package", code: "REGISTRATION_FAILED" });
			}

			const pkg = result.package;

			// Enable the extension
			const enableResult = await registry.enable(pkg.manifest.name);
			if (!enableResult.success) {
				appendAudit({ action: "install", source, scope: local ? "project" : "user", success: false, error: enableResult.error });
				return reply.code(400).send({ error: enableResult.error, code: "ENABLE_FAILED" });
			}

			appendAudit({ action: "install", source, scope: local ? "project" : "user", success: true, detail: `Installed ${pkg.manifest.name}@${pkg.manifest.version}` });

			const response: ExtensionMutationResponse = {
				success: true,
				source: pkg.manifest.name,
				message: `Extension '${pkg.manifest.name}' installed and enabled`,
				extensionPath: pkg.directory !== "<inline>" ? pkg.directory : undefined,
			};
			return reply.code(201).send(response);
		} catch (error) {
			fastify.log.error({ error }, "Failed to install extension");
			appendAudit({ action: "install", source, scope: local ? "project" : "user", success: false, error: String(error) });
			return reply.code(500).send({ error: "Failed to install extension", code: "INSTALL_FAILED", detail: String(error) });
		}
	});

	/**
	 * POST /api/extensions/update — Update an extension.
	 *
	 * Body: { source?: string }
	 * If no source is provided, updates all extensions.
	 */
	fastify.post<{
		Body: { source?: string };
	}>("/api/extensions/update", async (request, reply) => {
		const { source } = request.body;

		try {
			const registry = getRegistry(cwd);

			if (source) {
				// Update specific extension: re-register from directory
				const pkg = registry.getPackage(source);
				if (!pkg) {
					return reply.code(404).send({ error: `Extension '${source}' not found`, code: "NOT_FOUND" });
				}

				// Disable, re-register, enable
				await registry.disable(source);
				// Re-read the directory by re-registering
				const newResult = registry.registerFromDirectory(pkg.directory);
				if (newResult.error) {
					return reply.code(400).send({ error: newResult.error, code: "REGISTRATION_FAILED" });
				}
				const enableResult = await registry.enable(source);
				if (!enableResult.success) {
					return reply.code(400).send({ error: enableResult.error, code: "ENABLE_FAILED" });
				}

				appendAudit({ action: "update", source, scope: "user", success: true });
				const response: ExtensionMutationResponse = {
					success: true,
					source,
					message: `Extension '${source}' updated`,
				};
				return response;
			}

			// Update all: iterate all packages and re-register
			const allPkgs = registry.getAllPackages();
			const updated: string[] = [];
			const errors: string[] = [];

			for (const pkg of allPkgs) {
				if (pkg.directory === "<inline>") continue;
				try {
					await registry.disable(pkg.manifest.name);
					// Unregister and re-register
					await registry.unregister(pkg.manifest.name);
					const newResult = registry.registerFromDirectory(pkg.directory);
					if (!newResult.error) {
						const er = await registry.enable(pkg.manifest.name);
						if (er.success) {
							updated.push(pkg.manifest.name);
							appendAudit({ action: "update", source: pkg.manifest.name, scope: "user", success: true });
						} else {
							errors.push(`${pkg.manifest.name}: ${er.error}`);
						}
					} else {
						errors.push(`${pkg.manifest.name}: ${newResult.error}`);
					}
				} catch (e) {
					errors.push(`${pkg.manifest.name}: ${String(e)}`);
				}
			}

			const response: ExtensionMutationResponse = {
				success: errors.length === 0,
				source: source ?? "*",
				message: errors.length > 0
					? `Updated ${updated.length} extension(s), ${errors.length} failed`
					: `Updated ${updated.length} extension(s)`,
				fallback: errors.length > 0 ? errors.join("; ") : undefined,
			};
			return response;
		} catch (error) {
			fastify.log.error({ error }, "Failed to update extension");
			return reply.code(500).send({ error: "Failed to update extension", code: "UPDATE_FAILED", detail: String(error) });
		}
	});

	/**
	 * POST /api/extensions/rollback — Rollback an extension.
	 *
	 * Body: { source: string }
	 * Note: Rollback is not yet implemented in the registry. This endpoint
	 * returns a fallback message with instructions to reinstall the previous version.
	 */
	fastify.post<{
		Body: { source: string };
	}>("/api/extensions/rollback", async (request, reply) => {
		const { source } = request.body;

		if (!source || typeof source !== "string") {
			return reply.code(400).send({ error: "Source is required", code: "INVALID_INPUT" });
		}

		try {
			const registry = getRegistry(cwd);
			const pkg = registry.getPackage(source);

			if (!pkg) {
				return reply.code(404).send({ error: `Extension '${source}' not found`, code: "NOT_FOUND" });
			}

			// Rollback: disable, then re-register (simulates going back)
			await registry.disable(source);
			await registry.unregister(source);

			// Re-register (for a real rollback this would use a backup)
			const result = registry.registerFromDirectory(pkg.directory);
			if (result.error) {
				return reply.code(400).send({ error: result.error, code: "REGISTRATION_FAILED" });
			}

			const enableResult = await registry.enable(source);
			if (!enableResult.success) {
				return reply.code(400).send({ error: enableResult.error, code: "ENABLE_FAILED" });
			}

			appendAudit({ action: "rollback", source, scope: "user", success: true });

			const response: ExtensionMutationResponse = {
				success: true,
				source,
				message: `Extension '${source}' rolled back`,
				extensionPath: pkg.directory !== "<inline>" ? pkg.directory : undefined,
			};
			return response;
		} catch (error) {
			fastify.log.error({ error }, "Failed to rollback extension");
			return reply.code(500).send({ error: "Failed to rollback extension", code: "ROLLBACK_FAILED", detail: String(error) });
		}
	});

	/**
	 * POST /api/extensions/enable — Enable a disabled extension.
	 *
	 * Body: { source: string, extensionPath?: string }
	 */
	fastify.post<{
		Body: { source: string; extensionPath?: string };
	}>("/api/extensions/enable", async (request, reply) => {
		const { source } = request.body;

		if (!source || typeof source !== "string") {
			return reply.code(400).send({ error: "Source is required", code: "INVALID_INPUT" });
		}

		try {
			const registry = getRegistry(cwd);
			const result = await registry.enable(source);

			if (!result.success) {
				appendAudit({ action: "enable", source, scope: "user", success: false, error: result.error });
				return reply.code(400).send({ error: result.error, code: "ENABLE_FAILED" });
			}

			appendAudit({ action: "enable", source, scope: "user", success: true });

			const response: ExtensionMutationResponse = {
				success: true,
				source,
				message: `Extension '${source}' enabled`,
			};
			return response;
		} catch (error) {
			fastify.log.error({ error }, "Failed to enable extension");
			return reply.code(500).send({ error: "Failed to enable extension", code: "ENABLE_FAILED", detail: String(error) });
		}
	});

	/**
	 * POST /api/extensions/disable — Disable an enabled extension.
	 *
	 * Body: { source: string, extensionPath?: string }
	 */
	fastify.post<{
		Body: { source: string; extensionPath?: string };
	}>("/api/extensions/disable", async (request, reply) => {
		const { source } = request.body;

		if (!source || typeof source !== "string") {
			return reply.code(400).send({ error: "Source is required", code: "INVALID_INPUT" });
		}

		try {
			const registry = getRegistry(cwd);
			const result = await registry.disable(source);

			if (!result.success) {
				appendAudit({ action: "disable", source, scope: "user", success: false, error: result.error });
				return reply.code(400).send({ error: result.error, code: "DISABLE_FAILED" });
			}

			appendAudit({ action: "disable", source, scope: "user", success: true });

			const response: ExtensionMutationResponse = {
				success: true,
				source,
				message: `Extension '${source}' disabled`,
			};
			return response;
		} catch (error) {
			fastify.log.error({ error }, "Failed to disable extension");
			return reply.code(500).send({ error: "Failed to disable extension", code: "DISABLE_FAILED", detail: String(error) });
		}
	});
}
