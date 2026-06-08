/**
 * Package and Git snapshot tests
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGitState } from "../../src/core/project-state/git-snapshot.js";
import { buildPackageState } from "../../src/core/project-state/package-snapshot.js";

describe("buildPackageState", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-pkg-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("detects package manager as unknown for empty dir", () => {
		const state = buildPackageState(tmpDir);
		expect(state.packageManager).toBe("unknown");
		expect(state.validity).toBe("unknown");
	});

	it("detects pnpm from lockfile", () => {
		writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf-8");
		const state = buildPackageState(tmpDir);
		expect(state.packageManager).toBe("pnpm");
	});

	it("detects npm from lockfile", () => {
		writeFileSync(join(tmpDir, "package-lock.json"), "{}", "utf-8");
		const state = buildPackageState(tmpDir);
		expect(state.packageManager).toBe("npm");
	});

	it("captures package scripts", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test", scripts: { test: "vitest", build: "tsc" } }),
			"utf-8",
		);
		const state = buildPackageState(tmpDir);
		expect(Object.keys(state.packageFiles).length).toBe(1);
		const pkg = state.packageFiles["package.json"];
		expect(pkg.scripts).toEqual({ test: "vitest", build: "tsc" });
	});

	it("captures lockfiles", () => {
		writeFileSync(join(tmpDir, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf-8");
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		const state = buildPackageState(tmpDir);
		expect(state.lockfiles).toContain("pnpm-lock.yaml");
	});

	it("detects vitest test framework hint", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test", scripts: { test: "vitest" } }),
			"utf-8",
		);
		const state = buildPackageState(tmpDir);
		expect(state.testFrameworkHints).toContain("vitest");
	});

	it("detects jest test framework hint from dependency", () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ name: "test", devDependencies: { jest: "^29.0.0" } }),
			"utf-8",
		);
		const state = buildPackageState(tmpDir);
		expect(state.testFrameworkHints).toContain("jest");
	});

	it("excludes node_modules from package scanning", () => {
		mkdirSync(join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
		writeFileSync(
			join(tmpDir, "node_modules", "some-pkg", "package.json"),
			JSON.stringify({ name: "ignored" }),
			"utf-8",
		);
		writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
		const state = buildPackageState(tmpDir);
		expect(Object.keys(state.packageFiles).length).toBe(1);
		expect(state.packageFiles["package.json"]).toBeDefined();
	});
});

describe("buildGitState", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pss-git-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns isGitRepo=false for non-git directory", () => {
		const state = buildGitState(tmpDir);
		expect(state.isGitRepo).toBe(false);
		expect(state.validity).toBe("unknown");
	});

	it("returns isGitRepo=true for git repo", () => {
		try {
			execSync("git init", { cwd: tmpDir, stdio: "ignore" });
			execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
			execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
			writeFileSync(join(tmpDir, "README.md"), "# Test\n");
			execSync("git add .", { cwd: tmpDir, stdio: "ignore" });
			execSync("git commit -m init", { cwd: tmpDir, stdio: "ignore" });
		} catch {
			// git not available
			return;
		}

		const state = buildGitState(tmpDir);
		expect(state.isGitRepo).toBe(true);
		expect(state.branch).toBe("main");
	});

	it("tolerates git failure gracefully", () => {
		// Non-git dir should not throw
		const state = buildGitState(tmpDir);
		expect(state.isGitRepo).toBe(false);
	});

	it("detects untracked files", () => {
		try {
			execSync("git init", { cwd: tmpDir, stdio: "ignore" });
			execSync("git config user.email test@test.com", { cwd: tmpDir, stdio: "ignore" });
			execSync("git config user.name Test", { cwd: tmpDir, stdio: "ignore" });
			writeFileSync(join(tmpDir, "README.md"), "# Test\n");
			execSync("git add .", { cwd: tmpDir, stdio: "ignore" });
			execSync("git commit -m init", { cwd: tmpDir, stdio: "ignore" });
			writeFileSync(join(tmpDir, "new.ts"), "// new file\n", "utf-8");
		} catch {
			return;
		}

		const state = buildGitState(tmpDir);
		if (state.isGitRepo) {
			expect(state.untrackedFiles).toContain("new.ts");
		}
	});
});
