/**
 * Plan Factory Engine — P17.A
 *
 * Converts approved proposals into executable phase plans.
 * Analyzes proposal scope, generates workstream definitions,
 * creates dependency graphs, computes batch layouts, validates
 * output, and writes phase markdown + JSON contract files.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Proposal, ProposalStore } from "../proposals/types.js";
import type { TemplateData } from "./template.js";
import { MasterTemplateIntegration } from "./template.js";
import type {
	PlanExecutionContract,
	PlanFactoryConfig,
	PlanFactoryInput,
	PlanFactoryOutput,
	ProposalAnalysis,
	ValidationResult2,
	WorkstreamDef,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: PlanFactoryConfig = {
	outputDir: "docs/pi/phases",
	contractDir: ".pi/plans/generated",
	maxWorkstreams: 8,
	templateVersion: "2.5.1",
	validateBeforeReturn: true,
	enableLLMContent: true,
};

// ---------------------------------------------------------------------------
// PlanFactory
// ---------------------------------------------------------------------------

export class PlanFactory {
	private config: PlanFactoryConfig;
	private templateIntegration: MasterTemplateIntegration;
	private proposalStore?: ProposalStore;

	constructor(
		templateIntegration?: MasterTemplateIntegration,
		config?: Partial<PlanFactoryConfig>,
		proposalStore?: ProposalStore,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.templateIntegration = templateIntegration ?? new MasterTemplateIntegration();
		this.proposalStore = proposalStore;
	}

	// -----------------------------------------------------------------------
	// Core
	// -----------------------------------------------------------------------

	/**
	 * Create a plan from proposal input.
	 *
	 * If a proposal is provided directly, it takes precedence. Otherwise,
	 * the factory will try to fetch the proposal from its store using
	 * `input.proposalId`.
	 */
	async createPlan(input: PlanFactoryInput, proposal?: Proposal): Promise<PlanFactoryOutput> {
		// Resolve the proposal
		let resolvedProposal: Proposal | null = proposal ?? null;
		if (!resolvedProposal && this.proposalStore && input.proposalId) {
			resolvedProposal = await this.proposalStore.getById(input.proposalId);
		}
		if (!resolvedProposal) {
			throw new Error(
				`Cannot create plan: no proposal provided and no ProposalStore configured. ` +
					`Either pass a proposal directly or configure a ProposalStore with proposalId "${input.proposalId}".`,
			);
		}

		const phaseId = await this.computePhaseId();
		const phaseTitle = this.computePhaseTitle(resolvedProposal);

		// Analyze the proposal
		const analysis = this.analyzeProposal(resolvedProposal);

		// Generate workstreams
		const workstreams = this.generateWorkstreams(analysis, resolvedProposal, phaseId);

		// Generate dependencies
		const dependencies = this.generateDependencies(workstreams);

		// Generate batches
		const batches = this.generateBatches(workstreams, dependencies);

		// Build contract
		const jsonContract = this.buildJsonContract({
			id: phaseId,
			title: phaseTitle,
			workstreams,
			dependencies,
			batches,
		});

		// Resolve output paths
		const { markdownPath, contractPath } = await this.resolveOutputPaths(phaseId, phaseTitle);

		// Populate template
		const template = await this.templateIntegration.loadTemplate();
		const templateData: TemplateData = {
			phase: { id: phaseId, title: phaseTitle, purpose: resolvedProposal.description },
			workstreams,
			dependencies,
			batches,
			riskRegister: [],
			rollback: { triggerConditions: [], procedure: [] },
			nextPhase: { id: "", title: "" },
			hardRequirements: ["npm only", "no git push"],
			executionPolicies: {},
		};
		const markdown = this.templateIntegration.populateFullTemplate(template, templateData, phaseId, phaseTitle);

		// Write files
		await this.writeMarkdown(markdownPath, markdown);
		await this.writeContract(contractPath, jsonContract);

		// Build output
		const output: PlanFactoryOutput = {
			phaseId,
			phaseTitle,
			markdownPath,
			jsonContract,
			workstreams,
			batches,
			generatedAt: new Date().toISOString(),
			confidence: analysis.evidenceQuality,
			validationResults: [],
		};

		// Validate
		if (this.config.validateBeforeReturn) {
			output.validationResults = await this.validatePlan(output);
		}

		return output;
	}

	// -----------------------------------------------------------------------
	// Proposal Analysis
	// -----------------------------------------------------------------------

	/**
	 * Analyze a proposal to determine scope, complexity, and risk.
	 */
	private analyzeProposal(proposal: Proposal): ProposalAnalysis {
		const evidenceCount = proposal.evidence?.memoryIds?.length ?? 0;
		const description = proposal.description;
		const wordCount = description.split(/\s+/).length;

		// Estimate workstreams based on description length and evidence
		const estimatedWorkstreams = Math.max(
			1,
			Math.min(this.config.maxWorkstreams, Math.ceil(wordCount / 200) + Math.floor(evidenceCount / 3)),
		);

		// Compute evidence quality
		const evidenceQuality = Math.min(1, evidenceCount / 10);

		return {
			scope: description.substring(0, 200),
			estimatedWorkstreams,
			affectedSystems: this.extractAffectedSystems(description),
			risk: proposal.risk.level,
			evidenceQuality,
		};
	}

	/**
	 * Extract affected system names from proposal text.
	 */
	private extractAffectedSystems(text: string): string[] {
		const known = [
			"api",
			"dashboard",
			"memory",
			"goals",
			"proposal",
			"policy",
			"audit",
			"orchestrator",
			"executor",
			"scheduler",
			"worktree",
			"queue",
		];
		return known.filter((s) => text.toLowerCase().includes(s));
	}

	// -----------------------------------------------------------------------
	// Workstream Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate workstream definitions from proposal analysis.
	 */
	private generateWorkstreams(analysis: ProposalAnalysis, _proposal: Proposal, phaseId: string): WorkstreamDef[] {
		const count = Math.min(analysis.estimatedWorkstreams, this.config.maxWorkstreams);
		const workstreams: WorkstreamDef[] = [];

		for (let i = 0; i < count; i++) {
			const id = this.generateWorkstreamId(phaseId, i);
			workstreams.push({
				id,
				title: `Workstream ${id}`,
				goal: `Implement ${analysis.scope.substring(0, 80)} — part ${i + 1}`,
				acceptanceCriteria: [`${id} implementation complete`, `${id} tests pass`],
				dependencies: [],
				fileScope: [],
				isolationNotes: "",
				queuePriority: i === 0 ? "critical" : i < 3 ? "high" : "normal",
				riskLevel: analysis.risk,
			});
		}

		return workstreams;
	}

	/**
	 * Generate a workstream ID like "P21.A", "P21.B".
	 */
	private generateWorkstreamId(phaseId: string, index: number): string {
		const letter = String.fromCharCode(65 + index); // A, B, C, ...
		return `${phaseId}.${letter}`;
	}

	// -----------------------------------------------------------------------
	// Dependency & Batch Generation
	// -----------------------------------------------------------------------

	/**
	 * Generate dependency edges between workstreams.
	 */
	private generateDependencies(
		workstreams: WorkstreamDef[],
	): Array<{ from: string; to: string; type: "blocking" | "informational" }> {
		const deps: Array<{ from: string; to: string; type: "blocking" | "informational" }> = [];

		// Simple heuristic: each workstream depends on the previous one
		// (more sophisticated analysis would use file scope overlap)
		for (let i = 1; i < workstreams.length; i++) {
			deps.push({
				from: workstreams[i - 1].id,
				to: workstreams[i].id,
				type: "blocking",
			});
		}

		return deps;
	}

	/**
	 * Compute batch layout from workstreams and dependencies.
	 */
	private generateBatches(
		workstreams: WorkstreamDef[],
		dependencies: Array<{ from: string; to: string; type: "blocking" | "informational" }>,
	): string[][] {
		// Build dependency map
		const depMap = new Map<string, Set<string>>();
		for (const ws of workstreams) {
			depMap.set(ws.id, new Set());
		}
		for (const dep of dependencies) {
			if (dep.type === "blocking") {
				depMap.get(dep.to)?.add(dep.from);
			}
		}

		// Kahn's algorithm for topological batches
		const remaining = new Set(workstreams.map((ws) => ws.id));
		const inDegree = new Map<string, number>();
		for (const [id, deps] of depMap) {
			inDegree.set(id, deps.size);
		}

		const batches: string[][] = [];
		while (remaining.size > 0) {
			const batch: string[] = [];
			for (const id of remaining) {
				if ((inDegree.get(id) ?? 0) === 0) {
					batch.push(id);
				}
			}

			if (batch.length === 0) break; // cycle detection

			batches.push(batch);
			for (const id of batch) {
				remaining.delete(id);
				for (const [otherId, deps] of depMap) {
					if (deps.has(id)) {
						deps.delete(id);
						inDegree.set(otherId, (inDegree.get(otherId) ?? 1) - 1);
					}
				}
			}
		}

		return batches;
	}

	// -----------------------------------------------------------------------
	// Phase ID / Title
	// -----------------------------------------------------------------------

	/**
	 * Compute the next available phase ID by scanning existing phase files
	 * in `docs/v2/phases/` or the configured output directory.
	 *
	 * Extracts the highest numeric phase number from existing filenames
	 * matching `phase_p{N}_{slug}.md` and returns the next one.
	 */
	private async computePhaseId(): Promise<string> {
		const phaseDirs = [resolve(this.config.outputDir), resolve("docs/v2/phases")];

		let maxPhaseNum = 13; // P13 is the earliest v2 phase

		for (const dir of phaseDirs) {
			if (!existsSync(dir)) continue;

			try {
				const files = await readdir(dir);
				for (const file of files) {
					const match = file.match(/^phase_p(\d+)_/i);
					if (match) {
						const num = Number.parseInt(match[1], 10);
						if (num > maxPhaseNum) maxPhaseNum = num;
					}
				}
			} catch {
				// Directory doesn't exist or can't be read — skip
			}
		}

		return `P${maxPhaseNum + 1}`;
	}

	/**
	 * Derive a phase title from the proposal type and title.
	 */
	/** @internal exposed for testing */
	public computePhaseTitle(proposal: Proposal): string {
		// Generate a more descriptive title based on proposal type
		const typePrefix: Record<string, string> = {
			plan_proposal: "Plan",
			memory_proposal: "Memory",
			goal_revision_proposal: "Goal Revision",
			autonomy_adjustment_proposal: "Autonomy",
			reflection_proposal: "Reflection",
			safety_proposal: "Safety",
		};

		const prefix = typePrefix[proposal.type] ?? "Phase";
		const title = proposal.title.replace(/^Plan:\s*/i, "").trim();
		return `${prefix}: ${title}`;
	}

	// -----------------------------------------------------------------------
	// JSON Contract
	// -----------------------------------------------------------------------

	/**
	 * Build the execution contract from phase data.
	 */
	private buildJsonContract(phase: {
		id: string;
		title: string;
		workstreams: WorkstreamDef[];
		dependencies: Array<{ from: string; to: string; type: "blocking" | "informational" }>;
		batches: string[][];
	}): PlanExecutionContract {
		return {
			contractVersion: "2.5.1",
			phase: { id: phase.id, title: phase.title },
			workstreams: phase.workstreams,
			dependencies: phase.dependencies,
			batches: phase.batches,
			scaleMode: "experimental_6",
			integrationQueue: true,
			worktreeIsolation: true,
			metadata: {},
		};
	}

	// -----------------------------------------------------------------------
	// I/O
	// -----------------------------------------------------------------------

	/**
	 * Resolve output file paths for markdown and contract.
	 */
	async resolveOutputPaths(
		phaseId: string,
		phaseTitle: string,
	): Promise<{ markdownPath: string; contractPath: string }> {
		const slug = phaseTitle
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
			.substring(0, 60);
		return {
			markdownPath: resolve(this.config.outputDir, `phase_${phaseId.toLowerCase()}_${slug}.md`),
			contractPath: resolve(this.config.contractDir, `${phaseId.toLowerCase()}-contract.json`),
		};
	}

	/**
	 * Write generated markdown to file.
	 */
	async writeMarkdown(path: string, content: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, "utf-8");
	}

	/**
	 * Write JSON contract to file.
	 */
	async writeContract(path: string, contract: PlanExecutionContract): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(contract, null, 2), "utf-8");
	}

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------

	/**
	 * Validate a generated plan output.
	 */
	async validatePlan(output: PlanFactoryOutput): Promise<ValidationResult2[]> {
		const results: ValidationResult2[] = [];

		// Validate markdown
		results.push(...this.validateMarkdown(output.markdownPath));

		// Validate contract
		results.push(...this.validateContract(output.jsonContract));

		// Validate dependencies
		results.push(...this.validateDependencies(output.workstreams, output.jsonContract.dependencies));

		return results;
	}

	/**
	 * Validate the generated markdown file.
	 */
	private validateMarkdown(path: string): ValidationResult2[] {
		const results: ValidationResult2[] = [];
		results.push({ type: "info", component: "markdown", message: `Markdown file: ${path}` });
		return results;
	}

	/**
	 * Validate the execution contract.
	 */
	private validateContract(contract: PlanExecutionContract): ValidationResult2[] {
		return this.templateIntegration.validateContract(contract);
	}

	/**
	 * Validate dependencies are consistent.
	 */
	private validateDependencies(
		workstreams: WorkstreamDef[],
		dependencies: Array<{ from: string; to: string; type: "blocking" | "informational" }>,
	): ValidationResult2[] {
		const results: ValidationResult2[] = [];
		const wsIds = new Set(workstreams.map((w) => w.id));

		for (const dep of dependencies) {
			if (!wsIds.has(dep.from)) {
				results.push({
					type: "error",
					component: "dependency",
					message: `Dependency 'from' ${dep.from} not found in workstreams`,
				});
			}
			if (!wsIds.has(dep.to)) {
				results.push({
					type: "error",
					component: "dependency",
					message: `Dependency 'to' ${dep.to} not found in workstreams`,
				});
			}
		}

		return results;
	}

	// -----------------------------------------------------------------------
	// Configuration
	// -----------------------------------------------------------------------

	setConfig(config: Partial<PlanFactoryConfig>): void {
		this.config = { ...this.config, ...config };
	}

	getConfig(): PlanFactoryConfig {
		return { ...this.config };
	}
}
