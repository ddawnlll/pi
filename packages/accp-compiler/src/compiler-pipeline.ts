/**
 * ACCP Compiler Pipeline V2
 *
 * Unified deterministic pipeline: extraction -> YAML parse -> schema
 * canonicalization -> common/report/evidence validation -> gate evaluation ->
 * route signal emission -> compiled result generation.
 *
 * Used by compileAccpSource, CLI compile, CLI validate, runtime compilation,
 * and selftests. The previous placeholder startsWith parser is no longer used
 * as final parse authority.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type {
	AccpCompileResult,
	AccpCompileStatus,
	AccpDiagnostic,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpReportType,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";
import { emitIntermediateRepresentation } from "./emit/emit-ir.js";
import { compileRouteSignal } from "./emit/emit-route-signal.js";
import { evaluateGate } from "./gate/gate-evaluator.js";
import { extractAccpYaml } from "./parser/extractor.js";
import { parseAccpYaml } from "./parser/yaml-parser.js";
import { isKnownReportType } from "./registry/report-registry.js";
import { validateCommonSchema } from "./validation/common-schema-validator.js";
import { validateEvidence } from "./validation/evidence-validator.js";
import { validateReportSchema } from "./validation/report-schema-validator.js";

/** Extended compile result produced by Compiler V2. */
export interface AccpCompiledArtifact extends AccpCompileResult {
	/** SHA-256 hash of normalized source. */
	sourceHash: string;
	/** Extraction metadata. */
	extractionMetadata: {
		mode: "raw" | "fenced" | "prose_wrapped";
		fenced: boolean;
		proseWrapped: boolean;
		startLine: number;
		endLine: number;
	};
	/** Gate verdict. */
	gateVerdict: AccpGateVerdict;
	/** Route signal (advisory). */
	routeSignal: AccpRouteSignal;
	/** Intermediate representation. */
	intermediateRepresentation: AccpIntermediateRepresentation;
	/** Parsed sections. */
	sections: Record<string, unknown>;
}

/**
 * ACCP compiler pipeline — orchestrates extract, parse, validate, gate, emit.
 *
 * This pipeline is deterministic and does not use LLM judgment.
 * Each phase produces diagnostics that are collected and returned.
 */
export class AccpCompilerPipeline {
	private readonly sourceText: string;
	private readonly sourcePath: string | undefined;
	private diagnostics: AccpDiagnostic[] = [];

	constructor(sourceText: string, sourcePath?: string) {
		this.sourceText = sourceText;
		this.sourcePath = sourcePath;
	}

	/**
	 * Execute the full compilation pipeline.
	 */
	execute(): AccpCompiledArtifact {
		// Phase 1: Extract exactly one ACCP document from source text.
		const extractResult = extractAccpYaml(this.sourceText, this.sourcePath);
		this.diagnostics.push(...extractResult.diagnostics);

		if (extractResult.yaml === null) {
			return this.buildResult(null, null, null, null);
		}

		const normalizedSource = extractResult.yaml;
		const sourceHash = extractResult.metadata?.sourceHash ?? computeSourceHash(normalizedSource);

		// Phase 2: Parse YAML and canonicalize schema.
		const parseResult = parseAccpYaml(normalizedSource, this.sourcePath);
		this.diagnostics.push(...parseResult.diagnostics);

		if (parseResult.parsed === null) {
			return this.buildResult(normalizedSource, sourceHash, null, extractResult.metadata ?? null);
		}

		const parsed = parseResult.parsed;

		// Phase 3: Common schema validation.
		const commonDiags = validateCommonSchema(parsed, this.sourcePath);
		this.diagnostics.push(...commonDiags);

		// Phase 4: Report-specific validation.
		const reportDiags = validateReportSchema(parsed.report.type, parsed.sections, this.sourcePath);
		this.diagnostics.push(...reportDiags);

		// Phase 5: Evidence validation.
		const evidenceDiags = validateEvidence(
			(parsed.evidence as import("./validation/evidence-validator.js").AccpEvidenceEntry[]) ?? [],
			undefined,
			parsed.report.type,
			this.sourcePath,
		);
		this.diagnostics.push(...evidenceDiags);

		// Phase 6: Gate evaluation.
		const evidenceStatus = this.determineEvidenceStatus(parsed);
		const gateVerdict = evaluateGate(parsed.report.id, parsed.report.type, this.diagnostics, evidenceStatus);

		// Phase 7: Route signal emission (advisory).
		const { signal: routeSignal, diagnostics: routeDiags } = compileRouteSignal(
			parsed.report.id,
			parsed.report.type,
			this.diagnostics,
		);
		this.diagnostics.push(...routeDiags);

		// Phase 8: Intermediate representation.
		const ir = emitIntermediateRepresentation(
			parsed.report.id,
			parsed.report.type,
			parsed.report.family,
			parsed.sections,
			this.diagnostics,
			Array.isArray(parsed.references) ? parsed.references.map(String) : [],
		);

		return this.buildResult(
			normalizedSource,
			sourceHash,
			parsed,
			extractResult.metadata ?? null,
			gateVerdict,
			routeSignal,
			ir,
		);
	}

