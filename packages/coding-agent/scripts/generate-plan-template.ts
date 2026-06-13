#!/usr/bin/env tsx

/**
 * Generate `alpha2-schema.ts` from the canonical PlanSpec v5 Alpha2 JSON schema.
 *
 * The JSON schema at:
 *   PlanSpec_v5_alpha2_template_pack/02_planspec_v5_alpha2_schema.json
 *
 * is the source of truth for the PlanSpec v5 Alpha2 format. This script
 * generates a Zod-based strict schema from it and writes the result to:
 *   packages/coding-agent/src/core/plan-compiler/alpha2/alpha2-schema.ts
 *
 * Re-run this script whenever the JSON schema (or the template example)
 * changes. The generated Zod schema is then consumed by
 * `compilePlanSpecAlpha2` for plan validation.
 *
 * Usage:
 *   tsx packages/coding-agent/scripts/generate-plan-template.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");

// =============================================================================
// Paths
// =============================================================================

const JSON_SCHEMA_PATH = join(
	repoRoot,
	"PlanSpec_v5_alpha2_template_pack",
	"02_planspec_v5_alpha2_schema.json",
);
const OUT_PATH = join(
	packageRoot,
	"src",
	"core",
	"plan-compiler",
	"alpha2",
	"alpha2-schema.ts",
);

// =============================================================================
// Types
// =============================================================================

type JsonSchema = {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	additionalProperties?: boolean | JsonSchema;
	$ref?: string;
	minimum?: number;
	maximum?: number;
	minItems?: number;
};

type JsonSchemaRoot = JsonSchema & {
	$defs?: Record<string, JsonSchema>;
};

// =============================================================================
// Code generation context
// =============================================================================

/**
 * Emitted identifiers for $defs. Tracks which named schemas we've defined
 * so we can deduplicate and detect missing references.
 */
const defNames = new Set<string>();
const referencedDefs = new Set<string>();
const defOrder: string[] = [];

function defName(name: string): string {
	return `PlanSpecV5Alpha2_${toPascalCase(name)}`;
}

function toPascalCase(name: string): string {
	return name
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((s) => s[0].toUpperCase() + s.slice(1))
		.join("");
}

function toCamelCase(name: string): string {
	const p = toPascalCase(name);
	return p[0].toLowerCase() + p.slice(1);
}

// =============================================================================
// Primitive schemas (shared enums/literals used by the JSON schema)
// =============================================================================

/**
 * Extract all enum/literal nodes from the schema that should be hoisted
 * to shared primitive constants. Returns a map of JSON-pointer-like
 * path -> { name, expression }.
 */
function collectPrimitives(
	schema: JsonSchema,
	defs: Record<string, JsonSchema>,
	path: string,
	out: Map<string, { name: string; expression: string }>,
): void {
	if (schema.$ref) {
		const refName = schema.$ref.replace("#/$defs/", "");
		if (defs[refName]) {
			collectPrimitives(defs[refName], defs, `${path}.${refName}`, out);
		}
		return;
	}
	if (schema.const !== undefined) {
		const name = `Primitive_${sanitizeName(path)}`;
		out.set(path, { name, expression: `z.literal(${JSON.stringify(schema.const)})` });
		return;
	}
	if (schema.enum) {
		const name = `Primitive_${sanitizeName(path)}`;
		out.set(path, {
			name,
			expression: `z.enum(${JSON.stringify(schema.enum)})`,
		});
		return;
	}
	if (schema.properties) {
		for (const [k, v] of Object.entries(schema.properties)) {
			collectPrimitives(v, defs, `${path}.${k}`, out);
		}
	}
	if (schema.items) {
		collectPrimitives(schema.items, defs, `${path}[]`, out);
	}
}

function sanitizeName(path: string): string {
	return path
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.replace(/_+/g, "_");
}

// =============================================================================
// Schema node -> Zod expression
// =============================================================================

