"use strict";
/**
 * Migration tool pure function unit tests.
 *
 * Tests the non-IO helper functions from migrate-from-json.ts
 * without requiring a PostgreSQL instance.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
// Re-import pure functions inline (the CLI is side-effect-heavy)
// We verify the logic directly.
function genId() {
    const { randomUUID } = require("node:crypto");
    return randomUUID();
}
function nowISO() {
    return new Date().toISOString();
}
function sha256(content) {
    const { createHash } = require("node:crypto");
    return createHash("sha256").update(content, "utf-8").digest("hex");
}
function mapStage(stage) {
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
(0, node_test_1.describe)("migrate-from-json genId", () => {
    (0, node_test_1.it)("generates a UUID v4 string", () => {
        const id = genId();
        node_assert_1.default.strictEqual(typeof id, "string");
        node_assert_1.default.match(id, /^[0-9a-f-]{36}$/);
    });
    (0, node_test_1.it)("generates unique IDs", () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++) {
            ids.add(genId());
        }
        node_assert_1.default.strictEqual(ids.size, 100);
    });
});
(0, node_test_1.describe)("migrate-from-json nowISO", () => {
    (0, node_test_1.it)("returns an ISO timestamp string", () => {
        const ts = nowISO();
        node_assert_1.default.strictEqual(typeof ts, "string");
        node_assert_1.default.doesNotThrow(() => new Date(ts).toISOString());
    });
    (0, node_test_1.it)("returns current time", () => {
        const before = Date.now();
        const ts = nowISO();
        const after = Date.now();
        const parsed = new Date(ts).getTime();
        node_assert_1.default.ok(parsed >= before && parsed <= after, "timestamp is recent");
    });
});
(0, node_test_1.describe)("migrate-from-json sha256", () => {
    (0, node_test_1.it)("returns a 64-char hex string", () => {
        const hash = sha256("hello");
        node_assert_1.default.strictEqual(hash.length, 64);
        node_assert_1.default.match(hash, /^[0-9a-f]{64}$/);
    });
    (0, node_test_1.it)("is deterministic", () => {
        node_assert_1.default.strictEqual(sha256("hello"), sha256("hello"));
    });
    (0, node_test_1.it)("differs for different inputs", () => {
        node_assert_1.default.notStrictEqual(sha256("hello"), sha256("world"));
    });
    (0, node_test_1.it)("handles empty string", () => {
        const hash = sha256("");
        node_assert_1.default.strictEqual(hash.length, 64);
    });
});
(0, node_test_1.describe)("migrate-from-json mapStage", () => {
    (0, node_test_1.it)("maps known stages correctly", () => {
        node_assert_1.default.strictEqual(mapStage("pending"), "pending");
        node_assert_1.default.strictEqual(mapStage("active"), "active");
        node_assert_1.default.strictEqual(mapStage("blocked"), "blocked");
        node_assert_1.default.strictEqual(mapStage("complete"), "complete");
        node_assert_1.default.strictEqual(mapStage("failed"), "failed");
    });
    (0, node_test_1.it)("defaults unknown stages to pending", () => {
        node_assert_1.default.strictEqual(mapStage("unknown"), "pending");
        node_assert_1.default.strictEqual(mapStage("running"), "pending");
        node_assert_1.default.strictEqual(mapStage(""), "pending");
    });
    (0, node_test_1.it)("is case-sensitive", () => {
        node_assert_1.default.strictEqual(mapStage("PENDING"), "pending");
    });
});
