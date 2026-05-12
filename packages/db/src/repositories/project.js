"use strict";
/**
 * Project repository.
 *
 * Provides CRUD operations for projects with Kysely type-safe queries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectRepository = void 0;
/**
 * Project repository
 */
class ProjectRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Create a new project.
     *
     * @param data - Project data
     * @returns Created project
     */
    async create(data) {
        return this.db.insertInto("projects").values(data).returningAll().executeTakeFirstOrThrow();
    }
    /**
     * Find project by ID.
     *
     * @param id - Project UUID
     * @returns Project or undefined
     */
    async findById(id) {
        return this.db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
    }
    /**
     * Find project by name.
     *
     * @param name - Project name
     * @returns Project or undefined
     */
    async findByName(name) {
        return this.db.selectFrom("projects").selectAll().where("name", "=", name).executeTakeFirst();
    }
    /**
     * List all projects.
     *
     * @returns Array of projects
     */
    async listAll() {
        return this.db.selectFrom("projects").selectAll().orderBy("created_at", "desc").execute();
    }
    /**
     * Update a project.
     *
     * @param id - Project UUID
     * @param data - Fields to update
     * @returns Updated project
     */
    async update(id, data) {
        return this.db
            .updateTable("projects")
            .set(Object.assign(Object.assign({}, data), { updated_at: new Date().toISOString() }))
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
    async delete(id) {
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
    async findOrCreate(name, rootPath) {
        const existing = await this.findByName(name);
        if (existing)
            return existing;
        return this.create({
            name,
            description: null,
            root_path: rootPath !== null && rootPath !== void 0 ? rootPath : null,
        });
    }
}
exports.ProjectRepository = ProjectRepository;
