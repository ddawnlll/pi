/**
 * Skill Output Artifact - P11.E
 *
 * Attaches skill execution outputs to plan-intake, proposal, or remediation
 * artifacts. This enables downstream consumers (UI, API, orchestration) to
 * reference skill outputs as evidence or context.
 *
 * Artifact types supported:
 * - plan-intake: Skill output is attached as context during plan ingestion
 * - proposal: Skill output supports a remediation proposal
 * - remediation: Skill output is recorded as remediation evidence
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SkillExecutionOutput } from "./skill-runner.js";

// ---------------------------------------------------------------------------
// Artifact Types
// ---------------------------------------------------------------------------

/**
 * Types of artifacts that can receive skill output.
 */
export type SkillArtifactType = "plan_intake" | "proposal" | "remediation";

/**
 * Status of a skill output artifact.
 */
export type SkillArtifactStatus = "attached" | "pending" | "failed";

// ---------------------------------------------------------------------------
// Artifact Data
// ---------------------------------------------------------------------------

/**
 * A skill output artifact attached to an artifact target.
 */
export interface SkillOutputArtifact {
	/** Unique artifact identifier */
	id: string;
	/** Type of artifact this is attached to */
	artifactType: SkillArtifactType;
	/** Identifier of the parent artifact (plan ID, proposal ID, etc.) */
	parentId: string;
	/** Skill name that produced the output */
	skillName: string;
	/** ISO-8601 timestamp when attached */
	attachedAt: string;
	/** Status of the attachment */
	status: SkillArtifactStatus;
	/** The skill execution output */
	output: SkillExecutionOutput;
	/** Optional metadata for the attachment */
	metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Plan-Intake Artifact
// ---------------------------------------------------------------------------

/**
 * Skill output attached to a plan intake context.
 *
 * This is used when a skill's output provides context or validation
 * during plan ingestion — e.g., a "web-fetch" skill fetches documentation
 * that shapes plan execution.
 */
export interface PlanIntakeSkillArtifact {
	/** Plan execution ID */
	planExecutionId: string;
	/** Skill output artifacts attached to this intake */
	skillArtifacts: SkillOutputArtifact[];
}

// ---------------------------------------------------------------------------
// Proposal Artifact
// ---------------------------------------------------------------------------

/**
 * Skill output attached to a remediation proposal.
 *
 * Used when skill execution produces evidence or analysis
 * that supports a proposed remediation.
 */
export interface ProposalSkillArtifact {
	/** Proposal identifier */
	proposalId: string;
	/** Health signal ID this proposal belongs to */
	signalId?: string;
	/** Skill output artifacts attached to this proposal */
	skillArtifacts: SkillOutputArtifact[];
}

// ---------------------------------------------------------------------------
// Remediation Artifact
// ---------------------------------------------------------------------------

/**
 * Skill output attached to a remediation execution record.
 *
 * Used when a skill's output is recorded as evidence during
 * remediation execution (e.g., a diagnostic skill's output
 * that informed the remediation steps).
 */
export interface RemediationSkillArtifact {
	/** Remediation run ID */
	remediationId: string;
	/** Skill output artifacts attached to this remediation */
	skillArtifacts: SkillOutputArtifact[];
}

// ---------------------------------------------------------------------------
// Artifact Store
// ---------------------------------------------------------------------------

/**
 * Stores and retrieves skill output artifacts.
 *
 * Artifacts are persisted as JSON files in the execution archive
 * directory, making them available to downstream API/UI workspaces.
 */
export class SkillOutputArtifactStore {
	private readonly archiveDir: string;
	private artifacts: Map<string, SkillOutputArtifact>;

	private static readonly ARTIFACTS_SUBDIR = "skill-outputs";

	/**
	 * Create a skill output artifact store.
	 *
	 * @param archiveDir - Base directory for artifact storage (typically
	 *                     `.pi/executions` or `.pi/cache`)
	 */
	constructor(archiveDir: string) {
		this.archiveDir = archiveDir;
		this.artifacts = new Map();
	}

	/**
	 * Attach a skill output to an artifact.
	 *
	 * @param artifactType - Type of artifact
	 * @param parentId - Parent artifact identifier
	 * @param skillName - Name of the skill
	 * @param output - Skill execution output
	 * @param metadata - Optional metadata
	 * @returns The created artifact
	 */
	attach(
		artifactType: SkillArtifactType,
		parentId: string,
		skillName: string,
		output: SkillExecutionOutput,
		metadata?: Record<string, unknown>,
	): SkillOutputArtifact {
		const id = `${artifactType}_${parentId}_${skillName}_${Date.now()}`;
		const artifact: SkillOutputArtifact = {
			id,
			artifactType,
			parentId,
			skillName,
			attachedAt: new Date().toISOString(),
			status: "attached",
			output,
			metadata,
		};

		this.artifacts.set(id, artifact);
		this.persist(artifact);
		return artifact;
	}

