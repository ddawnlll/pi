#!/usr/bin/env node

/**
 * Raw YAML smoke test for ACCP Compiler V2.
 *
 * @packageDocumentation
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = resolve(dirname(__filename), "..");

const { compileAccpSource } = await import(
	resolve(ROOT_DIR, "packages/accp-compiler/dist/compiler.js")
);

const yaml = `accp_version: "2.0.0"
source_format: "ACCP-YAML"
report_type: "RIR"
report:
  id: "P49_14AD_RAW_SMOKE"
  title: "Raw YAML Smoke"
  status: "test"
scope:
  target: "raw_yaml_smoke"
evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"
verdict:
  status: "PASS"
final_status:
  safe_to_continue: "yes"
  blockers: []`;

const result = compileAccpSource(yaml);

const ok =
	result.status === "compiled" &&
	result.reportId === "P49_14AD_RAW_SMOKE" &&
	result.reportType === "RIR" &&
	!result.diagnostics.some((d) => d.code === "ACCP_PARSE_YAML_INVALID") &&
	!result.diagnostics.some((d) => d.code === "ACCP_EXTRACT_FENCED_YAML") &&
	result.gateVerdict?.valid === true;

if (ok) {
	console.log("RAW YAML SMOKE: PASS");
	process.exit(0);
} else {
	console.error("RAW YAML SMOKE: FAIL");
	console.error(JSON.stringify(result, null, 2));
	process.exit(1);
}
