/**
 * Migration 007: Add memory vectors table for organic vector memory store.
 *
 * Creates the core memory_vectors table with support for:
 * - Vector embeddings (pgvector) for semantic similarity search
 * - Content hash for deduplication
 * - Source pointer for provenance tracking
 * - Freshness tracking via timestamps
 * - Safety classification
 * - Query by project, plan, workspace, capability
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "../types.js";

/**
 * Check whether the pgvector extension is available.
 */
async function hasVectorExtension(db: Kysely<Database>): Promise<boolean> {
	try {
		const result = await sql<{ name: string }>`
			SELECT extname AS name FROM pg_extension WHERE extname = 'vector'
		`.execute(db);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

/**
 * Apply the migration.
 */
export async function up(db: Kysely<Database>): Promise<void> {
	// Try to enable pgvector extension if available
	try {
		await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);
	} catch {
		// pgvector extension not available
	}

	const vectorAvailable = await hasVectorExtension(db);
	const embeddingColumnType = vectorAvailable ? "vector(1536)" : "real[]";

	if (!vectorAvailable) {
		console.warn("[db] pgvector extension not available, embedding column will use real[] fallback");
	}

	// Memory vectors table — use raw SQL for pgvector column type support
	await sql`
		CREATE TABLE memory_vectors (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
			plan_execution_id UUID REFERENCES plan_executions(id) ON DELETE SET NULL DEFAULT NULL,
			workspace_id VARCHAR(255),
			capability VARCHAR(255),
			content TEXT NOT NULL,
			content_hash VARCHAR(64) NOT NULL,
			embedding ${sql.raw(embeddingColumnType)},
			embedding_model VARCHAR(100),
			source_pointer JSONB NOT NULL DEFAULT '{}',
			freshness TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			safety_classification VARCHAR(50) NOT NULL DEFAULT 'safe',
			metadata JSONB DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`.execute(db);

	// Indexes for common query patterns
	await db.schema.createIndex("idx_memory_vectors_project_id").on("memory_vectors").column("project_id").execute();

	await db.schema
		.createIndex("idx_memory_vectors_plan_execution_id")
		.on("memory_vectors")
		.column("plan_execution_id")
		.execute();

	await db.schema.createIndex("idx_memory_vectors_workspace_id").on("memory_vectors").column("workspace_id").execute();

	await db.schema.createIndex("idx_memory_vectors_capability").on("memory_vectors").column("capability").execute();

	await db.schema
		.createIndex("idx_memory_vectors_safety")
		.on("memory_vectors")
		.column("safety_classification")
		.execute();

	await db.schema.createIndex("idx_memory_vectors_freshness").on("memory_vectors").column("freshness").execute();

	await db.schema.createIndex("idx_memory_vectors_content_hash").on("memory_vectors").column("content_hash").execute();

	// Partial unique index on content_hash per project for deduplication
	await db.schema
		.createIndex("idx_memory_vectors_content_hash_unique")
		.unique()
		.on("memory_vectors")
		.columns(["project_id", "content_hash"])
		.execute();
}

/**
 * Rollback the migration.
 */
export async function down(db: Kysely<Database>): Promise<void> {
	await db.schema.dropTable("memory_vectors").ifExists().execute();
}
