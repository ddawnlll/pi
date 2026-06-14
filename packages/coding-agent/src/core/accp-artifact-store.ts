/**
 * ACCP Artifact Store (P49.27)
 *
 * Persists compiled ACCP artifacts per the ACCP artifact layout convention:
 *   reports/accp/{plan_id}/source/{report_id}.accp.yaml
 *   reports/accp/{plan_id}/compiled/{report_id}.compiled.json
 *   reports/accp/{plan_id}/ir/{report_id}.ir.json
 *   reports/accp/{plan_id}/verdict/{report_id}.gate-verdict.json
 *   reports/accp/{plan_id}/route/{report_id}.route-signal.json
 *   reports/accp/{plan_id}/rendered/{report_id}.accp.md
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AccpCompileResult,
	AccpGateVerdict,
	AccpIntermediateRepresentation,
	AccpRouteSignal,
} from "@earendil-works/pi-execution-contracts";
import { getAccpProgressEmitter } from "./accp-progress-emitter.js";

/** Artifact store configuration. */
export interface AccpArtifactStoreConfig {
	/** Root directory for artifacts (default: "reports/accp"). */
	rootDir: string;
	/** Plan ID. */
	planId: string;
}

/** Default artifact store config. */
export const DEFAULT_ARTIFACT_STORE_CONFIG: AccpArtifactStoreConfig = {
	rootDir: "reports/accp",
	planId: "P49",
};

// ---------------------------------------------------------------------------
// Plan-level index and graph types
// ---------------------------------------------------------------------------

/** Entry in the plan-level artifact index. */
export interface AccpArtifactIndexEntry {
	reportId: string;
	reportType: string;
	artifacts: string[];
	updatedAt: string;
}

/** Plan-level artifact index mapping. */
export interface AccpArtifactIndex {
	planId: string;
	accpVersion: string;
	reports: Record<string, AccpArtifactIndexEntry>;
	updatedAt: string;
}

/** Graph node for the plan-level artifact graph. */
export interface AccpArtifactGraphNode {
	id: string;
	type: "wave" | "workspace";
	title: string;
}

/** Graph edge for the plan-level artifact graph. */
export interface AccpArtifactGraphEdge {
	source: string;
	target: string;
	action: string;
	confidence: string;
}

/** Plan-level artifact graph. */
export interface AccpArtifactGraph {
	planId: string;
	accpVersion: string;
	nodes: AccpArtifactGraphNode[];
	edges: AccpArtifactGraphEdge[];
}

/**
 * ACCP Artifact Store — writes compiled artifacts to the filesystem.
 */
export class AccpArtifactStore {
	private config: AccpArtifactStoreConfig;

	constructor(config: AccpArtifactStoreConfig = DEFAULT_ARTIFACT_STORE_CONFIG) {
		this.config = config;
	}

	/**
	 * Get the base directory for a plan's artifacts.
	 */
	private getPlanDir(): string {
		return resolve(this.config.rootDir, this.config.planId);
	}

