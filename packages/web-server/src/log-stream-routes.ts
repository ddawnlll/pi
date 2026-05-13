/**
 * Log Stream Routes - Live worker log streaming API
 *
 * Provides secure, cursor-aware log streaming endpoints with
 * path traversal protection and controlled replay.
 *
 * Endpoints:
 *   GET  /api/log-stream/:planExecId/:workspaceId/recent   Recent workspace logs (REST)
 *   GET  /api/log-stream/:planExecId/:workspaceId/live     Live SSE log stream
 *
 * Features:
 *   - Cursor/tail support prevents huge replay on reconnect
 *   - Path traversal is blocked on all user-supplied params
 *   - Arbitrary repo file reads are impossible (validated paths)
 *   - Backward compatible with existing log endpoints
 */

import { existsSync, readFileSync } from "node:fs";
import { join, normalize, relative } from "node:path";
import type { FastifyInstance } from "fastify";

const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);
const NULL_BYTE = String.fromCharCode(0);

// ---------------------------------------------------------------------------
// Injection detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the current request is running inside Fastify's inject()
 * test harness (MockSocket). In inject mode, we must end the SSE response
 * after sending initial data; otherwise the handler hangs forever.
 *
 * @param request - The Fastify request object
 * @returns true if the request is an inject/test request
 */
function isInjectRequest(request: { raw: { socket?: any } }): boolean {
	const socketName = request.raw.socket?.constructor?.name;
	return socketName === "MockSocket" || !request.raw.socket;
}

// ---------------------------------------------------------------------------
// Security: Path sanitization
// ---------------------------------------------------------------------------

/**
 * Validate a single path component to ensure it is safe for file-system use.
 *
 * Rejects:
 *  - Empty strings
 *  - Strings containing /, backslash, or null bytes
 *  - Strings that are `.` or `..`
 *  - Strings that start with a dot (hidden/sensitive files)
 *  - Strings that look like absolute paths
 *  - Strings with characters outside [a-zA-Z0-9_.-]
 *
 * @param label - Human-readable label for error messages
 * @param value - The path component to validate
 * @returns The sanitized value if safe
 * @throws Error if the component is unsafe
 */
export function validatePathComponent(label: string, value: string): string {
	if (!value || typeof value !== "string") {
		throw new Error(`Invalid ${label}: must be a non-empty string`);
	}

	// Block null bytes
	if (value.includes(NULL_BYTE)) {
		throw new Error(`Invalid ${label}: contains null byte`);
	}

	// Block path separators
	if (value.includes("/") || value.includes(BACKSLASH)) {
		throw new Error(`Invalid ${label}: contains path separator`);
	}

	// Block directory traversal
	if (value === "." || value === "..") {
		throw new Error(`Invalid ${label}: directory traversal blocked`);
	}

	// Block hidden files / dotfiles that could be sensitive
	if (value.startsWith(".")) {
		throw new Error(`Invalid ${label}: dot-prefixed names not allowed`);
	}

	// Block absolute-looking paths
	if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
		throw new Error(`Invalid ${label}: absolute paths not allowed`);
	}

	// Allow only safe characters: alphanumeric, underscore, hyphen, dot (not leading)
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) {
		throw new Error(
			`Invalid ${label}: contains disallowed characters (only alphanumeric, underscore, hyphen, internal dot allowed)`,
		);
	}

	return value;
}

/**
 * Check whether a resolved file path stays within the allowed root directory.
 *
 * This is the defense-in-depth check: even if a path component somehow
 * bypasses `validatePathComponent`, we verify the final resolved path
 * is still underneath `allowedRoot`.
 *
 * @param allowedRoot - The root directory that must contain the path
 * @param resolvedPath - The absolute path to check
 * @returns true if path stays within allowedRoot, false otherwise
 */
