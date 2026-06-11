/**
 * P49.5.04 — P49.5 Bridge Runner
 *
 * Orchestrates the P49.5 bridge: runs inventory, capability probe,
 * readiness evaluation, certificate emission, and prerequisite gate.
 *
 * This is the single entry point that P45 should use to determine
 * whether production async assembly is allowed.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildPrerequisiteCertificate } from "../assembly/p45-prerequisite-certificate.js";
import { evaluateP45PrerequisiteGate } from "../assembly/p45-prerequisite-gate.js";
import { runAccpCapabilityProbe } from "./accp-capability-probe.js";
import {
	type DecisionEngineInput,
	evaluateP45Readiness,
	type P45ReadinessCertificate,
} from "./p45-readiness-certificate.js";
import { buildP49ArtifactInventory } from "./p49-completion-inventory.js";

// =============================================================================
// Bridge Runner Result
// =============================================================================

export interface P495BridgeResult {
	success: boolean;
	certificate?: P45ReadinessCertificate;
	error?: string;
	reportPaths: string[];
}

// =============================================================================
// Runner
// =============================================================================

/**
 * Run the full P49.5 bridge.
 *
 * Steps:
 * 1. Build P49 artifact inventory
 * 2. Run ACCP capability probe
 * 3. Evaluate P45 readiness -> produce certificate
 * 4. Evaluate P45 prerequisite gate -> produce verdict
 * 5. Write all artifacts to report paths
 */
export async function runP495Bridge(repoRoot: string, outputDir: string): Promise<P495BridgeResult> {
	const reportPaths: string[] = [];

	try {
		// Step 1: Build P49 artifact inventory
		const inventory = await buildP49ArtifactInventory(repoRoot);
		const inventoryPath = path.join(outputDir, "reports/p49_5_p45_readiness/p49-artifact-inventory.json");
		await fs.mkdir(path.dirname(inventoryPath), { recursive: true });
		await fs.writeFile(inventoryPath, JSON.stringify(inventory, null, 2));
		reportPaths.push(inventoryPath);

		// Step 2: Run ACCP capability probe
		const probe = await runAccpCapabilityProbe(repoRoot);
		const probePath = path.join(outputDir, "reports/p49_5_p45_readiness/accp-capability-probe.json");
		await fs.mkdir(path.dirname(probePath), { recursive: true });
		await fs.writeFile(probePath, JSON.stringify(probe, null, 2));
		reportPaths.push(probePath);

		// Step 3: Evaluate P45 readiness
		const decisionInput: DecisionEngineInput = {
			inventory,
			probe,
			dirtyRuntimeStatus: inventory.summary.missing === 0 ? "acceptable" : "unknown",
			largePlanGuardedAllowed: false, // Updated by P49.5.07 if probed
		};

		const certificate = evaluateP45Readiness(decisionInput);

		// Write certificate schema (schema doc)
		const schemaPath = path.join(outputDir, "reports/p49_5_p45_readiness/p45-readiness-certificate.schema.json");
		await fs.mkdir(path.dirname(schemaPath), { recursive: true });
		await fs.writeFile(schemaPath, JSON.stringify(certificate, null, 2));
		reportPaths.push(schemaPath);

		// Write certificate
		const certPath = path.join(outputDir, "reports/p49_5_p45_readiness/p45-readiness-certificate.json");
		await fs.writeFile(certPath, JSON.stringify(certificate, null, 2));
		reportPaths.push(certPath);

		// Step 4: P45 prerequisite gate
		const gateVerdict = evaluateP45PrerequisiteGate(certificate.decision, certificate.blockingReasons);
		const prerequisiteCert = buildPrerequisiteCertificate(
			certificate.evidenceHashes.inventoryHash + certificate.evidenceHashes.probeHash,
			gateVerdict,
		);
		const prereqPath = path.join(outputDir, "reports/p45-prerequisite/p45_prerequisite_certificate.json");
		await fs.mkdir(path.dirname(prereqPath), { recursive: true });
		await fs.writeFile(prereqPath, JSON.stringify(prerequisiteCert, null, 2));
		reportPaths.push(prereqPath);

		return {
			success: true,
			certificate,
			reportPaths,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			reportPaths,
		};
	}
}
