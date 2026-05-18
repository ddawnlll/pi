/**
 * ApiBridge
 *
 * Bridges extension API calls with permission-gated file access and
 * full audit logging. Provides a safe readFile() that prevents path
 * traversal outside the workspace.
 *
 * Every API call is recorded in the audit log with timestamp, method,
 * arguments, result, and duration for observability and compliance.
 */

import { readFile as fsReadFile } from "node:fs/promises";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

/** A single audit log entry recording an API call. */
export interface AuditEntry {
	/** ISO-8601 timestamp when the call started. */
	timestamp: string;
	/** The API method that was called (e.g. "readFile"). */
	method: string;
	/** Arguments passed to the method. */
	args: unknown[];
	/** The result of the call (success indicator or error details). */
	result: { success: boolean; error?: string } | unknown;
	/** Duration of the call in milliseconds. */
	durationMs: number;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when a bridge API call is denied due to insufficient
 * permissions (e.g. path traversal outside the workspace).
 */
export class ApiBridgePermissionError extends Error {
	/** The permission identifier that was denied. */
	public readonly permission: string;

	constructor(permission: string, message: string) {
		super(message);
		this.name = "ApiBridgePermissionError";
		this.permission = permission;
	}
}

// ============================================================================
// Options
// ============================================================================

/** Options for constructing an ApiBridge. */
export interface ApiBridgeOptions {
	/**
	 * The workspace root directory. All file paths are resolved relative
	 * to this directory and must stay within it.
	 */
	basePath: string;

	/**
	 * Custom readFile function for testing. Defaults to fs.promises.readFile.
	 */
	readFile?: (filePath: string) => Promise<Buffer>;
}

// ============================================================================
// ApiBridge
// ============================================================================

/**
 * Bridges extension API access with permission checking and audit logging.
 *
 * Provides:
 * - readFile() with path traversal protection
 * - Full audit trail of all API calls
 *
 * @example
 * ```typescript
 * const bridge = new ApiBridge({ basePath: "/workspace" });
 *
 * // Allowed - reads a file within the workspace
 * const content = await bridge.readFile("src/index.ts");
 *
 * // Denied - path traversal outside workspace
 * await bridge.readFile("../.env"); // throws ApiBridgePermissionError
 *
 * // Inspect audit log
 * console.log(bridge.auditLog);
 * ```
 */
export class ApiBridge {
	private readonly auditLog_: AuditEntry[] = [];
	private readonly allowedBase: string;
	private readonly readFileFn: (filePath: string) => Promise<Buffer>;

	constructor(options: ApiBridgeOptions) {
		this.allowedBase = path.resolve(options.basePath);
		this.readFileFn = options.readFile ?? ((filePath: string) => fsReadFile(filePath));
	}

	// -----------------------------------------------------------------------
	// Audit Log
	// -----------------------------------------------------------------------

	/**
	 * Returns a read-only snapshot of the audit log.
	 *
	 * Every API call made through this bridge is recorded in the log with:
	 * - ISO-8601 timestamp
	 * - Method name
	 * - Arguments
	 * - Result (success or error)
	 * - Duration in milliseconds
	 */
	get auditLog(): readonly AuditEntry[] {
		return this.auditLog_;
	}

	// -----------------------------------------------------------------------
	// API Methods
	// -----------------------------------------------------------------------

	/**
	 * Read a file within the workspace.
	 *
	 * The file path is resolved relative to the workspace root (basePath).
	 * If the resolved path falls outside the workspace, an
	 * ApiBridgePermissionError is thrown.
	 *
	 * @param relativePath - Path relative to the workspace root
	 * @returns The file contents as a UTF-8 string
	 * @throws {ApiBridgePermissionError} If the path resolves outside the workspace
	 * @throws {Error} If the file cannot be read (e.g. does not exist)
	 */
	async readFile(relativePath: string): Promise<string> {
		return this.trackAsync("readFile", [relativePath], async () => {
			// Resolve the requested path relative to the workspace root
			const resolvedPath = path.resolve(this.allowedBase, relativePath);

			// Check path traversal: the resolved path must be within the allowed base
			// We append path.sep to the base to prevent prefix attacks
			// (e.g. base="/workspace", resolved="/workspace-extra/file")
			const baseWithSep = this.allowedBase.endsWith(path.sep) ? this.allowedBase : this.allowedBase + path.sep;

			if (resolvedPath !== this.allowedBase && !resolvedPath.startsWith(baseWithSep)) {
				throw new ApiBridgePermissionError(
					"filesystem",
					`readFile '${relativePath}': permission denied - path resolves outside workspace`,
				);
			}

			// Read the file
			const buffer = await this.readFileFn(resolvedPath);
			return buffer.toString("utf-8");
		});
	}

	// -----------------------------------------------------------------------
	// Internal - Audit Tracking
	// -----------------------------------------------------------------------

	/**
	 * Wraps an async operation with audit logging.
	 *
	 * Records the method name, arguments, result, and duration in the
	 * audit log. If the operation throws, the error is captured in the
	 * audit entry before re-throwing.
	 */
	private async trackAsync<T>(method: string, args: unknown[], fn: () => Promise<T>): Promise<T> {
		const startTime = Date.now();
		const entry: AuditEntry = {
			timestamp: new Date().toISOString(),
			method,
			args,
			result: null,
			durationMs: 0,
		};

		try {
			const result = await fn();
			entry.result = { success: true };
			return result;
		} catch (error) {
			entry.result = {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
			throw error;
		} finally {
			entry.durationMs = Date.now() - startTime;
			this.auditLog_.push(entry);
		}
	}
}