	/**
	 * Remove an attached artifact.
	 *
	 * @param artifactId - ID of the artifact to remove
	 * @returns Whether the artifact was found and removed
	 */
	detach(artifactId: string): boolean {
		return this.artifacts.delete(artifactId);
	}

	/**
	 * Get artifacts for a given parent and type.
	 *
	 * @param parentId - Parent artifact identifier
	 * @param artifactType - Type of artifact (optional filter)
	 * @returns Array of matching artifacts
	 */
	getByParent(parentId: string, artifactType?: SkillArtifactType): SkillOutputArtifact[] {
		const results: SkillOutputArtifact[] = [];
		for (const artifact of this.artifacts.values()) {
			if (artifact.parentId === parentId) {
				if (artifactType === undefined || artifact.artifactType === artifactType) {
					results.push(artifact);
				}
			}
		}
		return results;
	}

	/**
	 * Get a specific artifact by ID.
	 *
	 * @param artifactId - Artifact ID
	 * @returns The artifact, or undefined
	 */
	getById(artifactId: string): SkillOutputArtifact | undefined {
		return this.artifacts.get(artifactId);
	}

	/**
	 * Get all artifacts for a given skill.
	 *
	 * @param skillName - Skill name
	 * @returns Array of artifacts
	 */
	getBySkill(skillName: string): SkillOutputArtifact[] {
		const results: SkillOutputArtifact[] = [];
		for (const artifact of this.artifacts.values()) {
			if (artifact.skillName === skillName) {
				results.push(artifact);
			}
		}
		return results;
	}

	/**
	 * Get all stored artifacts.
	 *
	 * @returns Array of all artifacts
	 */
	getAll(): SkillOutputArtifact[] {
		return Array.from(this.artifacts.values());
	}

	/**
	 * Persist a single artifact to disk.
	 */
	private persist(artifact: SkillOutputArtifact): void {
		try {
			const artifactsDir = resolve(this.archiveDir, SkillOutputArtifactStore.ARTIFACTS_SUBDIR);
			if (!existsSync(artifactsDir)) {
				mkdirSync(artifactsDir, { recursive: true });
			}
			const filePath = join(artifactsDir, `${artifact.id}.json`);
			writeFileSync(filePath, JSON.stringify(artifact, null, 2), "utf-8");
		} catch {
			// Persist silently; data remains in memory
		}
	}

	/**
	 * Create a plan-intake artifact with attached skill outputs.
	 *
	 * @param planExecutionId - Plan execution ID
	 * @param artifacts - Skill output artifacts to attach
	 * @returns PlanIntakeSkillArtifact
	 */
	createPlanIntakeArtifact(planExecutionId: string, artifacts: SkillOutputArtifact[]): PlanIntakeSkillArtifact {
		return {
			planExecutionId,
			skillArtifacts: artifacts,
		};
	}

	/**
	 * Create a proposal artifact with attached skill outputs.
	 *
	 * @param proposalId - Proposal identifier
	 * @param skillArtifacts - Skill output artifacts to attach
	 * @param signalId - Optional health signal ID
	 * @returns ProposalSkillArtifact
	 */
	createProposalArtifact(
		proposalId: string,
		skillArtifacts: SkillOutputArtifact[],
		signalId?: string,
	): ProposalSkillArtifact {
		return {
			proposalId,
			signalId,
			skillArtifacts,
		};
	}

	/**
	 * Create a remediation artifact with attached skill outputs.
	 *
	 * @param remediationId - Remediation run ID
	 * @param skillArtifacts - Skill output artifacts to attach
	 * @returns RemediationSkillArtifact
	 */
	createRemediationArtifact(remediationId: string, skillArtifacts: SkillOutputArtifact[]): RemediationSkillArtifact {
		return {
			remediationId,
			skillArtifacts,
		};
	}

	/**
	 * Load artifacts from disk for a specific parent.
	 *
	 * @param parentId - Parent identifier
	 * @returns Loaded artifacts
	 */
	loadFromDisk(parentId: string): SkillOutputArtifact[] {
		const results: SkillOutputArtifact[] = [];
		try {
			const artifactsDir = resolve(this.archiveDir, SkillOutputArtifactStore.ARTIFACTS_SUBDIR);
			if (!existsSync(artifactsDir)) return results;

			const files = readdirSync(artifactsDir);
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const content = readFileSync(join(artifactsDir, file), "utf-8");
					const artifact = JSON.parse(content) as SkillOutputArtifact;
					if (artifact.parentId === parentId) {
						this.artifacts.set(artifact.id, artifact);
						results.push(artifact);
					}
				} catch {
					// Skip corrupted files
				}
			}
		} catch {
			// Directory may not exist
		}
		return results;
	}
}