	/**
	 * Ensure a subdirectory exists.
	 */
	private ensureDir(subDir: string): string {
		const dir = resolve(this.getPlanDir(), subDir);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	/**
	 * Write a JSON artifact to disk.
	 */
	private writeJson(subDir: string, reportId: string, suffix: string, data: unknown): string {
		const dir = this.ensureDir(subDir);
		const filePath = resolve(dir, `${reportId}.${suffix}`);
		writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
		return filePath;
	}

	/**
	 * Save the compiled result.
	 */
	saveCompiled(reportId: string, result: AccpCompileResult): string {
		const path = this.writeJson("compiled", reportId, "compiled.json", result);
		const diagnosticCount = result.diagnostics?.length ?? 0;
		const fatalCount = result.diagnostics?.filter((d) => d.fatal).length ?? 0;
		const eventStatus: "compiled" | "compiled_with_warnings" | "failed" =
			result.status === "not_compiled" ? "compiled" : result.status;
		getAccpProgressEmitter().emitCompilationCompleted({
			reportId,
			reportType: result.reportType,
			status: eventStatus,
			diagnosticCount,
			fatalCount,
			diagnostics: result.diagnostics,
		});
		getAccpProgressEmitter().emitArtifactWritten({ reportId, kind: "compiled", path });
		return path;
	}

	/**
	 * Save the intermediate representation.
	 */
	saveIr(reportId: string, ir: AccpIntermediateRepresentation): string {
		return this.writeJson("ir", reportId, "ir.json", ir);
	}

	/**
	 * Save the gate verdict.
	 */
	saveGateVerdict(reportId: string, verdict: AccpGateVerdict): string {
		const path = this.writeJson("verdict", reportId, "gate-verdict.json", verdict);
		getAccpProgressEmitter().emitGateCompleted({
			reportId,
			reportType: verdict.reportType,
			valid: verdict.valid,
			evidenceStatus: verdict.evidenceStatus,
			fatalErrorCount: verdict.fatalErrors?.length ?? 0,
			blockingFindingCount: verdict.blockingFindings?.length ?? 0,
			warningCount: verdict.warnings?.length ?? 0,
		});
		getAccpProgressEmitter().emitArtifactWritten({ reportId, kind: "verdict", path });
		return path;
	}

	/**
	 * Save the route signal.
	 */
	saveRouteSignal(reportId: string, signal: AccpRouteSignal): string {
		return this.writeJson("route", reportId, "route-signal.json", signal);
	}

	/**
	 * Save the rendered Markdown.
	 */
	saveRendered(reportId: string, markdown: string): string {
		const dir = this.ensureDir("rendered");
		const filePath = resolve(dir, `${reportId}.accp.md`);
		writeFileSync(filePath, markdown, "utf-8");
		return filePath;
	}

	/**
	 * Read a compiled result.
	 */
	readCompiled(reportId: string): AccpCompileResult | null {
		try {
			const dir = resolve(this.getPlanDir(), "compiled");
			const filePath = resolve(dir, `${reportId}.compiled.json`);
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpCompileResult;
		} catch {
			return null;
		}
	}

	/**
	 * Read a route signal.
	 */
	readRouteSignal(reportId: string): AccpRouteSignal | null {
		try {
			const dir = resolve(this.getPlanDir(), "route");
			const filePath = resolve(dir, `${reportId}.route-signal.json`);
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpRouteSignal;
		} catch {
			return null;
		}
	}

	/**
	 * Read a gate verdict.
	 */
	readGateVerdict(reportId: string): AccpGateVerdict | null {
		try {
			const dir = resolve(this.getPlanDir(), "verdict");
			const filePath = resolve(dir, `${reportId}.gate-verdict.json`);
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpGateVerdict;
		} catch {
			return null;
		}
	}

	/** Save the source ACCP YAML. */
	saveSource(reportId: string, yamlContent: string): string {
		const dir = this.ensureDir("source");
		const filePath = resolve(dir, `${reportId}.accp.yaml`);
		writeFileSync(filePath, yamlContent, "utf-8");
		return filePath;
	}

	/** Read the source ACCP YAML. */
	readSource(reportId: string): string | null {
		try {
			const dir = resolve(this.getPlanDir(), "source");
			const filePath = resolve(dir, `${reportId}.accp.yaml`);
			if (!existsSync(filePath)) return null;
			return readFileSync(filePath, "utf-8");
		} catch {
			return null;
		}
	}

	/** Read an intermediate representation. */
	readIr(reportId: string): AccpIntermediateRepresentation | null {
		try {
			const dir = resolve(this.getPlanDir(), "ir");
			const filePath = resolve(dir, `${reportId}.ir.json`);
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpIntermediateRepresentation;
		} catch {
			return null;
		}
	}

	/** Read the rendered markdown. */
	readRendered(reportId: string): string | null {
		try {
			const dir = resolve(this.getPlanDir(), "rendered");
			const filePath = resolve(dir, `${reportId}.accp.md`);
			if (!existsSync(filePath)) return null;
			return readFileSync(filePath, "utf-8");
		} catch {
			return null;
		}
	}

	/** Save the plan-level artifact index. */
	saveIndex(index: AccpArtifactIndex): string {
		const dir = this.ensureDir("");
		const filePath = resolve(dir, "index.json");
		writeFileSync(filePath, JSON.stringify(index, null, 2), "utf-8");
		return filePath;
	}

	/** Read the plan-level artifact index. */
	readIndex(): AccpArtifactIndex | null {
		try {
			const dir = this.getPlanDir();
			const filePath = resolve(dir, "index.json");
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpArtifactIndex;
		} catch {
			return null;
		}
	}

	/** Save the plan-level artifact graph. */
	saveGraph(graph: AccpArtifactGraph): string {
		const dir = this.ensureDir("");
		const filePath = resolve(dir, "graph.json");
		writeFileSync(filePath, JSON.stringify(graph, null, 2), "utf-8");
		return filePath;
	}

	/** Read the plan-level artifact graph. */
	readGraph(): AccpArtifactGraph | null {
		try {
			const dir = this.getPlanDir();
			const filePath = resolve(dir, "graph.json");
			if (!existsSync(filePath)) return null;
			return JSON.parse(readFileSync(filePath, "utf-8")) as AccpArtifactGraph;
		} catch {
			return null;
		}
	}
}
