/**
 * Project repository.
 *
 * Provides CRUD operations for projects with Kysely type-safe queries.
 */

import type { Kysely } from "kysely";
import type { Database, NewProject, Project, ProjectUpdate } from "../types.js";

/**
 * Project repository
 */
export class ProjectRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new project.
	 *
	 * @param data - Project data
	 * @returns Created project
	 */
	async create(data: NewProject): Promise<Project> {
		return this.db.insertInto("projects").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find project by ID.
	 *
	 * @param id - Project UUID
	 * @returns Project or undefined
	 */
	async findById(id: string): Promise<Project | undefined> {
		return this.db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * Find project by name.
	 *
	 * @param name - Project name
	 * @returns Project or undefined
	 */
	async findByName(name: string): Promise<Project | undefined> {
		return this.db.selectFrom("projects").selectAll().where("name", "=", name).executeTakeFirst();
	}

	/**
	 * List all projects.
	 *
	 * @returns Array of projects
	 */
	async listAll(): Promise<Project[]> {
		return this.db.selectFrom("projects").selectAll().orderBy("created_at", "desc").execute();
	}

	/**
	 * Update a project.
	 *
	 * @param id - Project UUID
	 * @param data - Fields to update
	 * @returns Updated project
	 */
	async update(id: string, data: ProjectUpdate): Promise<Project | undefined> {
		return this.db
			.updateTable("projects")
			.set({ ...data, updated_at: new Date().toISOString() })
			.where("id", "=", id)
			.returningAll()
			.executeTakeFirst();
	}

	/**
	 * Delete a project.
	 *
	 * @param id - Project UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("projects").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}

	/**
	 * Find or create a project by name.
	 *
	 * @param name - Project name
	 * @param rootPath - Optional root path
	 * @returns Existing or newly created project
	 */
	async findOrCreate(name: string, rootPath?: string): Promise<Project> {
		const existing = await this.findByName(name);
		if (existing) return existing;

		return this.create({
			name,
			description: null,
			root_path: rootPath ?? null,
		});
	}
}
