#!/usr/bin/env node
/**
 * ACCP v2.0 Compiler CLI
 *
 * Command-line interface for the ACCP compiler.
 * Supports: compile, validate, compile-dir, render, graph
 *
 * All commands use the same Compiler V2 pipeline (compileAccpSource).
 *
 * @packageDocumentation
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileAccpSource } from "./compiler.js";
import { renderAsMarkdown } from "./emit/emit-rendered-markdown.js";

/** CLI command handler. */
type CommandHandler = (...args: string[]) => void;

const commands: Record<string, CommandHandler> = {
	compile: (filePath: string, outDir?: string) => {
		const resolved = resolve(filePath);
		if (!existsSync(resolved)) {
			console.error(`File not found: ${resolved}`);
			process.exit(1);
		}

		const source = readFileSync(resolved, "utf-8");
		const result = compileAccpSource(source, filePath);

		// Optionally write artifacts to disk
		if (outDir) {
			const outputBase = resolve(outDir);
			mkdirSync(outputBase, { recursive: true });
			writeFileSync(
				resolve(outputBase, `${result.reportId}.compiled.json`),
				JSON.stringify(result, null, 2),
				"utf-8",
			);
			if ((result as import("./compiler-pipeline.js").AccpCompiledArtifact).gateVerdict) {
				writeFileSync(
					resolve(outputBase, `${result.reportId}.gate-verdict.json`),
					JSON.stringify((result as import("./compiler-pipeline.js").AccpCompiledArtifact).gateVerdict, null, 2),
					"utf-8",
				);
			}
			if ((result as import("./compiler-pipeline.js").AccpCompiledArtifact).routeSignal) {
				writeFileSync(
					resolve(outputBase, `${result.reportId}.route-signal.json`),
					JSON.stringify((result as import("./compiler-pipeline.js").AccpCompiledArtifact).routeSignal, null, 2),
					"utf-8",
				);
			}
		}

		console.log(JSON.stringify(result, null, 2));

		if (result.hasBlockingFindings) {
			process.exit(1);
		}
	},
	validate: (filePath: string) => {
		const resolved = resolve(filePath);
		if (!existsSync(resolved)) {
			console.error(`File not found: ${resolved}`);
			process.exit(1);
		}

		const source = readFileSync(resolved, "utf-8");
		const result = compileAccpSource(source, filePath);
		const valid =
			!result.hasBlockingFindings && (result.status === "compiled" || result.status === "compiled_with_warnings");

		console.log(JSON.stringify({ valid, diagnostics: result.diagnostics }, null, 2));

		if (!valid) {
			process.exit(1);
		}
	},
	"compile-dir": (dirPath: string) => {
		const resolved = resolve(dirPath);
		if (!existsSync(resolved)) {
			console.error(`Directory not found: ${resolved}`);
			process.exit(1);
		}

		const files = readdirSync(resolved).filter((f: string) => f.endsWith(".accp.yaml"));
		if (files.length === 0) {
			console.error(`No .accp.yaml files found in ${resolved}`);
			process.exit(1);
		}

		let hasErrors = false;
		for (const file of files) {
			const fullPath = resolve(resolved, file);
			console.error(`Compiling: ${file}`);
			const source = readFileSync(fullPath, "utf-8");
			const result = compileAccpSource(source, fullPath);
			console.log(JSON.stringify(result, null, 2));

			if (result.hasBlockingFindings) {
				hasErrors = true;
			}
		}

		if (hasErrors) {
			process.exit(1);
		}
	},
	render: (filePath: string) => {
		const resolved = resolve(filePath);
		if (!existsSync(resolved)) {
			console.error(`File not found: ${resolved}`);
			process.exit(1);
		}

		const source = readFileSync(resolved, "utf-8");
		const result = compileAccpSource(source, filePath);
		const artifact = result as import("./compiler-pipeline.js").AccpCompiledArtifact;
		const rendered = renderAsMarkdown(
			result,
			artifact.intermediateRepresentation,
			artifact.gateVerdict,
			artifact.routeSignal,
		);
		console.log(rendered.content);
	},
	graph: (dirPath: string) => {
		const resolved = resolve(dirPath);
		if (!existsSync(resolved)) {
			console.error(`Directory not found: ${resolved}`);
			process.exit(1);
		}

		const files = readdirSync(resolved).filter((f: string) => f.endsWith(".accp.yaml"));
		const nodes: { id: string; type: string }[] = [];

		for (const file of files) {
			const fullPath = resolve(resolved, file);
			const source = readFileSync(fullPath, "utf-8");
			const result = compileAccpSource(source, fullPath);
			nodes.push({ id: result.reportId, type: result.reportType });
		}

		console.log(JSON.stringify({ nodes, edges: [] }, null, 2));
	},
};

function showHelp(): void {
	console.log(`
ACCP v2.0 Compiler CLI

Usage:
  accp compile <file> [outDir]   Compile a single ACCP YAML file
  accp validate <file>           Validate a single ACCP YAML file
  accp compile-dir <dir>         Compile all ACCP YAML files in a directory
  accp render <file>             Render a compiled ACCP file as Markdown
  accp graph <dir>               Generate a graph from compiled artifacts
  accp help                      Show this help
`);
}

function main(): void {
	const args = process.argv.slice(2);
	if (args.length === 0 || args[0] === "help") {
		showHelp();
		return;
	}

	const command = args[0];
	const handler = commands[command];

	if (!handler) {
		console.error(`Unknown command: ${command}`);
		showHelp();
		process.exit(1);
	}

	handler(...args.slice(1));
}

main();