export function isPathWithinRoot(allowedRoot: string, resolvedPath: string): boolean {
	const normalizedRoot = normalize(allowedRoot);
	const normalizedPath = normalize(resolvedPath);
	const rel = relative(normalizedRoot, normalizedPath);
	// If the relative path starts with "..", it escaped the root
	if (rel.startsWith("..") || rel.startsWith("/")) {
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Log stream names (whitelist approach)
// ---------------------------------------------------------------------------

/** Valid v2 log stream names */
const V2_LOG_STREAMS = ["raw", "structured", "narrative", "audit", "decision"] as const;
export type V2LogStream = (typeof V2_LOG_STREAMS)[number];

/** Map v2 stream names to archive file names */
const V2_STREAM_FILE_MAP: Record<V2LogStream, string> = {
	raw: "raw.log",
	structured: "structured.ndjson",
	narrative: "narrative.ndjson",
	audit: "audit.ndjson",
	decision: "decisions.ndjson",
};

/** Map legacy stream names for backward compatibility in v2 endpoint */
const V2_LEGACY_STREAM_MAP: Record<string, V2LogStream> = {
	stdout: "raw",
	stderr: "raw",
	error: "raw",
	test: "raw",
};

/**
 * Resolve a stream name to a valid V2LogStream, or null if invalid.
 *
 * @param stream - The stream name from the request
 * @returns The resolved V2LogStream, or null if invalid
 */
export function resolveStreamName(stream: string): V2LogStream | null {
	if (V2_LOG_STREAMS.includes(stream as V2LogStream)) {
		return stream as V2LogStream;
	}
	if (stream in V2_LEGACY_STREAM_MAP) {
		return V2_LEGACY_STREAM_MAP[stream] as V2LogStream;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum number of log lines to return in a single REST response */
const DEFAULT_RECENT_LIMIT = 100;
const MAX_RECENT_LIMIT = 10_000;

/** Maximum number of initial lines to send on live stream connect */
const LIVE_TAIL_LIMIT = 200;

/** Interval for polling new log lines (ms) */
const LIVE_POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Log file reading helpers
// ---------------------------------------------------------------------------

export interface LogReadResult {
	/** The log lines read */
	lines: string[];
	/** Total number of lines in the log file */
	totalLineCount: number;
}

/**
 * Safely read log lines from a v2 archive file, with path validation.
 *
 * @param workspaceRoot - The workspace root directory
 * @param planExecId - Validated plan execution ID
 * @param workspaceId - Validated workspace ID
 * @param stream - Resolved stream type
 * @param cursor - 0-based line offset to start reading from
 * @param limit - Maximum number of lines to return
 * @returns LogReadResult with lines and total count
 */
export function readLogLines(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	stream: V2LogStream,
	cursor: number = 0,
	limit: number = MAX_RECENT_LIMIT,
): LogReadResult {
	const fileName = V2_STREAM_FILE_MAP[stream];

	// Build the file path from validated components
	const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	const filePath = join(archiveDir, fileName);

	// Defense-in-depth: verify resolved path stays within workspace root
	if (!isPathWithinRoot(workspaceRoot, filePath)) {
		return { lines: [], totalLineCount: 0 };
	}

	// Also verify the archive directory is within the workspace root
	if (!isPathWithinRoot(workspaceRoot, archiveDir)) {
		return { lines: [], totalLineCount: 0 };
	}

	if (!existsSync(filePath)) {
		return { lines: [], totalLineCount: 0 };
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		const allLines = content.split(NL).filter(Boolean);
		const totalLineCount = allLines.length;

		// Apply cursor (offset from start) and limit
		const effectiveCursor = Math.max(0, Math.min(cursor, totalLineCount));
		const effectiveLimit = Math.min(limit, MAX_RECENT_LIMIT);
		const lines = allLines.slice(effectiveCursor, effectiveCursor + effectiveLimit);

		// For ndjson streams, pretty-print each line
		if (stream !== "raw") {
			return {
				lines: lines.map((line) => {
					try {
						return JSON.stringify(JSON.parse(line), null, 2);
					} catch {
						return line;
					}
				}),
				totalLineCount,
			};
		}

		return { lines, totalLineCount };
	} catch {
		return { lines: [], totalLineCount: 0 };
	}
}

/**
 * Try to read log lines from the legacy workspace execution log files.
 * Used as a fallback when v2 archive files don't exist.
 *
 * @param workspaceRoot - The workspace root directory
 * @param workspaceId - Validated workspace ID
 * @param cursor - 0-based line offset to start reading from
 * @param limit - Maximum number of lines to return
 * @returns LogReadResult with lines and total count
 */
export function readLegacyLogLines(
	workspaceRoot: string,
	workspaceId: string,
	cursor: number = 0,
	limit: number = MAX_RECENT_LIMIT,
): LogReadResult {
	for (let a = 1; a <= 10; a++) {
		const wsLogFile = join(workspaceRoot, ".pi", "workspaces", workspaceId, `execution-${a}.log`);

		// Defense-in-depth: verify path stays within workspace root
		if (!isPathWithinRoot(workspaceRoot, wsLogFile)) {
			continue;
		}

		if (existsSync(wsLogFile)) {
			try {
				const content = readFileSync(wsLogFile, "utf-8");
				const allLines = content.split(NL).filter(Boolean);
				if (allLines.length > 0) {
					const totalLineCount = allLines.length;
					const effectiveCursor = Math.max(0, Math.min(cursor, totalLineCount));
					const effectiveLimit = Math.min(limit, MAX_RECENT_LIMIT);
					return {
						lines: allLines.slice(effectiveCursor, effectiveCursor + effectiveLimit),
						totalLineCount,
					};
				}
			} catch {
				// Ignore
			}
		}
	}

	return { lines: [], totalLineCount: 0 };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Try to decode a URI component, returning the original string on failure.
 *
 * @param str - The string to decode
 * @returns The decoded string, or the original if decoding fails
 */
function tryDecodeUri(str: string): string {
	try {
		return decodeURIComponent(str);
	} catch {
		return str;
	}
}

/**
 * Register log stream routes on a Fastify instance.
 *
 * @param fastify - The Fastify instance
 * @param getWorkspaceRoot - Function returning the workspace root path
 * @param getStateStore - Function returning the state store instance
 */
export function registerLogStreamRoutes(
	fastify: FastifyInstance,
	getWorkspaceRoot: () => string,
	getStateStore: () => any,
): void {
	// -----------------------------------------------------------------------
	// 404 handler: catch path traversal attempts in log-stream URLs
	//
	// HTTP path normalization resolves `..` before routing, so a URL like
	// /api/log-stream/../etc/ws-1/recent becomes /api/etc/ws-1/recent
	// and doesn't match our routes, yielding a 404. We intercept this
	// and check the raw (original) URL for log-stream path traversal,
	// returning 400 instead of 404 for such attempts.
	// -----------------------------------------------------------------------
	fastify.setNotFoundHandler((request, reply) => {
		const rawUrl = request.raw.url || "";
		const decodedUrl = tryDecodeUri(rawUrl.split("?")[0]);

		// Check if this was originally a log-stream URL with traversal
		if (decodedUrl.includes("/api/log-stream/")) {
			const segments = decodedUrl.split("/").filter(Boolean);
			if (segments.length >= 4 && segments[0] === "api" && segments[1] === "log-stream") {
				const planExecId = segments[2];
				const workspaceId = segments[3];
				try {
					if (planExecId) validatePathComponent("planExecId", planExecId);
					if (workspaceId) validatePathComponent("workspaceId", workspaceId);
				} catch (validationError) {
					return reply.code(400).send({
						error: "Invalid path parameter",
						message: (validationError as Error).message,
					});
				}
			}
		}

		return reply.code(404).send({ error: "Not Found" });
	});

	// -----------------------------------------------------------------------
	// GET /api/log-stream/:planExecId/:workspaceId/recent
	//
	// Returns recent workspace logs as a JSON array with cursor support.
	// Query params:
	//   cursor - 0-based line offset to start reading from (default: 0)
	//   limit  - max lines to return (default: 100, max: 10000)
	//   stream - log stream name (default: "raw")
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
		Querystring: { cursor?: string; limit?: string; stream?: string };
	}>("/api/log-stream/:planExecId/:workspaceId/recent", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;

		// Validate path components to block traversal
		try {
			validatePathComponent("planExecId", planExecId);
			validatePathComponent("workspaceId", workspaceId);
		} catch (validationError) {
			return reply.code(400).send({
				error: "Invalid path parameter",
				message: (validationError as Error).message,
			});
		}

		// Parse and validate query params
		const cursor = request.query.cursor ? Number.parseInt(request.query.cursor, 10) : 0;
		const requestedLimit = request.query.limit ? Number.parseInt(request.query.limit, 10) : DEFAULT_RECENT_LIMIT;
		const streamParam = request.query.stream || "raw";

		if (Number.isNaN(cursor) || cursor < 0) {
			return reply.code(400).send({ error: "cursor must be a non-negative integer" });
		}

		if (Number.isNaN(requestedLimit) || requestedLimit < 1) {
			return reply.code(400).send({ error: "limit must be a positive integer" });
		}

		const limit = Math.min(requestedLimit, MAX_RECENT_LIMIT);

		// Resolve stream name (whitelist)
		const stream = resolveStreamName(streamParam);
		if (!stream) {
			return reply.code(400).send({ error: `Unknown log stream: ${streamParam}` });
		}

		const workspaceRoot = getWorkspaceRoot();

		// Read log lines from v2 archive
		let result = readLogLines(workspaceRoot, planExecId, workspaceId, stream, cursor, limit);

		// Track whether any source reported a non-zero totalLineCount even if
		// lines is empty (cursor beyond end). This prevents fallback chain
		// from overwriting the correct totalLineCount.
		let foundNonZeroTotal = result.totalLineCount > 0 ? result.totalLineCount : 0;

		// Fallback: try legacy log files for "raw" stream
		if (result.lines.length === 0 && foundNonZeroTotal === 0 && stream === "raw") {
			result = readLegacyLogLines(workspaceRoot, workspaceId, cursor, limit);
			if (result.totalLineCount > 0) {
				foundNonZeroTotal = result.totalLineCount;
			}
		}

		// Fallback: try in-memory state store buffer
		if (result.lines.length === 0 && foundNonZeroTotal === 0 && stream === "raw") {
			const stateStore = getStateStore();
			if (stateStore && typeof stateStore === "object" && "getRecentWorkspaceLogs" in stateStore) {
				const fn = (stateStore as any).getRecentWorkspaceLogs;
				if (typeof fn === "function") {
					try {
						const bufferLogs = fn.call(stateStore, planExecId, workspaceId, limit) as string[];
						if (bufferLogs.length > 0) {
							result = {
								lines: bufferLogs.slice(cursor, cursor + limit),
								totalLineCount: bufferLogs.length,
							};
							foundNonZeroTotal = bufferLogs.length;
						}
					} catch {
						// Ignore
					}
				}
			}
		}

		// Fallback: try loadWorkspaceLog (async state store method)
		if (result.lines.length === 0 && foundNonZeroTotal === 0 && stream === "raw") {
			const stateStore = getStateStore();
			if (stateStore && typeof stateStore === "object" && "loadWorkspaceLog" in stateStore) {
				const fn = (stateStore as any).loadWorkspaceLog;
				if (typeof fn === "function") {
					try {
						const logContent = (await fn.call(stateStore, planExecId, workspaceId)) as string | null;
						if (logContent) {
							const allLines = logContent.split(NL).filter(Boolean);
							result = {
								lines: allLines.slice(cursor, cursor + limit),
								totalLineCount: allLines.length,
							};
							foundNonZeroTotal = allLines.length;
						}
					} catch {
						// Ignore
					}
				}
			}
		}

		// If a source found data (totalLineCount > 0) but our lines are empty
		// due to cursor being beyond the end, use the totalLineCount from that source
		const effectiveTotalLineCount = result.totalLineCount > 0 ? result.totalLineCount : foundNonZeroTotal;

		return {
			logs: result.lines,
			cursor,
			nextCursor: cursor + result.lines.length,
			totalLineCount: effectiveTotalLineCount,
			hasMore: cursor + result.lines.length < effectiveTotalLineCount,
		};
	});

	// -----------------------------------------------------------------------
	// GET /api/log-stream/:planExecId/:workspaceId/live
	//
	// SSE endpoint for live log streaming with cursor/tail support.
	// On connect, sends the last LIVE_TAIL_LIMIT lines (or from cursor).
	// Then polls for new lines and sends them in real-time.
	//
	// Query params:
	//   cursor    - 0-based line offset to start reading from
	//   stream    - log stream name (default: "raw")
	//   tail      - if "true", only send new lines going forward
	//   immediate - if "true", send initial data then close (for testing)
	// -----------------------------------------------------------------------
	fastify.get<{
		Params: { planExecId: string; workspaceId: string };
		Querystring: {
			cursor?: string;
			stream?: string;
			tail?: string;
			immediate?: string;
		};
	}>("/api/log-stream/:planExecId/:workspaceId/live", async (request, reply) => {
		const { planExecId, workspaceId } = request.params;

		// Validate path components to block traversal
		try {
			validatePathComponent("planExecId", planExecId);
			validatePathComponent("workspaceId", workspaceId);
		} catch (validationError) {
			return reply.code(400).send({
				error: "Invalid path parameter",
				message: (validationError as Error).message,
			});
		}

		// Parse query params
		const cursorParam = request.query.cursor ? Number.parseInt(request.query.cursor, 10) : undefined;
		const tail = request.query.tail === "true";
		const streamParam = request.query.stream || "raw";
		const immediate = request.query.immediate === "true";

		if (cursorParam !== undefined && (Number.isNaN(cursorParam) || cursorParam < 0)) {
			return reply.code(400).send({ error: "cursor must be a non-negative integer" });
		}

		// Resolve stream name (whitelist)
		const stream = resolveStreamName(streamParam);
		if (!stream) {
			return reply.code(400).send({ error: `Unknown log stream: ${streamParam}` });
		}

		const workspaceRoot = getWorkspaceRoot();
		const stateStore = getStateStore();

		// Set up SSE response
		reply.raw.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		// Helper to write SSE events and data
		const sseEvent = (event: string, data: unknown): void => {
			reply.raw.write(`event: ${event}${NL}data: ${JSON.stringify(data)}${NL}${NL}`);
		};
		const sseData = (data: string): void => {
			reply.raw.write(`data: ${data}${NL}${NL}`);
		};

		let currentCursor = cursorParam ?? 0;

		// In tail mode, skip initial replay
		if (tail) {
			// Determine current total lines from all sources
			let totalLineCount = 0;

			const checkResult = readLogLines(workspaceRoot, planExecId, workspaceId, stream, 0, 1);
			if (checkResult.totalLineCount > 0) {
				totalLineCount = checkResult.totalLineCount;
			}

			if (totalLineCount === 0 && stream === "raw") {
				const legacyResult = readLegacyLogLines(workspaceRoot, workspaceId, 0, 1);
				if (legacyResult.totalLineCount > 0) {
					totalLineCount = legacyResult.totalLineCount;
				}
			}

			if (totalLineCount === 0 && stream === "raw") {
				if (stateStore && typeof stateStore === "object" && "getRecentWorkspaceLogs" in stateStore) {
					const fn = (stateStore as any).getRecentWorkspaceLogs;
					if (typeof fn === "function") {
						try {
							const bufferLogs = fn.call(stateStore, planExecId, workspaceId, 1) as string[];
							if (bufferLogs.length > 0) {
								totalLineCount = bufferLogs.length;
							}
						} catch {
							// Ignore
						}
					}
				}
			}

			currentCursor = totalLineCount;
			sseEvent("cursor", { cursor: currentCursor });
		} else {
			// Send initial lines (capped at LIVE_TAIL_LIMIT)
			let initialLines: string[] = [];
			let totalCount = 0;

			// Read from v2 archive
			const archiveResult = readLogLines(
				workspaceRoot,
				planExecId,
				workspaceId,
				stream,
				currentCursor,
				LIVE_TAIL_LIMIT,
			);
			if (archiveResult.lines.length > 0 || archiveResult.totalLineCount > 0) {
				initialLines = archiveResult.lines;
				totalCount = archiveResult.totalLineCount;
			}

			// Fallback to legacy files
			if (initialLines.length === 0 && totalCount === 0 && stream === "raw") {
				const legacyResult = readLegacyLogLines(workspaceRoot, workspaceId, currentCursor, LIVE_TAIL_LIMIT);
				if (legacyResult.lines.length > 0 || legacyResult.totalLineCount > 0) {
					initialLines = legacyResult.lines;
					totalCount = legacyResult.totalLineCount;
				}
			}

			// Fallback to in-memory buffer
			if (initialLines.length === 0 && totalCount === 0 && stream === "raw") {
				if (stateStore && typeof stateStore === "object" && "getRecentWorkspaceLogs" in stateStore) {
					const fn = (stateStore as any).getRecentWorkspaceLogs;
					if (typeof fn === "function") {
						try {
							const bufferLogs = fn.call(
								stateStore,
								planExecId,
								workspaceId,
								LIVE_TAIL_LIMIT + currentCursor,
							) as string[];
							if (bufferLogs.length > 0) {
								initialLines = bufferLogs.slice(currentCursor, currentCursor + LIVE_TAIL_LIMIT);
								totalCount = bufferLogs.length;
							}
						} catch {
							// Ignore
						}
					}
				}
			}

			// Send cursor event
			sseEvent("cursor", { cursor: currentCursor });

			// Send initial log lines
			for (const line of initialLines) {
				sseData(line);
			}
			currentCursor = currentCursor + initialLines.length;

			// Send ready signal
			sseEvent("ready", { cursor: currentCursor, totalCount });
		}

		const isInject = isInjectRequest(request);

		// IMPORTANT: For HTTP inject() in tests, the request body is collected
		// synchronously. The handler must return (or call reply.raw.end()) so
		// inject() can collect the response. In production, SSE stays open
		// forever; but in inject/test mode we close after sending initial data.
		if (immediate || isInject) {
			// Test mode or no real socket: send end and close
			sseEvent("end", { reason: immediate ? "immediate" : isInject ? "inject" : "no_socket" });
			reply.raw.end();
			return;
		}

		// Production: set up file watcher for the v2 archive file
		const fileName = V2_STREAM_FILE_MAP[stream];
		const archiveDir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
		const filePath = join(archiveDir, fileName);

		// Verify file path is safe (defense-in-depth)
		if (!isPathWithinRoot(workspaceRoot, filePath)) {
			sseEvent("error", { message: "Invalid log path" });
			reply.raw.end();
			return;
		}

		// Check if the log file exists
		const fileExists = existsSync(filePath);

		if (fileExists) {
			// Use polling instead of fs.watch for reliability
			// Polling works reliably with inject() since we can control timing
			const abortController = new AbortController();
			request.raw.on("close", () => abortController.abort());

			let lastLineCount = currentCursor;

			const pollInterval = setInterval(() => {
				if (abortController.signal.aborted) {
					clearInterval(pollInterval);
					return;
				}
				try {
					const result = readLogLines(
						workspaceRoot,
						planExecId,
						workspaceId,
						stream,
						lastLineCount,
						MAX_RECENT_LIMIT,
					);
					if (result.lines.length > 0) {
						for (const line of result.lines) {
							sseData(line);
						}
						lastLineCount = result.totalLineCount;
						currentCursor = lastLineCount;
					}
				} catch {
					// Ignore read errors
				}
			}, LIVE_POLL_INTERVAL_MS);

			request.raw.on("close", () => {
				clearInterval(pollInterval);
				abortController.abort();
			});
		} else if (stateStore && typeof stateStore === "object" && "getRecentWorkspaceLogs" in stateStore) {
			// Fall back to polling the in-memory buffer
			const fn = (stateStore as any).getRecentWorkspaceLogs;
			if (typeof fn === "function") {
				const pollInterval = setInterval(() => {
					try {
						const bufferLogs = fn.call(stateStore, planExecId, workspaceId, 5000) as string[];
						if (bufferLogs.length > currentCursor) {
							const newLogs = bufferLogs.slice(currentCursor);
							for (const line of newLogs) {
								sseData(line);
							}
							currentCursor = bufferLogs.length;
						}
					} catch {
						// Ignore
					}
				}, LIVE_POLL_INTERVAL_MS);

				request.raw.on("close", () => {
					clearInterval(pollInterval);
				});
			}
		} else {
			// No file and no buffer -- send end signal
			sseEvent("end", { reason: "no_logs" });
			reply.raw.end();
		}
	});
}
