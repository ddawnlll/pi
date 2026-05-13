/**
 * Log Stream Routes - Tests
 *
 * Validates:
 *  1. Recent workspace logs API works
 *  2. Live workspace log stream works (SSE)
 *  3. Cursor/tail support prevents huge replay
 *  4. Path traversal is blocked
 *  5. Arbitrary repo file reads are impossible
 *  6. Existing log endpoints remain compatible
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	isPathWithinRoot,
	readLegacyLogLines,
	readLogLines,
	registerLogStreamRoutes,
	resolveStreamName,
	validatePathComponent,
} from "../src/log-stream-routes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NL_CHAR = String.fromCharCode(10);

function createTempDir(): string {
	const dir = join(tmpdir(), `log-stream-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

/**
 * Create a v2 archive log file at the expected path.
 */
function createV2Archive(
	workspaceRoot: string,
	planExecId: string,
	workspaceId: string,
	stream: string,
	content: string,
): void {
	const dir = join(workspaceRoot, ".pi", "executions", planExecId, "workspaces", workspaceId);
	mkdirSync(dir, { recursive: true });
	const fileMap: Record<string, string> = {
		raw: "raw.log",
		structured: "structured.ndjson",
		narrative: "narrative.ndjson",
		audit: "audit.ndjson",
		decision: "decisions.ndjson",
	};
	const fileName = fileMap[stream] || "raw.log";
	writeFileSync(join(dir, fileName), content, "utf-8");
}

/**
 * Create a legacy workspace execution log file.
 */
function createLegacyLog(workspaceRoot: string, workspaceId: string, attempt: number, content: string): void {
	const dir = join(workspaceRoot, ".pi", "workspaces", workspaceId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `execution-${attempt}.log`), content, "utf-8");
}

/**
 * Create a minimal Fastify app with log stream routes.
 */
