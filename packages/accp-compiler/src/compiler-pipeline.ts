import type { AccpCompileResult, AccpCompileStatus, AccpDiagnostic } from "@earendil-works/pi-execution-contracts";

/**
 * ACCP compiler pipeline — orchestrates parse, validate, emit phases.
 *
 * This pipeline is deterministic and does not use LLM judgment.
 * Each phase produces diagnostics that are collected and returned.
 */
export class AccpCompilerPipeline {
	private readonly sourceYaml: string;
	private readonly sourcePath: string | undefined;
	private diagnostics: AccpDiagnostic[] = [];

	constructor(sourceYaml: string, sourcePath?: string) {
		this.sourceYaml = sourceYaml;
		this.sourcePath = sourcePath;
	}

	/**
	 * Execute the full compilation pipeline.
	 */
	execute(): AccpCompileResult {
		// Phase 1: Parse YAML (placeholder — implemented in P49.06)
		const parseResult = this.parse();

		// Phase 2: Schema validation (placeholder — implemented in P49.07)
		this.validateCommonSchema(parseResult);

		// Determine status
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

		return {
			status,
			reportId: parseResult.reportId ?? "UNKNOWN",
			reportType: (parseResult.reportType as any) ?? "FCR",
			diagnostics: this.diagnostics,
			hasBlockingFindings: hasBlocking,
		};
	}

	/**
	 * Parse YAML into structured data.
	 * Placeholder — full implementation in P49.06.
	 */
	private parse(): { reportId?: string; reportType?: string } {
		if (!this.sourceYaml || this.sourceYaml.trim().length === 0) {
			this.diagnostics.push({
				code: "ACCP_PARSE_YAML_INVALID",
				message: "Source YAML is empty",
				severity: "error",
				fatal: true,
				sourcePath: this.sourcePath,
			});
			return {};
		}

		// Basic YAML detection — must start with accp_version
		const trimmed = this.sourceYaml.trim();
		if (!trimmed.startsWith("accp_version:")) {
			this.diagnostics.push({
				code: "ACCP_PARSE_YAML_INVALID",
				message: "Source does not start with accp_version",
				severity: "error",
				fatal: true,
				sourcePath: this.sourcePath,
			});
			return {};
		}

		return { reportId: "PARSED", reportType: "FCR" };
	}

	/**
	 * Validate common schema fields.
	 * Placeholder — full implementation in P49.07.
	 */
	private validateCommonSchema(_parsed: Record<string, unknown>): void {
		// Schema validation will be implemented in P49.07
	}
}
