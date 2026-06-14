#!/usr/bin/env node

/**
 * Fenced YAML smoke test for ACCP Compiler V2.
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
  id: "P49_14AD_FENCED_SMOKE"
  title: "Fenced YAML Smoke"
  status: "test"
scope:
  target: "fenced_yaml_smoke"
evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"
verdict:
  status: "PASS"
final_status:
  safe_to_continue: "yes"
  blockers: []`;

const fenced = `Here is the ACCP report:\n\`\`\`yaml\n${yaml}\n\`\`\``;

const result = compileAccpSource(fenced);

const ok =
	result.status === "compiled_with_warnings" &&
	result.reportId === "P49_14AD_FENCED_SMOKE" &&
	result.reportType === "RIR" &&
	result.diagnostics.some((d) => d.code === "ACCP_EXTRACT_FENCED_YAML") &&
	!result.diagnostics.some((d) => d.code === "ACCP_PARSE_YAML_INVALID");

if (ok) {
	console.log("FENCED YAML SMOKE: PASS");
	process.exit(0);
} else {
	console.error("FENCED YAML SMOKE: FAIL");
	console.error(JSON.stringify(result, null, 2));
	process.exit(1);
}
