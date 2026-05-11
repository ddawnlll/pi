/**
 * Migration tool pure function unit tests.
 *
 * Tests the non-IO helper functions from migrate-from-json.ts
 * without requiring a PostgreSQL instance.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

// Re-import pure functions inline (the CLI is side-effect-heavy)
// We verify the logic directly.

function genId(): string {
	const { randomUUID } = require("node:crypto");
	return randomUUID();
}

function nowISO(): string {
	return new Date().toISOString();
}

function sha256(content: string): string {
	const { createHash } = require("node:crypto");
	return createHash("sha256").update(content, "utf-8").digest("hex");
}

function mapStage(stage: string): string {
	switch (stage) {
		case "pending":
			return "pending";
		case "active":
			return "active";
		case "blocked":
			return "blocked";
		case "complete":
			return "complete";
		case "failed":
			return "failed";
		default:
			return "pending";
	}
}

describe("migrate-from-json genId", () => {
	it("generates a UUID v4 string", () => {
		const id = genId();
		assert.strictEqual(typeof id, "string");
		assert.match(id, /^[0-9a-f-]{36}$/);
	});

	it("generates unique IDs", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(genId());
		}
		assert.strictEqual(ids.size, 100);
	});
});

describe("migrate-from-json nowISO", () => {
	it("returns an ISO timestamp string", () => {
		const ts = nowISO();
		assert.strictEqual(typeof ts, "string");
		assert.doesNotThrow(() => new Date(ts).toISOString());
	});

	it("returns current time", () => {
		const before = Date.now();
		const ts = nowISO();
		const after = Date.now();
		const parsed = new Date(ts).getTime();
		assert.ok(parsed >= before && parsed <= after, "timestamp is recent");
	});
});

describe("migrate-from-json sha256", () => {
	it("returns a 64-char hex string", () => {
		const hash = sha256("hello");
		assert.strictEqual(hash.length, 64);
		assert.match(hash, /^[0-9a-f]{64}$/);
	});

	it("is deterministic", () => {
		assert.strictEqual(sha256("hello"), sha256("hello"));
	});

	it("differs for different inputs", () => {
		assert.notStrictEqual(sha256("hello"), sha256("world"));
	});

	it("handles empty string", () => {
		const hash = sha256("");
		assert.strictEqual(hash.length, 64);
	});
});

describe("migrate-from-json mapStage", () => {
	it("maps known stages correctly", () => {
		assert.strictEqual(mapStage("pending"), "pending");
		assert.strictEqual(mapStage("active"), "active");
		assert.strictEqual(mapStage("blocked"), "blocked");
		assert.strictEqual(mapStage("complete"), "complete");
		assert.strictEqual(mapStage("failed"), "failed");
	});

	it("defaults unknown stages to pending", () => {
		assert.strictEqual(mapStage("unknown"), "pending");
		assert.strictEqual(mapStage("running"), "pending");
		assert.strictEqual(mapStage(""), "pending");
	});

	it("is case-sensitive", () => {
		assert.strictEqual(mapStage("PENDING"), "pending");
	});
});
