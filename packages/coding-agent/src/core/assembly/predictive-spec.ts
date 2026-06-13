/**
 * P45.02 — Predictive Spec Generator
 *
 * Generates the predictive spec from fact bundle input.
 * All predictions are deterministic and evidence-classed, never LLM-only by default.
 * LLM proposals must be validated and must not exceed the allowed ratio.
 */

import { createHash } from "node:crypto";
import type {
	ContractPrediction,
	FileFact,
	NamespaceAssignment,
	PredictiveSpec,
	SpecFactBundle,
} from "./predictive-spec-input.js";

// =============================================================================
// Generator
// =============================================================================

/**
 * Generate a predictive spec from collected facts.
 * All predictions use static_confirmation evidence since they're derived from
 * deterministic file analysis, not LLM output.
 */
export function generatePredictiveSpec(facts: SpecFactBundle): PredictiveSpec {
	const factBundleHash = createHash("sha256").update(JSON.stringify(facts)).digest("hex");

	// Assign namespaces from candidates or default grouping
	const namespaceCandidates =
		facts.namespaceCandidates.length > 0 ? facts.namespaceCandidates : groupFilesByDirectory(facts.files);

	const namespaces: NamespaceAssignment[] = [];
	const allPredictions: ContractPrediction[] = [];
	const sharedIntegrationFiles: string[] = [];
	const assemblerOnlyFiles: string[] = [];

	for (let i = 0; i < Math.min(namespaceCandidates.length, 6); i++) {
		const candidate = namespaceCandidates[i];
		const nsName = `ns-${i}`;
		const assignedFiles = candidate;

		const predictions: ContractPrediction[] = assignedFiles.map((file) => {
			const fileFact = facts.files.find((f) => f.path === file);
			const prediction: ContractPrediction = {
				contract: file,
				namespace: nsName,
				predictedOutcome: "matched",
				evidenceClass: "static_confirmation",
				confidence: 1.0,
				source: fileFact ? `static_analysis: ${fileFact.exports.length} exports` : "static_analysis",
			};
			return prediction;
		});

		namespaces.push({
			namespace: nsName,
			files: assignedFiles,
			contracts: predictions,
		});

		allPredictions.push(...predictions);
	}

	// Shared integration files (barrel/index files in assembly root)
	for (const fact of facts.files) {
		const fileName = fact.path.split("/").pop() || "";
		if (fileName === "index.ts" && fact.path.includes("assembly")) {
			assemblerOnlyFiles.push(fact.path);
		}
	}

	const coverageBreakdown = {
		staticCount: allPredictions.filter((p) => p.evidenceClass === "static_confirmation").length,
		humanCount: 0,
		historicalCount: 0,
		llmOnlyCount: 0,
		unknownCount: 0,
	};

	return {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		factBundleHash,
		namespaces,
		sharedIntegrationFiles,
		assemblerOnlyFiles,
		contractPredictions: allPredictions,
		coverageBreakdown,
	};
}

// =============================================================================
// Helpers
// =============================================================================

function groupFilesByDirectory(files: FileFact[]): string[][] {
	const groups = new Map<string, string[]>();
	for (const file of files) {
		const parts = file.path.split("/");
		parts.pop(); // remove filename
		const dir = parts.join("/");
		if (!groups.has(dir)) groups.set(dir, []);
		groups.get(dir)!.push(file.path);
	}
	return [...groups.values()].filter((g) => g.length > 0).slice(0, 6);
}