async function createApp(workspaceRoot: string, stateStore: any = {}) {
	const app = Fastify({ logger: false });
	await app.register(fastifyWebsocket);
	registerLogStreamRoutes(
		app,
		() => workspaceRoot,
		() => stateStore,
	);
	return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("log-stream-routes", () => {
	let workspaceRoot: string;

	beforeEach(() => {
		workspaceRoot = createTempDir();
	});

	afterEach(() => {
		rmSync(workspaceRoot, { recursive: true, force: true });
	});

	// =====================================================================
	// Acceptance Criterion 1: Recent workspace logs API works
	// =====================================================================

	describe("recent workspace logs API", () => {
		it("returns recent logs from v2 archive", async () => {
			createV2Archive(workspaceRoot, "plan-1", "ws-1", "raw", ["line1", "line2", "line3"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/ws-1/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual(["line1", "line2", "line3"]);
			expect(body.cursor).toBe(0);
			expect(body.nextCursor).toBe(3);
			expect(body.totalLineCount).toBe(3);
			expect(body.hasMore).toBe(false);

			await app.close();
		});

		it("returns recent logs from legacy files as fallback", async () => {
			createLegacyLog(workspaceRoot, "ws-2", 1, ["legacy1", "legacy2"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-legacy/ws-2/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual(["legacy1", "legacy2"]);

			await app.close();
		});

		it("returns empty logs when no files exist", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-none/ws-none/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual([]);
			expect(body.totalLineCount).toBe(0);
			expect(body.hasMore).toBe(false);

			await app.close();
		});

		it("falls back to in-memory state store buffer", async () => {
			const mockStore = {
				getRecentWorkspaceLogs: (_planExecId: string, _workspaceId: string, limit: number) => {
					return Array.from({ length: Math.min(limit, 5) }, (_, i) => `buffer-line-${i + 1}`);
				},
			};

			const app = await createApp(workspaceRoot, mockStore);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-buffer/ws-buf/recent?limit=3",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual(["buffer-line-1", "buffer-line-2", "buffer-line-3"]);

			await app.close();
		});

		it("supports different stream types", async () => {
			const ndjsonContent = [
				JSON.stringify({ level: "info", msg: "started" }),
				JSON.stringify({ level: "warn", msg: "slow query" }),
			].join(NL_CHAR);
			createV2Archive(workspaceRoot, "plan-ndjson", "ws-nd", "structured", ndjsonContent);

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-ndjson/ws-nd/recent?stream=structured",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toHaveLength(2);
			// Pretty-printed JSON
			expect(body.logs[0]).toContain('"level"');
			expect(body.logs[0]).toContain('"info"');

			await app.close();
		});

		it("supports legacy stream name mapping (stdout -> raw)", async () => {
			createV2Archive(workspaceRoot, "plan-legacy-name", "ws-ln", "raw", "output line");

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-legacy-name/ws-ln/recent?stream=stdout",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual(["output line"]);

			await app.close();
		});

		it("rejects unknown stream names", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/ws-1/recent?stream=unknown_stream",
			});

			expect(response.statusCode).toBe(400);
			const body = response.json();
			expect(body.error).toContain("Unknown log stream");

			await app.close();
		});
	});

	// =====================================================================
	// Acceptance Criterion 2: Live workspace log stream works
	// =====================================================================

	describe("live workspace log stream", () => {
		it("returns SSE headers on connect", async () => {
			createV2Archive(workspaceRoot, "plan-live", "ws-live", "raw", "init line");

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-live/ws-live/live",
			});

			// SSE response should have correct content type
			expect(response.headers["content-type"]).toContain("text/event-stream");
			expect(response.headers["cache-control"]).toBe("no-cache");

			await app.close();
		});

		it("sends initial log lines on connect", async () => {
			createV2Archive(workspaceRoot, "plan-live2", "ws-live2", "raw", ["line-a", "line-b"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-live2/ws-live2/live",
			});

			const body = response.body;
			// Should contain cursor event, log data, and ready event
			expect(body).toContain("event: cursor");
			expect(body).toContain("event: ready");
			expect(body).toContain("line-a");
			expect(body).toContain("line-b");

			await app.close();
		});

		it("sends no initial replay in tail mode", async () => {
			createV2Archive(
				workspaceRoot,
				"plan-tail",
				"ws-tail",
				"raw",
				["existing-line-1", "existing-line-2", "existing-line-3"].join(NL_CHAR),
			);

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-tail/ws-tail/live?tail=true",
			});

			const body = response.body;
			// Should contain cursor event set to total line count
			expect(body).toContain("event: cursor");
			// Should NOT contain the existing log data
			expect(body).not.toContain("existing-line-1");

			await app.close();
		});

		it("rejects invalid path params in live stream", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/../etc/ws-1/live",
			});

			// HTTP path normalization resolves '..' before routing, yielding 404.
			// Either 400 (caught by validation) or 404 (no matching route) is safe.
			expect([400, 404]).toContain(response.statusCode);

			await app.close();
		});
	});

	// =====================================================================
	// Acceptance Criterion 3: Cursor/tail support prevents huge replay
	// =====================================================================

	describe("cursor and tail support", () => {
		it("respects cursor parameter in recent endpoint", async () => {
			const lines = Array.from({ length: 1000 }, (_, i) => `line-${i + 1}`);
			createV2Archive(workspaceRoot, "plan-cursor", "ws-cursor", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);

			// Read from cursor=500, limit=50
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-cursor/ws-cursor/recent?cursor=500&limit=50",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toHaveLength(50);
			expect(body.logs[0]).toBe("line-501");
			expect(body.logs[49]).toBe("line-550");
			expect(body.cursor).toBe(500);
			expect(body.nextCursor).toBe(550);
			expect(body.hasMore).toBe(true);

			await app.close();
		});

		it("reports hasMore correctly when at end", async () => {
			const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
			createV2Archive(workspaceRoot, "plan-end", "ws-end", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-end/ws-end/recent?cursor=5&limit=10",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toHaveLength(5);
			expect(body.hasMore).toBe(false);

			await app.close();
		});

		it("caps limit at MAX_RECENT_LIMIT (10000)", async () => {
			const lines = Array.from({ length: 20000 }, (_, i) => `line-${i}`);
			createV2Archive(workspaceRoot, "plan-big", "ws-big", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-big/ws-big/recent?limit=999999",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			// Should be capped at 10000
			expect(body.logs.length).toBeLessThanOrEqual(10000);

			await app.close();
		});

		it("cursor in live stream avoids full replay", async () => {
			const lines = Array.from({ length: 500 }, (_, i) => `line-${i + 1}`);
			createV2Archive(workspaceRoot, "plan-lc", "ws-lc", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			// Start from cursor=400 -- should only get lines 401-500
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-lc/ws-lc/live?cursor=400",
			});

			const body = response.body;
			// Should NOT contain early lines
			expect(body).not.toContain("line-1");
			expect(body).not.toContain("line-100");
			// Should contain lines from cursor
			expect(body).toContain("line-401");
			expect(body).toContain("line-500");

			await app.close();
		});

		it("tail mode sets cursor to total count without replaying", async () => {
			const lines = Array.from({ length: 300 }, (_, i) => `old-line-${i + 1}`);
			createV2Archive(workspaceRoot, "plan-tailc", "ws-tailc", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-tailc/ws-tailc/live?tail=true",
			});

			const body = response.body;
			// Cursor should be set to the total count (300)
			expect(body).toContain("300");
			// Old lines should NOT be replayed
			expect(body).not.toContain("old-line-1");
			expect(body).not.toContain("old-line-150");

			await app.close();
		});

		it("rejects negative cursor", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-x/ws-x/recent?cursor=-5",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("rejects non-numeric cursor", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-x/ws-x/recent?cursor=abc",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});
	});

	// =====================================================================
	// Acceptance Criterion 4: Path traversal is blocked
	// =====================================================================

	describe("path traversal protection", () => {
		it("blocks '..' in planExecId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/../etc/ws-1/recent",
			});

			// HTTP path normalization resolves '..' before routing, yielding 404.
			// Either 400 (caught by validation) or 404 (no matching route) is safe.
			expect([400, 404]).toContain(response.statusCode);

			await app.close();
		});

		it("blocks '..' in workspaceId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/..%2Fetc/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("blocks slash in planExecId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/foo%2Fbar/ws-1/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("blocks dot-prefixed workspace IDs (e.g. .env)", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/.env/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("blocks absolute paths", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/C:%5CUsers/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("validatePathComponent blocks directory traversal with ..", () => {
			expect(() => validatePathComponent("test", "..")).toThrow("directory traversal");
		});

		it("validatePathComponent blocks single dot", () => {
			expect(() => validatePathComponent("test", ".")).toThrow("directory traversal");
		});

		it("validatePathComponent blocks dot-prefix (hidden files)", () => {
			expect(() => validatePathComponent("test", ".env")).toThrow("dot-prefixed");
			expect(() => validatePathComponent("test", ".ssh")).toThrow("dot-prefixed");
		});

		it("validatePathComponent blocks path separators", () => {
			expect(() => validatePathComponent("test", "foo/bar")).toThrow("path separator");
			const backslash = `foo${String.fromCharCode(92)}bar`;
			expect(() => validatePathComponent("test", backslash)).toThrow("path separator");
		});

		it("validatePathComponent blocks empty strings", () => {
			expect(() => validatePathComponent("test", "")).toThrow("non-empty string");
		});

		it("validatePathComponent blocks null bytes", () => {
			const nullStr = `foo${String.fromCharCode(0)}bar`;
			expect(() => validatePathComponent("test", nullStr)).toThrow("null byte");
		});

		it("validatePathComponent blocks special characters", () => {
			expect(() => validatePathComponent("test", "foo;bar")).toThrow("disallowed characters");
			expect(() => validatePathComponent("test", "foo|bar")).toThrow("disallowed characters");
			expect(() => validatePathComponent("test", "foo`bar")).toThrow("disallowed characters");
			expect(() => validatePathComponent("test", "foo$bar")).toThrow("disallowed characters");
		});

		it("validatePathComponent allows safe identifiers", () => {
			expect(validatePathComponent("test", "plan-1")).toBe("plan-1");
			expect(validatePathComponent("test", "ws_2")).toBe("ws_2");
			expect(validatePathComponent("test", "5A")).toBe("5A");
			expect(validatePathComponent("test", "abc123")).toBe("abc123");
		});

		it("isPathWithinRoot detects path escape", () => {
			expect(isPathWithinRoot("/workspace", "/workspace/.pi/executions/plan-1")).toBe(true);
			expect(isPathWithinRoot("/workspace", "/etc/passwd")).toBe(false);
			expect(isPathWithinRoot("/workspace", "/workspace/../etc/passwd")).toBe(false);
		});

		it("isPathWithinRoot handles normalized paths", () => {
			expect(isPathWithinRoot("/workspace", "/workspace/subdir/file.log")).toBe(true);
			expect(isPathWithinRoot("/workspace", "/workspace-other/file.log")).toBe(false);
		});
	});

	// =====================================================================
	// Acceptance Criterion 5: Arbitrary repo file reads are impossible
	// =====================================================================

	describe("arbitrary file read protection", () => {
		it("cannot read /etc/passwd via planExecId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/..%2F..%2F..%2Fetc%2Fpasswd/ws-1/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("cannot read /etc/passwd via workspaceId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/..%2F..%2F..%2Fetc%2Fpasswd/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("cannot read .env files via workspaceId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/.env/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("cannot read .ssh via workspaceId", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/.ssh/recent",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("readLogLines returns empty for paths outside root", () => {
			const result = readLogLines("/safe-root", "../../../etc", "passwd", "raw", 0, 100);
			expect(result.lines).toEqual([]);
			expect(result.totalLineCount).toBe(0);
		});

		it("readLegacyLogLines returns empty for paths outside root", () => {
			const result = readLegacyLogLines("/safe-root", "..%2F..%2Fetc", 0, 100);
			expect(result.lines).toEqual([]);
			expect(result.totalLineCount).toBe(0);
		});

		it("isPathWithinRoot protects against symlinks in normalized path", () => {
			expect(isPathWithinRoot("/home/user/workspace", "/tmp/evil")).toBe(false);
			expect(isPathWithinRoot("/home/user/workspace", "/home/user/workspace/logs/safe.log")).toBe(true);
		});

		it("stream whitelist prevents reading arbitrary files", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/ws-1/recent?stream=..%2F..%2Fetc",
			});

			expect(response.statusCode).toBe(400);
			const body = response.json();
			expect(body.error).toContain("Unknown log stream");

			await app.close();
		});
	});

	// =====================================================================
	// Acceptance Criterion 6: Existing log endpoints remain compatible
	// =====================================================================

	describe("backward compatibility", () => {
		it("legacy stream names resolve correctly", () => {
			expect(resolveStreamName("stdout")).toBe("raw");
			expect(resolveStreamName("stderr")).toBe("raw");
			expect(resolveStreamName("error")).toBe("raw");
			expect(resolveStreamName("test")).toBe("raw");
		});

		it("v2 stream names resolve correctly", () => {
			expect(resolveStreamName("raw")).toBe("raw");
			expect(resolveStreamName("structured")).toBe("structured");
			expect(resolveStreamName("narrative")).toBe("narrative");
			expect(resolveStreamName("audit")).toBe("audit");
			expect(resolveStreamName("decision")).toBe("decision");
		});

		it("unknown stream names return null", () => {
			expect(resolveStreamName("unknown")).toBeNull();
			expect(resolveStreamName("../../../etc")).toBeNull();
			expect(resolveStreamName("")).toBeNull();
		});

		it("recent endpoint default stream is raw (matching legacy behavior)", async () => {
			createV2Archive(workspaceRoot, "plan-compat", "ws-compat", "raw", "compat-line");

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-compat/ws-compat/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual(["compat-line"]);

			await app.close();
		});

		it("recent endpoint returns same shape as existing logs endpoint", async () => {
			createV2Archive(workspaceRoot, "plan-shape", "ws-shape", "raw", ["line1", "line2", "line3"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-shape/ws-shape/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			// Should have 'logs' array like the existing endpoint
			expect(Array.isArray(body.logs)).toBe(true);
			expect(body.logs).toEqual(["line1", "line2", "line3"]);
			// Plus cursor metadata for progressive loading
			expect(typeof body.cursor).toBe("number");
			expect(typeof body.nextCursor).toBe("number");
			expect(typeof body.totalLineCount).toBe("number");
			expect(typeof body.hasMore).toBe("boolean");

			await app.close();
		});
	});

	// =====================================================================
	// Edge cases
	// =====================================================================

	describe("edge cases", () => {
		it("handles empty log files", async () => {
			createV2Archive(workspaceRoot, "plan-empty", "ws-empty", "raw", "");

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-empty/ws-empty/recent",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual([]);
			expect(body.totalLineCount).toBe(0);

			await app.close();
		});

		it("handles cursor beyond file length", async () => {
			createV2Archive(workspaceRoot, "plan-beyond", "ws-beyond", "raw", ["line1", "line2"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-beyond/ws-beyond/recent?cursor=999",
			});

			expect(response.statusCode).toBe(200);
			const body = response.json();
			expect(body.logs).toEqual([]);
			expect(body.totalLineCount).toBe(2);

			await app.close();
		});

		it("handles limit=0 gracefully", async () => {
			createV2Archive(workspaceRoot, "plan-lim0", "ws-lim0", "raw", ["line1", "line2"].join(NL_CHAR));

			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-lim0/ws-lim0/recent?limit=0",
			});

			expect(response.statusCode).toBe(400);
			const body = response.json();
			expect(body.error).toContain("positive integer");

			await app.close();
		});

		it("handles NaN cursor gracefully", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/ws-1/recent?cursor=notanumber",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("handles NaN limit gracefully", async () => {
			const app = await createApp(workspaceRoot);
			const response = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-1/ws-1/recent?limit=xyz",
			});

			expect(response.statusCode).toBe(400);

			await app.close();
		});

		it("handles concurrent requests without errors", async () => {
			createV2Archive(workspaceRoot, "plan-conc", "ws-conc", "raw", "concurrent-line");

			const app = await createApp(workspaceRoot);
			// Fire multiple concurrent requests
			const responses = await Promise.all([
				app.inject({ method: "GET", url: "/api/log-stream/plan-conc/ws-conc/recent" }),
				app.inject({ method: "GET", url: "/api/log-stream/plan-conc/ws-conc/recent" }),
				app.inject({ method: "GET", url: "/api/log-stream/plan-conc/ws-conc/recent" }),
			]);

			for (const response of responses) {
				expect(response.statusCode).toBe(200);
				const body = response.json();
				expect(body.logs).toEqual(["concurrent-line"]);
			}

			await app.close();
		});

		it("page through logs with successive cursor calls", async () => {
			const lines = Array.from({ length: 25 }, (_, i) => `page-line-${i + 1}`);
			createV2Archive(workspaceRoot, "plan-page", "ws-page", "raw", lines.join(NL_CHAR));

			const app = await createApp(workspaceRoot);

			// Page 1: lines 0-9
			const r1 = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-page/ws-page/recent?cursor=0&limit=10",
			});
			expect(r1.json().logs[0]).toBe("page-line-1");
			expect(r1.json().nextCursor).toBe(10);

			// Page 2: lines 10-19
			const r2 = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-page/ws-page/recent?cursor=10&limit=10",
			});
			expect(r2.json().logs[0]).toBe("page-line-11");
			expect(r2.json().nextCursor).toBe(20);

			// Page 3: lines 20-24
			const r3 = await app.inject({
				method: "GET",
				url: "/api/log-stream/plan-page/ws-page/recent?cursor=20&limit=10",
			});
			expect(r3.json().logs[0]).toBe("page-line-21");
			expect(r3.json().logs).toHaveLength(5);
			expect(r3.json().nextCursor).toBe(25);
			expect(r3.json().hasMore).toBe(false);

			await app.close();
		});
	});
});
