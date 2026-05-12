"use strict";
/**
 * Kysely type-safe query layer configuration.
 *
 * Sets up Kysely with the PostgreSQL pool for type-safe database access.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKysely = getKysely;
exports.closeKysely = closeKysely;
exports.resetKysely = resetKysely;
const kysely_1 = require("kysely");
const pg_1 = __importDefault(require("pg"));
const config_js_1 = require("./config.js");
const { Pool } = pg_1.default;
let db = null;
/**
 * Get or create the Kysely database instance.
 *
 * @param config - Database configuration (optional)
 * @returns Kysely database instance
 */
function getKysely(config) {
    if (db)
        return db;
    const cfg = config !== null && config !== void 0 ? config : (0, config_js_1.loadDbConfig)();
    const dialect = new kysely_1.PostgresDialect({
        pool: new Pool({
            host: cfg.host,
            port: cfg.port,
            database: cfg.database,
            user: cfg.user,
            password: cfg.password,
            max: cfg.poolMax,
            idleTimeoutMillis: cfg.idleTimeoutMs,
            connectionTimeoutMillis: cfg.connectionTimeoutMs,
            ssl: cfg.ssl,
        }),
    });
    db = new kysely_1.Kysely({ dialect });
    return db;
}
/**
 * Close the Kysely database instance.
 */
async function closeKysely() {
    if (db) {
        await db.destroy();
        db = null;
    }
}
/**
 * Reset the Kysely instance (useful for testing).
 */
function resetKysely() {
    db = null;
}
