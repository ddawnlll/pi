/**
 * ACCP Built-in Prompt Templates
 *
 * Pre-loaded compact prompt contracts for the ACCP compiler.
 * These are loaded into the template registry at startup.
 *
 * @packageDocumentation
 */

import { AccpTemplateRegistry } from "./template-registry.js";

/**
 * Load all built-in templates into a registry.
 */
export function loadBuiltinTemplates(_registry: AccpTemplateRegistry): void {
	// Built-in templates are registered by the constructor of AccpTemplateRegistry.
	// This function exists as a hook for future auto-loading.
	// Currently all built-in contracts are registered at construction.
}

/**
 * Get the default ACCP template registry with all builtin templates loaded.
 */
export function createDefaultTemplateRegistry(): AccpTemplateRegistry {
	return new AccpTemplateRegistry();
}

/**
 * Expanded template contracts for non-gate-critical families.
 * These are registered but not accidentally promoted to blocking runtime authority.
 */
export const EXPANDED_TEMPLATES: Record<string, string> = {
	// Feature family templates (FER, FDR, FCR, FIR, FGR)
	fer: `Feature Exploration Report (FER).
Purpose: Explore a feature space.
Sections: exploration_scope, findings, recommendations.
Authority: Evidence-only. Does not authorize implementation.`,

	fdr: `Feature Design Report (FDR).
Purpose: Design a feature solution.
Sections: design_overview, architecture, interfaces.
Authority: Evidence-only. Design does not authorize mutation.`,

	fcr: `Feature Contract Report (FCR).
Purpose: Define a feature contract.
Sections: contract_scope, acceptance_criteria, constraints.
Authority: Evidence-only. Contract does not authorize execution.`,

	fir: `Feature Implementation Report (FIR).
Purpose: Report on feature implementation status.
Sections: implementation_progress, completed_items, remaining.
Authority: Evidence-only. Status report is not execution authority.`,

	fgr: `Feature Gate Report (FGR).
Purpose: Gate a feature for promotion.
Sections: gate_criteria, pass_fail, blocking_issues.
Authority: Evidence-only. Gate verdict is diagnostic input.`,

	// Writing family templates (WBR, WDR, WER, WQR)
	wbr: `Writing Brief Report (WBR).
Purpose: Define writing brief.
Sections: brief_description, target_audience, tone.
Authority: Evidence-only.`,

	wdr: `Writing Draft Report (WDR).
Purpose: Document writing draft.
Sections: draft_content, revision_notes.
Authority: Evidence-only.`,

	wer: `Writing Edit Report (WER).
Purpose: Report on editing pass.
Sections: edits_made, original_sections, changes.
Authority: Evidence-only.`,

	wqr: `Writing Quality Review Report (WQR).
Purpose: Quality review of written content.
Sections: review_criteria, findings, score.
Authority: Evidence-only.`,

	// Coordination templates (ECR, DCR)
	ecr: `Evidence Capsule Report (ECR).
Purpose: Package evidence for review.
Sections: evidence_items, provenance, summary.
Authority: Evidence-only. Evidence does not authorize action.`,

	dcr: `Decision / Conflict Report (DCR).
Purpose: Record a decision or conflict.
Sections: context, decision, rationale, alternatives.
Authority: Evidence-only. Decision does not authorize mutation.`,

	// Bugfix templates (BRR, RCA, FVR)
	brr: `Bug Reproduction Report (BRR).
Purpose: Document bug reproduction steps.
Sections: reproduction_steps, environment, observed_behavior.
Authority: Evidence-only.`,

	rca: `Root Cause Analysis Report (RCA).
Purpose: Analyze root cause of a bug.
Sections: symptom, root_cause, impact, recommended_fix.
Authority: Evidence-only. Analysis does not authorize mutation.`,

	fvr: `Fix Validation Report (FVR).
Purpose: Validate that a fix resolves the issue.
Sections: fix_description, validation_steps, result.
Authority: Evidence-only.`,
};

/**
 * Register all expanded templates into a registry.
 */
export function registerExpandedTemplates(registry: AccpTemplateRegistry): void {
	for (const [id, template] of Object.entries(EXPANDED_TEMPLATES)) {
		registry.register({
			id,
			description: `Expanded template: ${id}`,
			template,
			source: "builtin",
		});
	}
}
