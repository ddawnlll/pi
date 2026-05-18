/**
 * Plan Checker Agent — Runs an agent session to analyze plan feasibility.
 *
 * The checker agent reads the full plan content and produces a structured
 * analysis report covering:
 * - Risks and blockers
 * - Missing prerequisites
 * - Dependency issues
 * - Resource requirements
 * - Feasibility assessment
 * - Suggestions
 *
 * This runs AFTER the structural validations (parse, stack, safety, DAG)
 * and BEFORE execution. It provides a human-readable "second opinion"
 * from an LLM agent.
 */

import { PiLogger } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity of a checker agent finding. */
export type CheckerSeverity = "critical" | "warning" | "info";

/** A single finding from the checker agent analysis. */
export interface CheckerFinding {
	severity: CheckerSeverity;
	category: string;
	title: string;
	description: string;
	suggestion?: string;
	/** Workspace IDs this finding applies to, if any */
	workspaceIds?: string[];
}

/** Structured output from the checker agent. */
export interface CheckerAnalysis {
	/** Overall feasibility assessment */
	verdict: "safe" | "risky" | "blocked";
	/** One-line summary */
	summary: string;
	/** Detailed findings */
	findings: CheckerFinding[];
	/** Free-form narrative from the checker */
	narrative: string;
	/** Whether analysis was cached from a previous run */
	cached: boolean;
	/** Timestamp */
	analyzedAt: string;
}

/** Full response from the checker agent endpoint. */
export interface CheckerAgentResponse {
	success: boolean;
	analysis?: CheckerAnalysis;
	error?: string;
}

// ---------------------------------------------------------------------------
// Analysis prompt
// ---------------------------------------------------------------------------

const CHECKER_SYSTEM_PROMPT = `You are an expert plan reviewer for the Pi autonomous coding agent platform.
Your job is to analyze implementation plans and assess their feasibility, risks, and completeness.

Analyze the plan and output a JSON object with this exact structure:
{
  "verdict": "safe" | "risky" | "blocked",
  "summary": "One-line summary of the assessment",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "e.g. dependency, prerequisite, risk, resource, clarity",
      "title": "Short title",
      "description": "Detailed explanation",
      "suggestion": "Optional suggestion to fix",
      "workspaceIds": ["7.A", "7.B"]
    }
  ],
  "narrative": "2-3 paragraph free-form analysis covering overall approach, risks, timeline estimate, and recommendations"
}

Focus on:
1. Missing prerequisites or unclear dependencies
2. Risk of merge conflicts between workspaces
3. Whether the implementation order makes sense
4. Whether acceptance criteria are well-defined and testable
5. Resource constraints (memory, API keys, external services)
6. Whether the plan is self-contained or needs external context
7. Any circular or missing dependencies in the DAG

Be thorough but concise. Output ONLY valid JSON, no markdown or code blocks.`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const logger = new PiLogger({ module: "CheckerAgent" });

/**
 * Configuration for the checker agent.
 */
export interface CheckerAgentConfig {
	/** LLM model to use (default: project default) */
	model?: string;
	/** Provider to use (default: project default) */
	provider?: string;
}

/**
 * Run checker agent analysis on a plan.
 *
 * @param planContent - Full plan markdown content
 * @param workspaceRoot - Project root path (for context)
 * @param config - Optional model/provider config
 * @returns Analysis result
 */
export async function runCheckerAgent(
	planContent: string,
	workspaceRoot: string,
	config?: CheckerAgentConfig,
): Promise<CheckerAnalysis> {
	logger.info("Running checker agent analysis on plan");

	const startTime = Date.now();

	// Build the user prompt with plan content and project context
	const userPrompt = buildCheckerPrompt(planContent, workspaceRoot);

	// Call the LLM
	const result = await callCheckerLLM(userPrompt, config);

	logger.info(`Checker agent analysis completed in ${Date.now() - startTime}ms`);

	return result;
}

/**
 * Build the prompt for the checker agent.
 */
function buildCheckerPrompt(planContent: string, workspaceRoot: string): string {
	// Truncate plan content if too long
	const maxPlanLength = 30_000;
	const truncatedPlan =
		planContent.length > maxPlanLength
			? `${planContent.slice(0, maxPlanLength)}\n\n[...plan truncated...]`
			: planContent;

	return `Analyze the following implementation plan for feasibility, risks, and completeness.

Project root: ${workspaceRoot}

--- PLAN START ---
${truncatedPlan}
--- PLAN END ---`;
}

/**
 * Call the LLM and parse the structured response.
 */
async function callCheckerLLM(userPrompt: string, config?: CheckerAgentConfig): Promise<CheckerAnalysis> {
	try {
		const ai = await import("@earendil-works/pi-ai");
		const model = ai.getModel("openai", (config?.model || "gpt-4o") as "gpt-4o");

		const now = Date.now();
		const messages: import("@earendil-works/pi-ai").Message[] = [
			{ role: "user", content: `${CHECKER_SYSTEM_PROMPT}\n\n${userPrompt}`, timestamp: now },
		];

		const stream = ai.streamSimple(model, { messages });

		let fullContent = "";
		for await (const event of stream) {
			if (event.type === "text_delta") {
				fullContent += event.delta;
			}
		}

		// If empty, try done event content
		if (!fullContent.trim()) {
			return {
				verdict: "risky",
				summary: "LLM returned empty response",
				findings: [],
				narrative:
					"The checker agent received an empty response from the LLM. This may indicate a provider issue or timeout.",
				cached: false,
				analyzedAt: new Date().toISOString(),
			};
		}

		// Try to parse JSON — strip markdown code fences if present
		const jsonMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		const jsonStr = jsonMatch ? jsonMatch[1] : fullContent;

		// Attempt to extract JSON from free-form text if raw parse fails
		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(jsonStr);
		} catch {
			// Fallback: try to find a top-level { } object in the text
			const objMatch = fullContent.match(/{[\s\S]*?"verdict"[\s\S]*?}/);
			if (objMatch) {
				try {
					parsed = JSON.parse(objMatch[0]);
				} catch {
					throw new Error(
						`Cannot parse LLM response as JSON. Raw content (${fullContent.length} chars): ${fullContent.slice(0, 500)}`,
					);
				}
			} else {
				throw new Error(
					`Cannot parse LLM response as JSON. Raw content (${fullContent.length} chars): ${fullContent.slice(0, 500)}`,
				);
			}
		}

		return {
			verdict: (parsed.verdict as "safe" | "risky" | "blocked") || "risky",
			summary: (parsed.summary as string) || "Analysis completed",
			findings: (parsed.findings as CheckerFinding[]) || [],
			narrative: (parsed.narrative as string) || "",
			cached: false,
			analyzedAt: new Date().toISOString(),
		};
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		logger.error("Checker agent LLM call failed", { error: errMsg });
		return {
			verdict: "risky",
			summary: "LLM analysis failed, falling back to structural validation only",
			findings: [
				{
					severity: "warning",
					category: "analysis",
					title: "Checker agent analysis failed",
					description: `Could not complete LLM-based analysis: ${errMsg}`,
					suggestion: "Review the plan manually or check LLM provider configuration",
				},
			],
			narrative:
				"The automated checker agent could not complete its analysis due to an LLM error. The structural validation results (parsing, stack, safety, DAG) are still available.",
			cached: false,
			analyzedAt: new Date().toISOString(),
		};
	}
}
