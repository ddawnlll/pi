/**
 * File Tree Utility Tests — P41.06 File Tree Read Model
 */
import { describe, expect, it } from "vitest";
import { buildFileTreeFromEntries, flattenFileTree, getFileExt } from "../src/file-tree.js";
import type { ChangedFileEntry } from "../src/read-model.js";

describe("getFileExt", () => {
	it("should extract extension from a .ts file", () => {
		expect(getFileExt("src/index.ts")).toBe("ts");
	});

	it("should extract extension from a .jsx file", () => {
		expect(getFileExt("components/Button.jsx")).toBe("jsx");
	});

	it("should extract extension from a file with multiple dots", () => {
		expect(getFileExt("test/utils.test.ts")).toBe("ts");
	});

	it("should return empty string for file with no extension", () => {
		expect(getFileExt("Makefile")).toBe("");
	});

	it("should return empty string for file ending with dot", () => {
		expect(getFileExt("trailing.")).toBe("");
	});

	it("should return lowercase extension", () => {
		expect(getFileExt("File.TS")).toBe("ts");
		expect(getFileExt("file.JSON")).toBe("json");
	});
});

describe("buildFileTreeFromEntries", () => {
	it("should return empty array for empty input", () => {
		const result = buildFileTreeFromEntries([]);
		expect(result).toEqual([]);
	});

	it("should create a single root-level file node", () => {
		const entries: ChangedFileEntry[] = [{ path: "README.md", name: "README.md", ext: "md", status: "added" }];

		const tree = buildFileTreeFromEntries(entries);

		expect(tree).toHaveLength(1);
		expect(tree[0]).toMatchObject({
			path: "README.md",
			name: "README.md",
			ext: "md",
			isDir: false,
			status: "added",
		});
		expect(tree[0].children).toBeUndefined();
	});

	it("should create a tree with nested directories", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/index.ts", name: "index.ts", ext: "ts", status: "modified" },
			{ path: "src/utils/helper.ts", name: "helper.ts", ext: "ts", status: "added" },
		];

		const tree = buildFileTreeFromEntries(entries);

		expect(tree).toHaveLength(1); // one root dir: src
		expect(tree[0]).toMatchObject({
			path: "src",
			name: "src",
			isDir: true,
		});
		expect(tree[0].children).toHaveLength(2); // index.ts + utils dir

		// Find the utils directory
		const utilsDir = tree[0].children!.find((c) => c.isDir);
		expect(utilsDir).toBeDefined();
		expect(utilsDir!.path).toBe("src/utils");
		expect(utilsDir!.children).toHaveLength(1);
		expect(utilsDir!.children![0]).toMatchObject({
			path: "src/utils/helper.ts",
			name: "helper.ts",
			isDir: false,
			status: "added",
		});

		// Find index.ts at root of src
		const indexFile = tree[0].children!.find((c) => !c.isDir);
		expect(indexFile).toBeDefined();
		expect(indexFile!.path).toBe("src/index.ts");
	});

	it("should sort directories before files, both alphabetically", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/zed.ts", name: "zed.ts", ext: "ts", status: "modified" },
			{ path: "src/alpha/mod.ts", name: "mod.ts", ext: "ts", status: "added" },
			{ path: "src/beta/mod.ts", name: "mod.ts", ext: "ts", status: "modified" },
			{ path: "README.md", name: "README.md", ext: "md", status: "added" },
		];

		const tree = buildFileTreeFromEntries(entries);

		// Root level: src (dir) before README.md (file) — dirs sort before files
		expect(tree[0].isDir).toBe(true);
		expect(tree[0].name).toBe("src");
		expect(tree[1].isDir).toBe(false);
		expect(tree[1].name).toBe("README.md");

		// Inside src: alpha dir before beta dir (both dirs, alphabetical)
		const srcChildren = tree[0].children!;
		expect(srcChildren[0].isDir).toBe(true);
		expect(srcChildren[0].name).toBe("alpha");
		expect(srcChildren[1].isDir).toBe(true);
		expect(srcChildren[1].name).toBe("beta");
		expect(srcChildren[2].isDir).toBe(false);
		expect(srcChildren[2].name).toBe("zed.ts");
	});

	it("should aggregate directory statistics from children", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/index.ts", name: "index.ts", ext: "ts", status: "modified", additions: 10, deletions: 2 },
			{ path: "src/utils/helper.ts", name: "helper.ts", ext: "ts", status: "added", additions: 50, deletions: 0 },
		];

		const tree = buildFileTreeFromEntries(entries);

		// src directory should aggregate its children
		expect(tree[0].additions).toBe(60); // 10 + 50
		expect(tree[0].deletions).toBe(2); // 2 + 0

		// src/utils directory should aggregate child stats
		const utilsDir = tree[0].children!.find((c) => c.isDir);
		expect(utilsDir!.additions).toBe(50);
		expect(utilsDir!.deletions).toBe(0);
	});

	it("should handle files at root level and nested", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "README.md", name: "README.md", ext: "md", status: "added" },
			{ path: ".gitignore", name: ".gitignore", ext: "", status: "modified" },
			{ path: "src/main.ts", name: "main.ts", ext: "ts", status: "modified" },
		];

		const tree = buildFileTreeFromEntries(entries);

		expect(tree).toHaveLength(3); // .gitignore, README.md, src (dirs before files)
		expect(tree.filter((n) => !n.isDir)).toHaveLength(2);
		expect(tree.filter((n) => n.isDir)).toHaveLength(1);
	});

	it("should handle deeply nested paths", () => {
		const entries: ChangedFileEntry[] = [{ path: "a/b/c/d/file.ts", name: "file.ts", ext: "ts", status: "modified" }];

		const tree = buildFileTreeFromEntries(entries);

		expect(tree).toHaveLength(1);
		expect(tree[0].name).toBe("a");

		const b = tree[0].children![0];
		expect(b.name).toBe("b");

		const c = b.children![0];
		expect(c.name).toBe("c");

		const d = c.children![0];
		expect(d.name).toBe("d");
		expect(d.isDir).toBe(true);

		const file = d.children![0];
		expect(file.path).toBe("a/b/c/d/file.ts");
	});

	it("should preserve change status on leaf nodes", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/removed.ts", name: "removed.ts", ext: "ts", status: "deleted" },
			{ path: "src/added.ts", name: "added.ts", ext: "ts", status: "added" },
			{ path: "src/modified.ts", name: "modified.ts", ext: "ts", status: "modified" },
		];

		const tree = buildFileTreeFromEntries(entries);

		const srcChildren = tree[0].children!;
		expect(srcChildren[0].status).toBe("added"); // alphabetical
		expect(srcChildren[1].status).toBe("modified");
		expect(srcChildren[2].status).toBe("deleted");
	});
});

