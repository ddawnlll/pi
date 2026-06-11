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
		return this.writeJson("compiled", reportId, "compiled.json", result);
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
		return this.writeJson("verdict", reportId, "gate-verdict.json", verdict);
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
}