	/**
	 * Determine evidence status from parsed report.
	 */
	private determineEvidenceStatus(parsed: {
		evidence?: unknown[];
		report: { type: AccpReportType };
	}): "complete" | "partial" | "missing" | "not_checked" {
		const entries = parsed.evidence;
		if (!entries || entries.length === 0) {
			return "missing";
		}

		// For promotion-bearing reports, missing evidence blocks promotion.
		const promotionTypes: AccpReportType[] = ["PRR", "TVR", "CAR"];
		const hasPromotionClaim = promotionTypes.includes(parsed.report.type);

		// Simple heuristic: if evidence exists and has at least one entry with
		// a path, command, or hash, treat as partial/complete. Runtime consumers
		// must verify hashes and commands separately.
		const hasConcreteEvidence = entries.some((entry) => {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
			const e = entry as Record<string, unknown>;
			return e.path || e.command || e.hash;
		});

		if (!hasConcreteEvidence) {
			return hasPromotionClaim ? "missing" : "partial";
		}

		return hasPromotionClaim ? "complete" : "partial";
	}

	/**
	 * Build the final compile result.
	 */
	private buildResult(
		normalizedSource: string | null,
		sourceHash: string | null,
		parsed: {
			report: { id: string; type: AccpReportType };
			sections: Record<string, unknown>;
		} | null,
		extractionMetadata: {
			mode: "raw" | "fenced" | "prose_wrapped";
			fenced: boolean;
			proseWrapped: boolean;
			startLine: number;
			endLine: number;
		} | null,
		gateVerdict?: AccpGateVerdict | null,
		routeSignal?: AccpRouteSignal | null,
		ir?: AccpIntermediateRepresentation | null,
	): AccpCompiledArtifact {
		const hasBlocking = this.diagnostics.some((d) => d.fatal);
		const hasWarnings = this.diagnostics.some((d) => d.severity === "warning");
		let status: AccpCompileStatus;
		if (hasBlocking) {
			status = "failed";
		} else if (hasWarnings) {
			status = "compiled_with_warnings";
		} else {
			status = "compiled";
		}

		const reportId = parsed?.report.id ?? "UNKNOWN";
		const reportType = parsed?.report.type ?? "FCR";

		const defaultGateVerdict: AccpGateVerdict = {
			reportId,
			reportType: isKnownReportType(reportType) ? reportType : "FCR",
			valid: false,
			fatalErrors: this.diagnostics.filter((d) => d.fatal).map((d) => `[${d.code}] ${d.message}`),
			warnings: this.diagnostics.filter((d) => d.severity === "warning").map((d) => `[${d.code}] ${d.message}`),
			blockingFindings: this.diagnostics.filter((d) => d.fatal).map((d) => d.message),
			findingCount: this.diagnostics.length,
			promotionReady: false,
			evidenceStatus: "missing",
		};

		const defaultRouteSignal: AccpRouteSignal = {
			sourceReportId: reportId,
			sourceReportType: isKnownReportType(reportType) ? reportType : "FCR",
			recommendedNextAction: "unresolved",
			recommendedNextRoute: "",
			confidence: "low",
			isAdvisory: true,
			mutationPolicyNeeded: "none",
			targetResolved: false,
			unresolvedRefs: [reportType],
		};

		const defaultIr: AccpIntermediateRepresentation = {
			sourceReportId: reportId,
			reportType: isKnownReportType(reportType) ? reportType : "FCR",
			family: "feature",
			sections: parsed?.sections ?? {},
			diagnostics: this.diagnostics,
			references: [],
		};

		return {
			status,
			reportId,
			reportType: isKnownReportType(reportType) ? reportType : ("FCR" as AccpReportType),
			diagnostics: this.diagnostics,
			hasBlockingFindings: hasBlocking,
			sourceHash: sourceHash ?? computeSourceHash(normalizedSource ?? this.sourceText),
			extractionMetadata: extractionMetadata ?? {
				mode: "raw",
				fenced: false,
				proseWrapped: false,
				startLine: 1,
				endLine: normalizedSource?.split("\n").length ?? 1,
			},
			gateVerdict: gateVerdict ?? defaultGateVerdict,
			routeSignal: routeSignal ?? defaultRouteSignal,
			intermediateRepresentation: ir ?? defaultIr,
			sections: parsed?.sections ?? {},
		};
	}
}

/** Compute SHA-256 hash of source text. */
function computeSourceHash(text: string): string {
	return createHash("sha256").update(text, "utf-8").digest("hex");
}
