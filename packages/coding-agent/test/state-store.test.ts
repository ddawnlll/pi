/**
 * State store factory and detection logic unit tests.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { StateStoreBackend } from "../src/core/state-store.js";
import { createStateStore, detectStateStoreBackend } from "../src/core/state-store.js";

describe("detectStateStoreBackend", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		// Restore original env
		process.env = { ...originalEnv };
	});

	it('returns "json" by default', () => {
		delete process.env.PI_STATE_STORE_BACKEND;
		delete process.env.PI_PG_AUTO_DETECT;
		expect(detectStateStoreBackend()).toBe("json");
	});

	it('returns "postgres" when env var is set', () => {
		process.env.PI_STATE_STORE_BACKEND = "postgres";
		expect(detectStateStoreBackend()).toBe("postgres");
	});

	it('returns "json" when env var is set to json', () => {
		process.env.PI_STATE_STORE_BACKEND = "json";
		expect(detectStateStoreBackend()).toBe("json");
	});

	it("ignores invalid env var values", () => {
		process.env.PI_STATE_STORE_BACKEND = "invalid";
		expect(detectStateStoreBackend()).toBe("json");
	});

	it("auto-detects postgres when PI_PG_AUTO_DETECT=1 and PG env vars present", () => {
		process.env.PI_PG_AUTO_DETECT = "1";
		process.env.PGHOST = "localhost";
		expect(detectStateStoreBackend()).toBe("postgres");
	});

	it("auto-detects postgres when PI_PG_AUTO_DETECT=1 and PGDATABASE set", () => {
		process.env.PI_PG_AUTO_DETECT = "1";
		process.env.PGDATABASE = "pi_test";
		expect(detectStateStoreBackend()).toBe("postgres");
	});

	it("does not auto-detect when PI_PG_AUTO_DETECT is not 1", () => {
		process.env.PGHOST = "localhost";
		process.env.PGDATABASE = "pi_test";
		delete process.env.PI_PG_AUTO_DETECT;
		expect(detectStateStoreBackend()).toBe("json");
	});

	it("respects explicit env var over auto-detection", () => {
		process.env.PI_STATE_STORE_BACKEND = "json";
		process.env.PI_PG_AUTO_DETECT = "1";
		process.env.PGHOST = "localhost";
		expect(detectStateStoreBackend()).toBe("json");
	});
});

describe("createStateStore", () => {
	it("throws when workspaceRoot is missing for json backend", () => {
		expect(() => createStateStore({ backend: "json" })).toThrow("workspaceRoot is required");
	});

	it("throws for unknown backend", () => {
		expect(() =>
			createStateStore({
				backend: "unknown" as StateStoreBackend,
			}),
		).toThrow("Unknown state store backend");
	});

	it("creates a JsonStateStore for json backend", () => {
		const store = createStateStore({
			backend: "json",
			workspaceRoot: "/tmp/test",
		});
		expect(store.getBackendType()).toBe("json");
	});
});
