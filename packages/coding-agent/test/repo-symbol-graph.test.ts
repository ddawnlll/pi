/**
 * Tests for Repo Symbol Graph - P2 Workstream 6.I
 *
 * Covers:
 * - File classification by path
 * - Test association by convention
 * - Import/export parsing
 * - Cross-workspace conflict detection
 * - Test impact analysis
 * - Forbidden file handling
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoGraphBuilder } from "../src/repo-graph/repo-graph-builder.js";
import {
	classifyFile,
	DEFAULT_FORBIDDEN_PATTERNS,
	deriveTestPath,
	type FileClassification,
	isForbiddenPath,
	isTestOf,
	RepoSymbolGraph,
	type SymbolNode,
} from "../src/repo-graph/repo-symbol-graph.js";

// ---------------------------------------------------------------------------
// File classification tests
// ---------------------------------------------------------------------------

describe("classifyFile", () => {
	it("should classify .ts files as source", () => {
		expect(classifyFile("src/foo.ts")).toBe("source");
		expect(classifyFile("src/bar/foo.tsx")).toBe("source");
		expect(classifyFile("utils/helper.js")).toBe("source");
	});

	it("should classify test files by extension", () => {
		expect(classifyFile("src/foo.test.ts")).toBe("test");
		expect(classifyFile("src/foo.spec.ts")).toBe("test");
		expect(classifyFile("src/foo.test.tsx")).toBe("test");
		expect(classifyFile("src/foo.spec.js")).toBe("test");
	});

	it("should classify test files by directory", () => {
		expect(classifyFile("test/foo.ts")).toBe("test");
		expect(classifyFile("tests/foo.ts")).toBe("test");
		expect(classifyFile("__tests__/foo.ts")).toBe("test");
		expect(classifyFile("__test__/foo.ts")).toBe("test");
	});

	it("should classify config files", () => {
		expect(classifyFile("package.json")).toBe("config");
		expect(classifyFile("tsconfig.json")).toBe("config");
		expect(classifyFile(".gitignore")).toBe("config");
		expect(classifyFile(".env.example")).toBe("config");
	});

	it("should classify documentation files", () => {
		expect(classifyFile("README.md")).toBe("documentation");
		expect(classifyFile("docs/guide.mdx")).toBe("documentation");
	});

	it("should classify other files as other", () => {
		expect(classifyFile("assets/logo.svg")).toBe("source"); // .svg is in source list
		expect(classifyFile("foo.bar")).toBe("other");
	});
});

// ---------------------------------------------------------------------------
// Test path derivation tests
// ---------------------------------------------------------------------------

describe("deriveTestPath", () => {
	it("should derive sibling test path for .ts files", () => {
		expect(deriveTestPath("src/foo.ts")).toBe("src/foo.test.ts");
		expect(deriveTestPath("src/bar/helper.ts")).toBe("src/bar/helper.test.ts");
	});

	it("should derive mirrored test path for src/ files", () => {
		const result = deriveTestPath("src/foo.ts");
		expect(result).toBeTruthy();
	});

	it("should return null for non-source extensions", () => {
		expect(deriveTestPath("foo.json")).toBeNull();
		expect(deriveTestPath("foo.md")).toBeNull();
		expect(deriveTestPath("foo.py")).toBeNull();
	});
});

describe("isTestOf", () => {
	it("should detect sibling test relationship", () => {
		expect(isTestOf("src/foo.ts", "src/foo.test.ts")).toBe(true);
		expect(isTestOf("src/foo.ts", "test/foo.test.ts")).toBe(false);
	});

	it("should reject non-matching test files", () => {
		expect(isTestOf("src/foo.ts", "src/bar.test.ts")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Forbidden path tests
// ---------------------------------------------------------------------------

describe("isForbiddenPath", () => {
	it("should detect .env files as forbidden", () => {
		expect(isForbiddenPath(".env", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
		expect(isForbiddenPath(".env.local", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
	});

	it("should detect .pem files as forbidden", () => {
		expect(isForbiddenPath("keys/cert.pem", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
	});

	it("should detect credentials/ and secrets/ paths as forbidden", () => {
		expect(isForbiddenPath("credentials/foo.json", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
		expect(isForbiddenPath("secrets/bar.txt", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
	});

	it("should detect node_modules as forbidden", () => {
		expect(isForbiddenPath("node_modules/pkg/index.js", DEFAULT_FORBIDDEN_PATTERNS)).toBe(true);
	});

	it("should allow normal source files", () => {
		expect(isForbiddenPath("src/foo.ts", DEFAULT_FORBIDDEN_PATTERNS)).toBe(false);
		expect(isForbiddenPath("test/foo.test.ts", DEFAULT_FORBIDDEN_PATTERNS)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// RepoSymbolGraph tests
// ---------------------------------------------------------------------------

describe("RepoSymbolGraph", () => {
	function makeNode(path: string, classification: FileClassification): SymbolNode {
		return {
			path,
			classification,
			exports: [],
			imports: [],
			associatedTests: [],
			testTargets: [],
			tokenCount: 0,
		};
	}

	describe("basic graph operations", () => {
		it("should add and retrieve nodes", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			const node = makeNode("src/foo.ts", "source");
			graph.setNode(node);
			expect(graph.getNode("src/foo.ts")).toBe(node);
			expect(graph.nodeCount).toBe(1);
		});

		it("should replace existing nodes on setNodes", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(makeNode("src/foo.ts", "source"));

			const nodes = [makeNode("src/bar.ts", "source")];
			graph.setNodes(nodes);

			expect(graph.nodeCount).toBe(1);
			expect(graph.getNode("src/foo.ts")).toBeUndefined();
			expect(graph.getNode("src/bar.ts")).toBeDefined();
		});

		it("should get all nodes", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(makeNode("a.ts", "source"));
			graph.setNode(makeNode("b.ts", "source"));
			expect(graph.getAllNodes()).toHaveLength(2);
		});

		it("should get all edges", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(makeNode("a.ts", "source"));
			graph.setNode(makeNode("b.ts", "source"));
			expect(graph.getAllEdges()).toHaveLength(0);
		});
	});

	describe("test association edges", () => {
		it("should create test_of edges from associatedTests", () => {
			const srcNode = makeNode("src/foo.ts", "source");
			srcNode.associatedTests = ["src/foo.test.ts"];

			const testNode = makeNode("src/foo.test.ts", "test");
			testNode.testTargets = ["src/foo.ts"];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const edges = graph.getAllEdges();
			// Deduplication: only one edge per association (inverse edges are omitted)
			expect(edges.length).toBeGreaterThanOrEqual(1);

			const testOfEdge = edges.find((e) => e.type === "test_of");
			expect(testOfEdge).toBeDefined();
			expect(testOfEdge!.source).toBe("src/foo.ts");
			expect(testOfEdge!.target).toContain("foo.test");
		});

		it("should find tests for a source file", () => {
			const srcNode = makeNode("src/foo.ts", "source");
			srcNode.associatedTests = ["src/foo.test.ts"];

			const testNode = makeNode("src/foo.test.ts", "test");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const tests = graph.getTestsForFile("src/foo.ts");
			expect(tests).toHaveLength(1);
			expect(tests[0].path).toBe("src/foo.test.ts");
		});

		it("should find targets for a test file", () => {
			const testNode = makeNode("src/foo.test.ts", "test");
			testNode.testTargets = ["src/foo.ts"];

			const srcNode = makeNode("src/foo.ts", "source");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const targets = graph.getTargetsForTest("src/foo.test.ts");
			expect(targets).toHaveLength(1);
			expect(targets[0].path).toBe("src/foo.ts");
		});

		it("should find tests via import-based association", () => {
			const srcNode = makeNode("src/bar.ts", "source");

			const testNode = makeNode("test/bar.test.ts", "test");
			testNode.imports = [
				{
					source: "../src/bar.js",
					targetPath: "src/bar.ts",
					importedNames: ["Bar"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const tests = graph.getTestsForFile("src/bar.ts");
			expect(tests).toHaveLength(1);
			expect(tests[0].path).toBe("test/bar.test.ts");
		});
	});

	describe("import/export queries", () => {
		it("should find exporters of a symbol", () => {
			const node = makeNode("src/foo.ts", "source");
			node.exports = [{ name: "FooBar", kind: "value", line: 1 }];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(node);

			const exporters = graph.findExporters("FooBar");
			expect(exporters).toHaveLength(1);
			expect(exporters[0].path).toBe("src/foo.ts");
		});

		it("should find importers of a symbol", () => {
			const importer = makeNode("src/consumer.ts", "source");
			importer.imports = [
				{
					source: "./foo.js",
					targetPath: "src/foo.ts",
					importedNames: ["FooBar"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(importer);

			const importers = graph.findImporters("FooBar");
			expect(importers).toHaveLength(1);
			expect(importers[0].path).toBe("src/consumer.ts");
		});

		it("should query a symbol for exporters and importers", () => {
			const exporter = makeNode("src/lib.ts", "source");
			exporter.exports = [{ name: "Helper", kind: "value", line: 1 }];

			const importer = makeNode("src/app.ts", "source");
			importer.imports = [
				{
					source: "./lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([exporter, importer]);

			const result = graph.querySymbol("Helper");
			expect(result.exporters).toHaveLength(1);
			expect(result.importers).toHaveLength(1);
			expect(result.symbol).toBe("Helper");
		});
	});

	describe("dependency queries", () => {
		it("should find dependents of a file", () => {
			const target = makeNode("src/lib.ts", "source");

			const dependent = makeNode("src/app.ts", "source");
			dependent.imports = [
				{
					source: "./lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([target, dependent]);

			const dependents = graph.getDependents("src/lib.ts");
			expect(dependents).toHaveLength(1);
			expect(dependents[0].path).toBe("src/app.ts");
		});

		it("should find dependencies of a file", () => {
			const target = makeNode("src/lib.ts", "source");

			const consumer = makeNode("src/app.ts", "source");
			consumer.imports = [
				{
					source: "./lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([target, consumer]);

			const deps = graph.getDependencies("src/app.ts");
			expect(deps).toHaveLength(1);
			expect(deps[0].path).toBe("src/lib.ts");
		});

		it("should return empty for unknown files", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			expect(graph.getDependencies("nonexistent.ts")).toHaveLength(0);
			expect(graph.getDependents("nonexistent.ts")).toHaveLength(0);
		});
	});

	describe("cross-workspace conflict detection", () => {
		it("should detect shared imports across workspaces", () => {
			const lib = makeNode("src/lib.ts", "source");

			const ws1File = makeNode("src/ws1/feature.ts", "source");
			ws1File.imports = [
				{
					source: "../lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const ws2File = makeNode("src/ws2/feature.ts", "source");
			ws2File.imports = [
				{
					source: "../lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([lib, ws1File, ws2File]);

			const workspaceFiles = new Map<string, string[]>();
			workspaceFiles.set("WS.A", ["src/ws1/feature.ts"]);
			workspaceFiles.set("WS.B", ["src/ws2/feature.ts"]);

			const conflicts = graph.detectCrossWorkspaceConflicts(workspaceFiles);
			const sharedImportConflicts = conflicts.filter((c) => c.category === "shared_import");
			expect(sharedImportConflicts.length).toBeGreaterThanOrEqual(1);
		});

		it("should detect shared exports across workspaces", () => {
			const ws1File = makeNode("src/ws1/shared.ts", "source");
			ws1File.exports = [{ name: "CommonSymbol", kind: "value", line: 1 }];

			const ws2File = makeNode("src/ws2/shared.ts", "source");
			ws2File.exports = [{ name: "CommonSymbol", kind: "value", line: 1 }];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([ws1File, ws2File]);

			const workspaceFiles = new Map<string, string[]>();
			workspaceFiles.set("WS.A", ["src/ws1/shared.ts"]);
			workspaceFiles.set("WS.B", ["src/ws2/shared.ts"]);

			const conflicts = graph.detectCrossWorkspaceConflicts(workspaceFiles);
			const sharedExportConflicts = conflicts.filter((c) => c.category === "shared_export");
			expect(sharedExportConflicts.length).toBeGreaterThanOrEqual(1);
			const conflictSymbols = sharedExportConflicts.map((c) => c.description);
			expect(conflictSymbols.some((d) => d.includes("CommonSymbol"))).toBe(true);
		});

		it("should detect test target split across workspaces", () => {
			const srcNode = makeNode("src/feature.ts", "source");

			const testNode = makeNode("test/feature.test.ts", "test");
			testNode.testTargets = ["src/feature.ts"];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const workspaceFiles = new Map<string, string[]>();
			workspaceFiles.set("WS.A", ["test/feature.test.ts"]);
			workspaceFiles.set("WS.B", ["src/feature.ts"]);

			const conflicts = graph.detectCrossWorkspaceConflicts(workspaceFiles);
			const splitConflicts = conflicts.filter((c) => c.category === "test_target_split");
			expect(splitConflicts.length).toBeGreaterThanOrEqual(1);
		});

		it("should not report conflicts when files are in the same workspace", () => {
			const wsFile = makeNode("src/lib.ts", "source");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(wsFile);

			const workspaceFiles = new Map<string, string[]>();
			workspaceFiles.set("WS.A", ["src/lib.ts"]);
			workspaceFiles.set("WS.B", ["src/other.ts"]);

			const conflicts = graph.detectCrossWorkspaceConflicts(workspaceFiles);
			expect(conflicts).toHaveLength(0);
		});
	});

	describe("test impact analysis", () => {
		it("should find directly affected tests", () => {
			const srcNode = makeNode("src/foo.ts", "source");
			srcNode.associatedTests = ["src/foo.test.ts"];

			const testNode = makeNode("src/foo.test.ts", "test");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([srcNode, testNode]);

			const impact = graph.computeTestImpact(["src/foo.ts"]);
			expect(impact.directlyAffectedTests).toContain("src/foo.test.ts");
			expect(impact.totalTestCount).toBe(1);
		});

		it("should find transitively affected tests", () => {
			const lib = makeNode("src/lib.ts", "source");

			const consumer = makeNode("src/consumer.ts", "source");
			consumer.imports = [
				{
					source: "./lib.js",
					targetPath: "src/lib.ts",
					importedNames: ["Helper"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const consumerTest = makeNode("src/consumer.test.ts", "test");
			consumerTest.imports = [
				{
					source: "./consumer.js",
					targetPath: "src/consumer.ts",
					importedNames: ["Consumer"],
					typeOnly: false,
					dynamic: false,
				},
			];

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([lib, consumer, consumerTest]);

			const impact = graph.computeTestImpact(["src/lib.ts"]);
			expect(impact.transitivelyAffectedTests).toContain("src/consumer.test.ts");
			expect(impact.totalTestCount).toBe(1);
			expect(impact.changedFiles).toContain("src/lib.ts");
		});

		it("should handle multiple changed files", () => {
			const src1 = makeNode("src/a.ts", "source");
			src1.associatedTests = ["src/a.test.ts"];

			const src2 = makeNode("src/b.ts", "source");
			src2.associatedTests = ["src/b.test.ts"];

			const testA = makeNode("src/a.test.ts", "test");
			const testB = makeNode("src/b.test.ts", "test");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([src1, src2, testA, testB]);

			const impact = graph.computeTestImpact(["src/a.ts", "src/b.ts"]);
			expect(impact.directlyAffectedTests).toContain("src/a.test.ts");
			expect(impact.directlyAffectedTests).toContain("src/b.test.ts");
			expect(impact.totalTestCount).toBe(2);
		});

		it("should handle files with no tests", () => {
			const src = makeNode("src/untested.ts", "source");

			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNode(src);

			const impact = graph.computeTestImpact(["src/untested.ts"]);
			expect(impact.directlyAffectedTests).toHaveLength(0);
			expect(impact.transitivelyAffectedTests).toHaveLength(0);
			expect(impact.totalTestCount).toBe(0);
		});
	});

	describe("graph stats", () => {
		it("should return statistics about the graph", () => {
			const graph = new RepoSymbolGraph({ rootDir: "/test" });
			graph.setNodes([
				makeNode("src/foo.ts", "source"),
				makeNode("src/bar.ts", "source"),
				makeNode("src/foo.test.ts", "test"),
				makeNode("package.json", "config"),
			]);

			const stats = graph.getStats();
			expect(stats.nodeCount).toBe(4);
			expect(stats.byClassification.source).toBe(2);
			expect(stats.byClassification.test).toBe(1);
			expect(stats.byClassification.config).toBe(1);
		});
	});
});

// ---------------------------------------------------------------------------
// RepoGraphBuilder tests (using fixture data)
// ---------------------------------------------------------------------------

describe("RepoGraphBuilder", () => {
	it("should create a builder instance", () => {
		const builder = new RepoGraphBuilder({ rootDir: "/tmp" });
		expect(builder).toBeInstanceOf(RepoGraphBuilder);
	});

	it("should parse exports and imports correctly", () => {
		const testDir = join(tmpdir(), `pi-repo-graph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

		mkdirSync(join(testDir, "src"), { recursive: true });
		mkdirSync(join(testDir, "test"), { recursive: true });

		writeFileSync(
			join(testDir, "src", "math.ts"),
			[
				"export function add(a: number, b: number): number {",
				"  return a + b;",
				"}",
				"",
				"export function subtract(a: number, b: number): number {",
				"  return a - b;",
				"}",
			].join("\n"),
		);

		writeFileSync(
			join(testDir, "src", "math.test.ts"),
			[
				'import { add } from "./math";',
				"",
				'describe("math", () => {',
				'  it("should add", () => {',
				"    expect(add(1, 2)).toBe(3);",
				"  });",
				"});",
			].join("\n"),
		);

		writeFileSync(
			join(testDir, "src", "utils.ts"),
			[
				'import { add } from "./math";',
				"",
				"export function double(x: number): number {",
				"  return add(x, x);",
				"}",
			].join("\n"),
		);

		const builder = new RepoGraphBuilder({ rootDir: testDir });
		const graph = builder.build();

		const nodePaths = graph.getAllNodes().map((n) => n.path);

		rmSync(testDir, { recursive: true, force: true });

		expect(graph.nodeCount).toBeGreaterThanOrEqual(3);

		// Check math.ts
		const mathNode = graph.getNode("src/math.ts");
		expect(mathNode, `Expected "src/math.ts" in [${nodePaths.join(", ")}]`).toBeDefined();
		if (!mathNode) return;

		expect(mathNode.classification).toBe("source");
		expect(mathNode.exports).toHaveLength(2);
		const exportNames = mathNode.exports.map((e) => e.name);
		expect(exportNames).toContain("add");
		expect(exportNames).toContain("subtract");

		// Check test file classification
		const mathTestNode = graph.getNode("src/math.test.ts");
		expect(mathTestNode).toBeDefined();
		expect(mathTestNode!.classification).toBe("test");

		// Check import from test file
		expect(mathTestNode!.imports.length).toBeGreaterThanOrEqual(1);

		// Check test association by convention
		const testsForMath = graph.getTestsForFile("src/math.ts");
		expect(testsForMath.length).toBeGreaterThanOrEqual(1);
		expect(testsForMath.some((t) => t.path === "src/math.test.ts")).toBe(true);
	});

	it("should skip forbidden files", () => {
		const testDir = join(tmpdir(), `pi-repo-graph-forbidden-${Date.now()}-${Math.random().toString(36).slice(2)}`);

		mkdirSync(join(testDir, "src"), { recursive: true });
		mkdirSync(join(testDir, "node_modules"), { recursive: true });
		mkdirSync(join(testDir, "credentials"), { recursive: true });

		writeFileSync(join(testDir, "src", "valid.ts"), "export const x = 1;\n");
		writeFileSync(join(testDir, "node_modules", "pkg.ts"), "export const y = 2;\n");
		writeFileSync(join(testDir, "credentials", "secret.ts"), "export const z = 3;\n");
		writeFileSync(join(testDir, ".env"), "API_KEY=123\n");
		writeFileSync(join(testDir, "key.pem"), "-----BEGIN PRIVATE KEY-----\n");

		const builder = new RepoGraphBuilder({ rootDir: testDir });
		const graph = builder.build();

		const nodePaths = graph.getAllNodes().map((n) => n.path);

		rmSync(testDir, { recursive: true, force: true });

		expect(
			graph.nodeCount,
			`Expected 1 node (valid.ts only), got ${graph.nodeCount}: [${nodePaths.join(", ")}]`,
		).toBe(1);

		graph.getAllNodes().forEach((node) => {
			expect(node.path).toBe("src/valid.ts");
		});
	});

	it("should handle buildFromFiles", () => {
		const testDir = join(tmpdir(), `pi-repo-graph-fromfiles-${Date.now()}-${Math.random().toString(36).slice(2)}`);

		mkdirSync(join(testDir, "src"), { recursive: true });

		writeFileSync(join(testDir, "src", "a.ts"), "export const A = 1;\n");
		writeFileSync(join(testDir, "src", "b.ts"), "export const B = 2;\n");

		const builder = new RepoGraphBuilder({ rootDir: testDir });
		const graph = builder.buildFromFiles(["src/a.ts"]);

		rmSync(testDir, { recursive: true, force: true });

		expect(graph.nodeCount).toBe(1);
		expect(graph.getNode("src/a.ts")).toBeDefined();
		expect(graph.getNode("src/b.ts")).toBeUndefined();
	});
});
