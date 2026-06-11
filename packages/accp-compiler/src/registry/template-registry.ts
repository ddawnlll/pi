/**
 * ACCP Template Registry
 *
 * Loads and manages compact ACCP prompt contracts.
 * Prompt contracts are loaded from the template registry
 * and rendered into compact prompts for worker injection.
 *
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** A single prompt contract template. */
export interface AccpPromptContract {
	/** Template ID (e.g. "bsr", "fpr", "tvr", "repair"). */
	id: string;
	/** Human-readable description. */
	description: string;
	/** Template content (raw text, may contain placeholders). */
	template: string;
	/** Whether this template is loaded from the built-in registry or custom source. */
	source: "builtin" | "file" | "custom";
}

// ---------------------------------------------------------------------------
// Default ACCP_V2_PROMPTS_ROOT
// ---------------------------------------------------------------------------

/** Default root path for ACCP v2.0 prompt contracts. */
export const ACCP_PROMPTS_ROOT = "accp_v2_0_package/prompts" as const;

/** File name suffix for prompt contract text files. */
const PROMPT_FILE_SUFFIX = "_prompt_contract.txt";

// ---------------------------------------------------------------------------
// Built-in compact prompt contracts (anti-pattern AP-P49-004 prevention)
// These are compact — not full ACCP spec prose. They fit within token budgets.
// ---------------------------------------------------------------------------

const BUILTIN_CONTRACTS: AccpPromptContract[] = [
	{
		id: "bsr",
		description: "Bug Search Report contract — structured investigation output",
		source: "builtin",
		template: `You are producing an ACCP Bug Search Report (BSR).

OUTPUT CONSTRAINTS:
- Report format: ACCP-YAML
- Must include: accp_version, source_format, report section (id, type, family)
- Sections: bug_findings (one per identified bug)
- Each finding requires: category, severity, description, evidence_refs

AUTHORITY:
This report is evidence-only. It does not authorize mutation.
Route signals from this report are advisory.`,
	},
	{
		id: "fpr",
		description: "Fix Patch Report contract — structured fix output",
		source: "builtin",
		template: `You are producing an ACCP Fix Patch Report (FPR).

OUTPUT CONSTRAINTS:
- Report format: ACCP-YAML
- Must include: accp_version, source_format, report section
- Sections: fix_actions (one per fix), changed_files
- Evidence required for each fix action

AUTHORITY:
This report is evidence-only. Path changes require write gate approval.`,
	},
	{
		id: "tvr",
		description: "Test Validation Report contract — structured test output",
		source: "builtin",
		template: `You are producing an ACCP Test Validation Report (TVR).

OUTPUT CONSTRAINTS:
- Report format: ACCP-YAML
- Must include: accp_version, source_format, report section
- Sections: validation_summary, command_results
- Command results require: commandRef, exit_code, output_excerpt
- False positive guards: watchModeForbidden, noTestsFoundIsFailure

AUTHORITY:
This report is evidence-only. Passing tests do not authorize mutation.`,
	},
	{
		id: "prr",
		description: "Promotion Readiness Report contract — promotion gate output",
		source: "builtin",
		template: `You are producing an ACCP Promotion Readiness Report (PRR).

OUTPUT CONSTRAINTS:
- Report format: ACCP-YAML
- Must include: accp_version, source_format, report section
- Sections: promotion_decision, evidence_summary
- Promotion requires all waves passed, gauntlets passed, no open blockers

AUTHORITY:
This report is evidence-only. It does not authorize promotion.
Promotion is a runtime gate decision.`,
	},
	{
		id: "repair",
		description: "Repair prompt contract — canonicalization only, no evidence invention",
		source: "builtin",
		template: `You are normalizing an ACCP report.

CONSTRAINTS:
- You may fix structural issues (indentation, missing required fields)
- You may NOT: invent evidence, fabricate command results, manufacture passing verdicts
- You may NOT: remove blocking findings
- If a report has fatal errors, record them — do not hide them
- If evidence is missing, record it as missing — do not invent it

AUTHORITY:
This is a canonicalization pass. It does not generate new evidence.`,
	},
];

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

/**
 * In-memory template registry.
 */
export class AccpTemplateRegistry {
	private contracts: Map<string, AccpPromptContract> = new Map();

	constructor() {
		// Load built-in contracts
		for (const contract of BUILTIN_CONTRACTS) {
			this.contracts.set(contract.id, contract);
		}
	}

	/**
	 * Get a prompt contract by ID.
	 */
	get(id: string): AccpPromptContract | undefined {
		return this.contracts.get(id);
	}

	/**
	 * Register a custom prompt contract.
	 */
	register(contract: AccpPromptContract): void {
		this.contracts.set(contract.id, contract);
	}

	/**
	 * Load a prompt contract from the ACCP v2.0 prompts directory.
	 */
	loadFromFile(baseDir: string, contractId: string): AccpPromptContract | undefined {
		try {
			const filePath = resolve(baseDir, `${contractId}${PROMPT_FILE_SUFFIX}`);
			const content = readFileSync(filePath, "utf-8");
			const contract: AccpPromptContract = {
				id: contractId,
				description: `Loaded from ${filePath}`,
				template: content,
				source: "file",
			};
			this.contracts.set(contractId, contract);
			return contract;
		} catch {
			return undefined;
		}
	}

	/**
	 * Get all registered contract IDs.
	 */
	listIds(): string[] {
		return Array.from(this.contracts.keys());
	}
}

/** Default singleton registry. */
export const defaultTemplateRegistry = new AccpTemplateRegistry();
