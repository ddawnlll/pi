"use strict";
/**
 * Database configuration with environment variable injection.
 *
 * All operational values are configurable — no hardcoded limits.
 * Follows the Phase 1 configuration rule (§G in architecture plan).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DB_CONFIG = void 0;
exports.loadDbConfig = loadDbConfig;
exports.DEFAULT_DB_CONFIG = {
    host: "localhost",
    port: 5432,
    database: "pi_executor",
    user: "pi",
    password: "",
    poolMax: 20,
    idleTimeoutMs: 30000,
    connectionTimeoutMs: 5000,
    maxRetries: 3,
    retryBaseDelayMs: 100,
    retryMaxDelayMs: 2000,
    ssl: false,
};
/**
 * Load DB config from environment variables.
 * Falls back to defaults for missing values.
 */
function loadDbConfig(overrides) {
    var _a, _b, _c, _d;
    const env = process.env;
    return Object.assign({ host: (_a = env.PGHOST) !== null && _a !== void 0 ? _a : exports.DEFAULT_DB_CONFIG.host, port: env.PGPORT ? Number(env.PGPORT) : exports.DEFAULT_DB_CONFIG.port, database: (_b = env.PGDATABASE) !== null && _b !== void 0 ? _b : exports.DEFAULT_DB_CONFIG.database, user: (_c = env.PGUSER) !== null && _c !== void 0 ? _c : exports.DEFAULT_DB_CONFIG.user, password: (_d = env.PGPASSWORD) !== null && _d !== void 0 ? _d : exports.DEFAULT_DB_CONFIG.password, poolMax: env.PGPOOL_MAX ? Number(env.PGPOOL_MAX) : exports.DEFAULT_DB_CONFIG.poolMax, idleTimeoutMs: env.PGIDLE_TIMEOUT ? Number(env.PGIDLE_TIMEOUT) : exports.DEFAULT_DB_CONFIG.idleTimeoutMs, connectionTimeoutMs: env.PGCONN_TIMEOUT ? Number(env.PGCONN_TIMEOUT) : exports.DEFAULT_DB_CONFIG.connectionTimeoutMs, maxRetries: env.PG_MAX_RETRIES ? Number(env.PG_MAX_RETRIES) : exports.DEFAULT_DB_CONFIG.maxRetries, retryBaseDelayMs: env.PG_RETRY_BASE_DELAY ? Number(env.PG_RETRY_BASE_DELAY) : exports.DEFAULT_DB_CONFIG.retryBaseDelayMs, retryMaxDelayMs: env.PG_RETRY_MAX_DELAY ? Number(env.PG_RETRY_MAX_DELAY) : exports.DEFAULT_DB_CONFIG.retryMaxDelayMs, ssl: env.PGSSLMODE === "require" ? true : env.PGSSLMODE === "no-verify" ? { rejectUnauthorized: false } : false }, overrides);
}
