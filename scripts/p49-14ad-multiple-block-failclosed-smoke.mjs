#!/usr/bin/env node

/**
 * Multiple ACCP block fail-closed smoke test for ACCP Compiler V2.
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

const yaml1 = `accp_version: "2.0.0"
source_format: "ACCP-YAML"
report_type: "RIR"
report:
  id: "P49_14AD_MULTI_001"
  title: "First"
  status: "test"
evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"
verdict:
  status: "PASS"
final_status:
  safe_to_continue: "yes"
  blockers: []`;

const yaml2 = `accp_version: "2.0.0"
source_format: "ACCP-YAML"
report:
  id: "P49_14AD_MULTI_002"
  type: "RIR"
  family: "core"
  title: "Second"
  status: "test"
evidence:
  - id: "EV001"
    type: "file"
    path: "packages/accp-compiler/src/compiler.ts"`;

const multiple = `${yaml1}\n---\n${yaml2}`;

const result = compileAccpSource(multiple);

const ok =
	result.status === "failed" &&
	result.diagnostics.some((d) => d.code === "ACCP_EXTRACT_MULTIPLE_DOCUMENTS") &&
	result.hasBlockingFindings === true;

if (ok) {
	console.log("MULTIPLE BLOCK FAIL-CLOSED SMOKE: PASS");
	process.exit(0);
} else {
	console.error("MULTIPLE BLOCK FAIL-CLOSED SMOKE: FAIL");
	console.error(JSON.stringify(result, null, 2));
	process.exit(1);
}
