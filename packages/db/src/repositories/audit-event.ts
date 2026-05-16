/**
 * Audit Event Repository (P11.M).
 *
 * Provides persistence and query operations for platform audit events.
 * Supports filtering by all platform dimensions including project,
 * capability, workspace, proposal, extension, skill, and memory source.
 *
 * The `data` JSONB column provides future enterprise export support
 * without changing core event semantics.
 */

import type { Kysely } from "kysely";
import type { AuditEvent, Database, NewAuditEvent } from "../types.js";

/**
 * Filter options for querying audit events.
 *
 * Supports filtering by any combination of platform dimensions.
 */
export interface AuditEventFilter {
	/** Filter by action type (e.g., "register_tool", "activate") */
	action?: string;
	/** Filter by action status: allowed, denied, pending-approval, approved, rejected, rollback */
	status?: string;
	/** Filter by action domain: extension, skill, orchestrator, memory, optimizer */
	domain?: string;
	/** Filter by actor identifier */
	actor?: string;
	/** Filter by project UUID */
	projectId?: string;
	/** Filter by capability name */
	capability?: string;
	/** Filter by workspace ID */
	workspaceId?: string;
	/** Filter by proposal UUID */
	proposalId?: string;
	/** Filter by extension ID */
	extensionId?: string;
	/** Filter by skill ID */
	skillId?: string;
	/** Filter by memory source name */
	memorySource?: string;
	/** Return events on or after this ISO timestamp */
	since?: string;
	/** Return events on or before this ISO timestamp */
	until?: string;
	/** Maximum number of events to return (default: 100) */
	limit?: number;
	/** Number of events to skip (default: 0) */
	offset?: number;
	/** Sort order for results (default: "desc") */
	order?: "asc" | "desc";
}

/**
 * Supported audit event status values.
 */
export const AUDIT_EVENT_STATUSES = [
	"allowed",
	"denied",
	"pending-approval",
	"approved",
	"rejected",
	"rollback",
] as const;

/**
 * Supported action domains.
 */
export const AUDIT_EVENT_DOMAINS = ["extension", "skill", "orchestrator", "memory", "optimizer"] as const;

/**
 * Audit event repository
 */
export class AuditEventRepository {
	constructor(private db: Kysely<Database>) {}

	/**
	 * Create a new audit event.
	 *
	 * @param data - Audit event data
	 * @returns Created audit event
	 */
	async create(data: NewAuditEvent): Promise<AuditEvent> {
		return this.db.insertInto("audit_events").values(data).returningAll().executeTakeFirstOrThrow();
	}

	/**
	 * Find audit event by ID.
	 *
	 * @param id - Audit event UUID
	 * @returns Audit event or undefined
	 */
	async findById(id: string): Promise<AuditEvent | undefined> {
		return this.db.selectFrom("audit_events").selectAll().where("id", "=", id).executeTakeFirst();
	}

	/**
	 * Query audit events with flexible filtering.
	 *
	 * Supports all platform dimensions: project, capability, workspace,
	 * proposal, extension, skill, and memory source.
	 *
	 * @param filter - Filter options (all optional)
	 * @returns Array of matching audit events
	 */
	async query(filter: AuditEventFilter = {}): Promise<AuditEvent[]> {
		let query = this.db.selectFrom("audit_events").selectAll();

		if (filter.action) {
			query = query.where("action", "=", filter.action);
		}
		if (filter.status) {
			query = query.where("status", "=", filter.status);
		}
		if (filter.domain) {
			query = query.where("domain", "=", filter.domain);
		}
		if (filter.actor) {
			query = query.where("actor", "=", filter.actor);
		}
		if (filter.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter.capability) {
			query = query.where("capability", "=", filter.capability);
		}
		if (filter.workspaceId) {
			query = query.where("workspace_id", "=", filter.workspaceId);
		}
		if (filter.proposalId) {
			query = query.where("proposal_id", "=", filter.proposalId);
		}
		if (filter.extensionId) {
			query = query.where("extension_id", "=", filter.extensionId);
		}
		if (filter.skillId) {
			query = query.where("skill_id", "=", filter.skillId);
		}
		if (filter.memorySource) {
			query = query.where("memory_source", "=", filter.memorySource);
		}
		if (filter.since) {
			query = query.where("timestamp", ">=", filter.since);
		}
		if (filter.until) {
			query = query.where("timestamp", "<=", filter.until);
		}

		const order = filter.order ?? "desc";
		query = query.orderBy("timestamp", order);

		const limit = filter.limit ?? 100;
		const offset = filter.offset ?? 0;
		query = query.limit(limit).offset(offset);

		return query.execute();
	}

