"use strict";
/**
 * Helper function unit tests.
 *
 * Tests withTransaction retry logic, generateId, and now().
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const helpers_js_1 = require("../src/helpers.js");
(0, node_test_1.describe)("generateId", () => {
    (0, node_test_1.it)("generates a UUID v4 string", () => {
        const id = (0, helpers_js_1.generateId)();
        node_assert_1.default.strictEqual(typeof id, "string");
        node_assert_1.default.match(id, /^[0-9a-f-]{36}$/);
    });
    (0, node_test_1.it)("generates unique IDs", () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++) {
            ids.add((0, helpers_js_1.generateId)());
        }
        node_assert_1.default.strictEqual(ids.size, 100);
    });
});
(0, node_test_1.describe)("now", () => {
    (0, node_test_1.it)("returns an ISO timestamp string", () => {
        const ts = (0, helpers_js_1.now)();
        node_assert_1.default.strictEqual(typeof ts, "string");
        // Verify it's a valid ISO date
        node_assert_1.default.doesNotThrow(() => new Date(ts).toISOString());
    });
    (0, node_test_1.it)("returns current time", () => {
        const before = Date.now();
        const ts = (0, helpers_js_1.now)();
        const after = Date.now();
        const parsed = new Date(ts).getTime();
        node_assert_1.default.ok(parsed >= before && parsed <= after, "timestamp is recent");
    });
});
