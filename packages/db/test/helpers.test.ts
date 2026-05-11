/**
 * Helper function unit tests.
 *
 * Tests withTransaction retry logic, generateId, and now().
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { generateId, now } from "../src/helpers.js";

describe("generateId", () => {
	it("generates a UUID v4 string", () => {
		const id = generateId();
		assert.strictEqual(typeof id, "string");
		assert.match(id, /^[0-9a-f-]{36}$/);
	});

	it("generates unique IDs", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 100; i++) {
			ids.add(generateId());
		}
		assert.strictEqual(ids.size, 100);
	});
});

describe("now", () => {
	it("returns an ISO timestamp string", () => {
		const ts = now();
		assert.strictEqual(typeof ts, "string");
		// Verify it's a valid ISO date
		assert.doesNotThrow(() => new Date(ts).toISOString());
	});

	it("returns current time", () => {
		const before = Date.now();
		const ts = now();
		const after = Date.now();
		const parsed = new Date(ts).getTime();
		assert.ok(parsed >= before && parsed <= after, "timestamp is recent");
	});
});