describe("flattenFileTree", () => {
	it("should convert a tree back to a flat list of files", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/index.ts", name: "index.ts", ext: "ts", status: "modified", additions: 10, deletions: 2 },
			{ path: "README.md", name: "README.md", ext: "md", status: "added" },
		];

		const tree = buildFileTreeFromEntries(entries);
		const flat = flattenFileTree(tree);

		expect(flat).toHaveLength(2);
		expect(flat).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "src/index.ts" }),
				expect.objectContaining({ path: "README.md" }),
			]),
		);
	});

	it("should omit directory nodes", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/a.ts", name: "a.ts", ext: "ts", status: "modified" },
			{ path: "src/lib/b.ts", name: "b.ts", ext: "ts", status: "added" },
		];

		const tree = buildFileTreeFromEntries(entries);
		const flat = flattenFileTree(tree);

		expect(flat).toHaveLength(2);
		flat.forEach((f) => {
			expect(f.path).not.toBe("src");
			expect(f.path).not.toBe("src/lib");
		});
	});

	it("should return empty array for empty tree", () => {
		const result = flattenFileTree([]);
		expect(result).toEqual([]);
	});

	it("should preserve metadata on flatten", () => {
		const entries: ChangedFileEntry[] = [
			{ path: "src/main.ts", name: "main.ts", ext: "ts", status: "modified", additions: 5, deletions: 3 },
		];

		const tree = buildFileTreeFromEntries(entries);
		const flat = flattenFileTree(tree);

		expect(flat[0]).toMatchObject({
			path: "src/main.ts",
			name: "main.ts",
			ext: "ts",
			status: "modified",
			additions: 5,
			deletions: 3,
		});
	});
});
