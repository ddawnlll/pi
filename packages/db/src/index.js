"use strict";
/**
 * Database package public API.
 *
 * Provides PostgreSQL-backed persistence for execution state,
 * including connection management, typed repositories, migrations,
 * and LISTEN/NOTIFY event streaming.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceExecutionRepository = exports.ProjectRepository = exports.PlanExecutionRepository = exports.JournalEventRepository = exports.NotifyClient = exports.runMigrations = exports.rollbackMigrations = exports.migrations = exports.getAppliedMigrations = exports.resetKysely = exports.getKysely = exports.closeKysely = exports.withTransaction = exports.now = exports.generateId = exports.resetPool = exports.healthCheck = exports.getPool = exports.getClient = exports.closePool = exports.loadDbConfig = exports.DEFAULT_DB_CONFIG = void 0;
// Configuration
const config_js_1 = require("./config.js");
Object.defineProperty(exports, "DEFAULT_DB_CONFIG", { enumerable: true, get: function () { return config_js_1.DEFAULT_DB_CONFIG; } });
Object.defineProperty(exports, "loadDbConfig", { enumerable: true, get: function () { return config_js_1.loadDbConfig; } });
// Connection management
const connection_js_1 = require("./connection.js");
Object.defineProperty(exports, "closePool", { enumerable: true, get: function () { return connection_js_1.closePool; } });
Object.defineProperty(exports, "getClient", { enumerable: true, get: function () { return connection_js_1.getClient; } });
Object.defineProperty(exports, "getPool", { enumerable: true, get: function () { return connection_js_1.getPool; } });
Object.defineProperty(exports, "healthCheck", { enumerable: true, get: function () { return connection_js_1.healthCheck; } });
Object.defineProperty(exports, "resetPool", { enumerable: true, get: function () { return connection_js_1.resetPool; } });
// Transaction helpers
const helpers_js_1 = require("./helpers.js");
Object.defineProperty(exports, "generateId", { enumerable: true, get: function () { return helpers_js_1.generateId; } });
Object.defineProperty(exports, "now", { enumerable: true, get: function () { return helpers_js_1.now; } });
Object.defineProperty(exports, "withTransaction", { enumerable: true, get: function () { return helpers_js_1.withTransaction; } });
// Kysely query layer
const kysely_js_1 = require("./kysely.js");
Object.defineProperty(exports, "closeKysely", { enumerable: true, get: function () { return kysely_js_1.closeKysely; } });
Object.defineProperty(exports, "getKysely", { enumerable: true, get: function () { return kysely_js_1.getKysely; } });
Object.defineProperty(exports, "resetKysely", { enumerable: true, get: function () { return kysely_js_1.resetKysely; } });
// Migrations
const index_js_1 = require("./migrations/index.js");
Object.defineProperty(exports, "getAppliedMigrations", { enumerable: true, get: function () { return index_js_1.getAppliedMigrations; } });
Object.defineProperty(exports, "migrations", { enumerable: true, get: function () { return index_js_1.migrations; } });
Object.defineProperty(exports, "rollbackMigrations", { enumerable: true, get: function () { return index_js_1.rollbackMigrations; } });
Object.defineProperty(exports, "runMigrations", { enumerable: true, get: function () { return index_js_1.runMigrations; } });
// Listen/Notify
const notify_js_1 = require("./notify.js");
Object.defineProperty(exports, "NotifyClient", { enumerable: true, get: function () { return notify_js_1.NotifyClient; } });
// Repositories
const index_js_2 = require("./repositories/index.js");
Object.defineProperty(exports, "JournalEventRepository", { enumerable: true, get: function () { return index_js_2.JournalEventRepository; } });
Object.defineProperty(exports, "PlanExecutionRepository", { enumerable: true, get: function () { return index_js_2.PlanExecutionRepository; } });
Object.defineProperty(exports, "ProjectRepository", { enumerable: true, get: function () { return index_js_2.ProjectRepository; } });
Object.defineProperty(exports, "WorkspaceExecutionRepository", { enumerable: true, get: function () { return index_js_2.WorkspaceExecutionRepository; } });