	/**
	 * Count audit events matching a filter.
	 *
	 * @param filter - Filter options
	 * @returns Count of matching events
	 */
	async count(filter: AuditEventFilter = {}): Promise<number> {
		let query = this.db.selectFrom("audit_events").select(this.db.fn.countAll<number>().as("count"));

		if (filter.action) {
			query = query.where("action", "=", filter.action);
		}
		if (filter.status) {
			query = query.where("status", "=", filter.status);
		}
		if (filter.domain) {
			query = query.where("domain", "=", filter.domain);
		}
		if (filter.projectId) {
			query = query.where("project_id", "=", filter.projectId);
		}
		if (filter.workspaceId) {
			query = query.where("workspace_id", "=", filter.workspaceId);
		}
		if (filter.proposalId) {
			query = query.where("proposal_id", "=", filter.proposalId);
		}

		const result = await query.executeTakeFirst();
		return Number(result?.count ?? 0);
	}

	/**
	 * Get events by project.
	 *
	 * @param projectId - Project UUID
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByProject(projectId: string, filter?: Omit<AuditEventFilter, "projectId">): Promise<AuditEvent[]> {
		return this.query({ ...filter, projectId });
	}

	/**
	 * Get events by capability.
	 *
	 * @param capability - Capability name
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByCapability(capability: string, filter?: Omit<AuditEventFilter, "capability">): Promise<AuditEvent[]> {
		return this.query({ ...filter, capability });
	}

	/**
	 * Get events by workspace.
	 *
	 * @param workspaceId - Workspace ID
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByWorkspace(workspaceId: string, filter?: Omit<AuditEventFilter, "workspaceId">): Promise<AuditEvent[]> {
		return this.query({ ...filter, workspaceId });
	}

	/**
	 * Get events by proposal.
	 *
	 * @param proposalId - Proposal UUID
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByProposal(proposalId: string, filter?: Omit<AuditEventFilter, "proposalId">): Promise<AuditEvent[]> {
		return this.query({ ...filter, proposalId });
	}

	/**
	 * Get events by extension.
	 *
	 * @param extensionId - Extension ID
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByExtension(extensionId: string, filter?: Omit<AuditEventFilter, "extensionId">): Promise<AuditEvent[]> {
		return this.query({ ...filter, extensionId });
	}

	/**
	 * Get events by skill.
	 *
	 * @param skillId - Skill ID
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getBySkill(skillId: string, filter?: Omit<AuditEventFilter, "skillId">): Promise<AuditEvent[]> {
		return this.query({ ...filter, skillId });
	}

	/**
	 * Get events by memory source.
	 *
	 * @param memorySource - Memory source name
	 * @param filter - Additional filter options
	 * @returns Array of audit events
	 */
	async getByMemorySource(
		memorySource: string,
		filter?: Omit<AuditEventFilter, "memorySource">,
	): Promise<AuditEvent[]> {
		return this.query({ ...filter, memorySource });
	}

	/**
	 * Get the most recent audit events for a project.
	 *
	 * @param projectId - Project UUID
	 * @param limit - Number of events (default: 50)
	 * @returns Array of audit events
	 */
	async getRecentByProject(projectId: string, limit = 50): Promise<AuditEvent[]> {
		return this.db
			.selectFrom("audit_events")
			.selectAll()
			.where("project_id", "=", projectId)
			.orderBy("timestamp", "desc")
			.limit(limit)
			.execute();
	}

	/**
	 * Delete an audit event by ID.
	 *
	 * @param id - Audit event UUID
	 * @returns True if deleted
	 */
	async delete(id: string): Promise<boolean> {
		const result = await this.db.deleteFrom("audit_events").where("id", "=", id).executeTakeFirst();
		return result.numDeletedRows > 0n;
	}
}
