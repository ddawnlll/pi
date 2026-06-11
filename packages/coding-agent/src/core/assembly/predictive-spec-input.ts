/**
 * P45.01 — Predictive Spec Input Types
 *
 * Defines the machine-readable input types for P45 predictive spec generation.
 * These are consumed by the predictive spec generator and contract freezer.
 */

// =============================================================================
// Types
// =============================================================================

export interface ExportFact {
	name: string;
	kind: "function" | "class" | "type" | "interface" | "const" | "enum" | "namespace";
	file: string;
	isDefault: boolean;
}

export interface RouteFact {
	path: string;
	method: string;
	file: string;
	handler: string;
}

export interface FileFact {
	path: string;
	sizeBytes: number;
	lastModified: string;
	exports: ExportFact[];
}

export interface SpecFactBundle {
	schemaVersion: string;
	generatedAt: string;
	repoRoot: string;
	targetDir: string;
	totalFiles: number;
	totalExports: number;
	totalRoutes: number;
	files: FileFact[];
	routes: RouteFact[];
	namespaceCandidates: string[][];
}

// =============================================================================
// Derived types for predictive spec
// =============================================================================

export interface ContractPrediction {
	contract: string;
	namespace: string;
	predictedOutcome: "matched" | "compatible_drift" | "breaking_drift" | "missing" | "unused" | "overpredicted";
	evidenceClass: "static_confirmation" | "human_approval" | "historical_pattern_confirmation" | "llm_only" | "unknown";
	confidence: number; // 0-1, informational only, NOT authority
	source: string;
}

export interface NamespaceAssignment {
	namespace: string;
	files: string[];
	contracts: ContractPrediction[];
}

export interface PredictiveSpec {
	schemaVersion: string;
	generatedAt: string;
	factBundleHash: string;
	namespaces: NamespaceAssignment[];
	sharedIntegrationFiles: string[];
	assemblerOnlyFiles: string[];
	contractPredictions: ContractPrediction[];
	coverageBreakdown: {
		staticCount: number;
		humanCount: number;
		historicalCount: number;
		llmOnlyCount: number;
		unknownCount: number;
	};
}
