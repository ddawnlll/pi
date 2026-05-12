"use strict";
/**
 * PostgreSQL connection pool management.
 *
 * Provides a singleton pool manager with lifecycle hooks
 * and configurable pool sizing from environment variables.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPool = getPool;
exports.closePool = closePool;
exports.getClient = getClient;
exports.resetPool = resetPool;
exports.healthCheck = healthCheck;
const pg_1 = __importDefault(require("pg"));
const config_js_1 = require("./config.js");
const { Pool } = pg_1.default;
let pool = null;
/**
 * Get or create the connection pool.
 *
 * @param config - Database configuration (optional, loads from env if omitted)
 * @returns PostgreSQL connection pool
 */
function getPool(config) {
    if (pool)
        return pool;
    const cfg = config !== null && config !== void 0 ? config : (0, config_js_1.loadDbConfig)();
    pool = new Pool({
        host: cfg.host,
        port: cfg.port,
        database: cfg.database,
        user: cfg.user,
        password: cfg.password,
        max: cfg.poolMax,
        idleTimeoutMillis: cfg.idleTimeoutMs,
        connectionTimeoutMillis: cfg.connectionTimeoutMs,
        ssl: cfg.ssl,
    });
    // Log pool errors (don't crash)
    pool.on("error", (err) => {
        console.error("[db] Unexpected pool error:", err.message);
    });
    return pool;
}
/**
 * Close the connection pool.
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
/**
 * Get a client from the pool for transaction usage.
 *
 * @returns Pool client with release method
 */
async function getClient() {
    const p = getPool();
    return p.connect();
}
/**
 * Reset the pool (useful for testing).
 */
function resetPool() {
    pool = null;
}
/**
 * Check if pool is healthy by running a simple query.
 *
 * @returns True if database is reachable
 */
async function healthCheck() {
    var _a;
    try {
        const p = getPool();
        const result = await p.query("SELECT 1 AS ok");
        return ((_a = result.rows[0]) === null || _a === void 0 ? void 0 : _a.ok) === 1;
    }
    catch (_b) {
        return false;
    }
}