function generateZodExpression(
	node: JsonSchema,
	defs: Record<string, JsonSchema>,
	pragmas: { allowAdditionalProperties: boolean; indent?: number } = { allowAdditionalProperties: false },
): string {
	const indent = pragmas.indent ?? 0;
	const outer = "\t".repeat(indent);
	const inner = "\t".repeat(indent + 1);
	if (node.$ref) {
		const name = node.$ref.replace("#/$defs/", "");
		referencedDefs.add(name);
		return defName(name);
	}

	if (node.const !== undefined) {
		return `z.literal(${JSON.stringify(node.const)})`;
	}

	if (node.enum) {
		return `z.enum(${JSON.stringify(node.enum)})`;
	}

	switch (node.type) {
		case "string":
			return "z.string()";
		case "boolean":
			return "z.boolean()";
		case "integer":
			return "z.number().int()";
		case "number": {
			let expr = "z.number()";
			if (node.minimum !== undefined) expr += `.min(${node.minimum})`;
			if (node.maximum !== undefined) expr += `.max(${node.maximum})`;
			return expr;
		}
		case "array": {
			const item = node.items
				? generateZodExpression(node.items, defs, pragmas)
				: "z.unknown()";
			let expr = `z.array(${item})`;
			if (node.minItems !== undefined) expr += `.min(${node.minItems})`;
			return expr;
		}
		case "object": {
			// Empty object or no defined properties
			if (!node.properties || Object.keys(node.properties).length === 0) {
				if (node.additionalProperties === true) {
					return "z.record(z.string(), z.unknown())";
				}
				if (node.additionalProperties === false) {
					return "z.object({}).strict()";
				}
				// Permissive object with no defined properties
				return "z.record(z.string(), z.unknown())";
			}

			const lines: string[] = [];
			const propKeys = Object.keys(node.properties);
			const required = new Set(node.required ?? []);

			for (const key of propKeys) {
				const propSchema = node.properties![key];
				let expr = generateZodExpression(propSchema, defs, {
					allowAdditionalProperties: pragmas.allowAdditionalProperties,
					indent: indent + 1,
				});
				if (!required.has(key)) {
					expr += ".optional()";
				}
				lines.push(`${inner}${key}: ${expr},`);
			}

			let body = `z.object({\n${lines.join("\n")}\n${outer}})`;
			if (node.additionalProperties === false) {
				body += ".strict()";
			}
			return body;
		}
		default: {
			// Permissive fallback (no type, no const/enum)
			if (node.additionalProperties === true) {
				return "z.record(z.string(), z.unknown())";
			}
			return "z.unknown()";
		}
	}
}

// =============================================================================
// Generate named $def schemas
// =============================================================================

function generateDefs(defs: Record<string, JsonSchema>): string {
	const blocks: string[] = [];

	// Preserve order: defOrder is populated as we walk the top-level schema.
	for (const name of defOrder) {
		if (!defs[name]) continue;
		const expr = generateZodExpression(defs[name], defs, {
			allowAdditionalProperties: false,
			indent: 1,
		});
		blocks.push(`export const ${defName(name)} = ${expr};\n`);
	}

	return blocks.join("\n");
}

// =============================================================================
// Generate top-level schema
// =============================================================================

function generateTopLevel(root: JsonSchemaRoot): {
	body: string;
} {
	const props: string[] = [];
	const propKeys = Object.keys(root.properties ?? {});
	const required = new Set(root.required ?? []);

	for (const key of propKeys) {
		const propSchema = root.properties![key];
		// If this property is a $ref to a $def, mark that def as referenced
		if (propSchema.$ref) {
			const refName = propSchema.$ref.replace("#/$defs/", "");
			referencedDefs.add(refName);
			if (!defOrder.includes(refName)) defOrder.push(refName);
		} else if (propSchema.items?.$ref) {
			const refName = propSchema.items.$ref.replace("#/$defs/", "");
			referencedDefs.add(refName);
			if (!defOrder.includes(refName)) defOrder.push(refName);
		}

		let expr = generateZodExpression(propSchema, root.$defs ?? {}, {
			allowAdditionalProperties: false,
			indent: 1,
		});
		if (!required.has(key)) {
			expr += ".optional()";
		}
		props.push(`\t${key}: ${expr},`);
	}

	const body = `export const PlanSpecV5Alpha2Schema = z.object({\n${props.join("\n")}\n})${root.additionalProperties === false ? ".strict()" : ""};\n`;
	return { body };
}

// =============================================================================
// Main
// =============================================================================

function main() {
	if (!existsSync(JSON_SCHEMA_PATH)) {
		console.error(`JSON schema not found at: ${JSON_SCHEMA_PATH}`);
		process.exit(1);
	}

	const raw = readFileSync(JSON_SCHEMA_PATH, "utf-8");
	const root: JsonSchemaRoot = JSON.parse(raw);
	const defs = root.$defs ?? {};

	// Seed defOrder from the actual def keys (preserve declaration order)
	for (const k of Object.keys(defs)) {
		defOrder.push(k);
		defNames.add(k);
	}

	const { body: topLevel } = generateTopLevel(root);
	const defsBody = generateDefs(defs);

	const output = `/**
 * PlanSpec v5 Alpha2 Strict Schema — Zod-based validation (GENERATED)
 *
 * DO NOT EDIT THIS FILE BY HAND.
 * It is generated from:
 *   PlanSpec_v5_alpha2_template_pack/02_planspec_v5_alpha2_schema.json
 *
 * Regenerate by running:
 *   tsx packages/coding-agent/scripts/generate-plan-template.ts
 *
 * Every object uses .strict() (where the source schema marks
 * additionalProperties: false) to reject unknown properties. Required
 * fields are enforced; optional fields use .optional().
 */

import { z } from "zod";

// =============================================================================
// Primitive $defs
// =============================================================================

${defsBody}
// =============================================================================
// Top-level schema
// =============================================================================

${topLevel}
`;

	const outDir = dirname(OUT_PATH);
	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
	writeFileSync(OUT_PATH, output, "utf-8");

	console.log(`Wrote ${OUT_PATH}`);
	console.log(`Defs:   ${defOrder.length}`);
	console.log(`Refs:   ${referencedDefs.size}`);
	const unused = defOrder.filter((n) => !referencedDefs.has(n));
	if (unused.length > 0) {
		console.warn(`Unused $defs: ${unused.join(", ")}`);
	}
}

main();
