"use strict";
/**
 * Test helpers for database package.
 *
 * Provides utilities for creating test database instances
 * and fixtures for repository and migration tests.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestDb = createTestDb;
/**
 * Create a test database instance.
 * Uses an in-memory SQLite database for unit tests.
 * NOTE: For integration tests, use the actual PostgreSQL connection.
 */
function createTestDb() {
    // In-memory SQLite via Kysely's dummy dialect would be ideal,
    // but we use PostgreSQL-specific features (LISTEN/NOTIFY, PL/pgSQL).
    // For unit tests, we mock the repository layer.
    throw new Error("Use integration tests with a real PostgreSQL instance. " + "Set PGDATABASE=pi_test for test DB.");
}
