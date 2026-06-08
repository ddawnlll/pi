/**
 * Bash classifier tests — PSS-MEGA-02
 *
 * Full taxonomy: read-only, local mutation, tree, package, git, unknown, dangerous, shell operators.
 */

import { describe, expect, it } from "vitest";
import { classifyCommand } from "../../src/core/project-state/bash-classifier.js";

describe("BashCommandClassifier", () => {
	// ============================================================================
	// Read-only
	// ============================================================================

	it("classifies pwd as no_state_change", () => {
		const result = classifyCommand("pwd");
		expect(result.effect).toBe("no_state_change");
		expect(result.confidence).toBe("high");
	});

	it("classifies ls as no_state_change", () => {
		expect(classifyCommand("ls").effect).toBe("no_state_change");
		expect(classifyCommand("ls -la").effect).toBe("no_state_change");
		expect(classifyCommand("ls src/").effect).toBe("no_state_change");
	});

	it("classifies cat as no_state_change", () => {
		expect(classifyCommand("cat package.json").effect).toBe("no_state_change");
		expect(classifyCommand("head -20 file.ts").effect).toBe("no_state_change");
	});

	it("classifies rg --files as no_state_change", () => {
		expect(classifyCommand("rg --files").effect).toBe("no_state_change");
		expect(classifyCommand("rg foo src/").effect).toBe("no_state_change");
	});

	it("classifies git status as no_state_change", () => {
		expect(classifyCommand("git status").effect).toBe("no_state_change");
		expect(classifyCommand("git diff").effect).toBe("no_state_change");
		expect(classifyCommand("git log --oneline").effect).toBe("no_state_change");
	});

	// ============================================================================
	// Path-local mutation
	// ============================================================================

	it("classifies touch as path_local_mutation", () => {
		const result = classifyCommand("touch src/a.ts");
		expect(result.effect).toBe("path_local_mutation");
		expect(result.confidence).toBe("high");
	});

	it("redirection turns read command into mutation", () => {
		const result = classifyCommand("ls > files.txt");
		expect(result.effect).toBe("path_local_mutation");
	});

	it("tee classified path_local_mutation", () => {
		const result = classifyCommand("echo x | tee output.txt");
		expect(result.effect).toBe("path_local_mutation");
	});

	// ============================================================================
	// Tree mutation
	// ============================================================================

	it("classifies mkdir as tree_mutation", () => {
		const result = classifyCommand("mkdir src/newdir");
		expect(result.effect).toBe("tree_mutation");
		expect(result.requiresMutationWindow).toBe(false);
	});

	it("classifies mv as tree_mutation", () => {
		const result = classifyCommand("mv src/a.ts src/b.ts");
		expect(result.effect).toBe("tree_mutation");
	});

	it("classifies rm as tree_mutation", () => {
		const result = classifyCommand("rm src/a.ts");
		expect(result.effect).toBe("tree_mutation");
		expect(result.confidence).toBe("medium");
	});

	it("classifies cp as tree_mutation", () => {
		const result = classifyCommand("cp src/a.ts src/b.ts");
		expect(result.effect).toBe("tree_mutation");
	});

	// ============================================================================
	// Package mutation
	// ============================================================================

	it("classifies npm install as package_state_mutation", () => {
		const result = classifyCommand("npm install react");
		expect(result.effect).toBe("package_state_mutation");
		expect(result.requiresMutationWindow).toBe(true);
	});

	it("classifies pnpm install as package_state_mutation", () => {
		const result = classifyCommand("pnpm add lodash");
		expect(result.effect).toBe("package_state_mutation");
	});

	it("classifies bun install as package_state_mutation", () => {
		const result = classifyCommand("bun install");
		expect(result.effect).toBe("package_state_mutation");
	});

	// ============================================================================
	// Git mutation
	// ============================================================================

	it("classifies git checkout as git_state_mutation", () => {
		const result = classifyCommand("git checkout main");
		expect(result.effect).toBe("git_state_mutation");
		expect(result.requiresMutationWindow).toBe(true);
	});

	it("classifies git pull as git_state_mutation", () => {
		expect(classifyCommand("git pull").effect).toBe("git_state_mutation");
	});

	it("classifies git reset as git_state_mutation", () => {
		expect(classifyCommand("git reset --hard HEAD").effect).toBe("git_state_mutation");
	});

	// ============================================================================
	// Unknown global mutation
	// ============================================================================

	it("classifies python script as unknown_global_mutation", () => {
		const result = classifyCommand("python scripts/generate.py");
		expect(result.effect).toBe("unknown_global_mutation");
		expect(result.requiresMutationWindow).toBe(true);
	});

	it("classifies npm run build as unknown_global_mutation", () => {
		const result = classifyCommand("npm run build");
		expect(result.effect).toBe("unknown_global_mutation");
	});

	it("classifies make as unknown_global_mutation", () => {
		expect(classifyCommand("make").effect).toBe("unknown_global_mutation");
	});

	it("classifies cargo build as unknown_global_mutation", () => {
		expect(classifyCommand("cargo build").effect).toBe("unknown_global_mutation");
	});

	it("classifies bash script as unknown_global_mutation", () => {
		expect(classifyCommand("bash script.sh").effect).toBe("unknown_global_mutation");
	});

	// ============================================================================
	// Dangerous destructive
	// ============================================================================

	it("classifies rm -rf as dangerous", () => {
		const result = classifyCommand("rm -rf .");
		expect(result.effect).toBe("dangerous_destructive_mutation");
		expect(result.requiresMutationWindow).toBe(true);
	});

	it("classifies rm -rf / as dangerous", () => {
		expect(classifyCommand("rm -rf /").effect).toBe("dangerous_destructive_mutation");
	});

	it("classifies find -delete as dangerous", () => {
		expect(classifyCommand("find . -delete").effect).toBe("dangerous_destructive_mutation");
	});

	it("classifies git clean -fdx as dangerous", () => {
		expect(classifyCommand("git clean -fdx").effect).toBe("dangerous_destructive_mutation");
	});

	// ============================================================================
	// Shell operators
	// ============================================================================

	it("compound command with && classified conservatively", () => {
		const result = classifyCommand("python gen.py && git status");
		expect(result.effect).toBe("unknown_global_mutation");
		expect(result.confidence).toBe("low");
	});

	it("pipe with tee classified mutation", () => {
		const result = classifyCommand("cat a.ts | tee b.ts");
		expect(result.effect).toBe("path_local_mutation");
	});

	it("xargs with sed classified unknown", () => {
		const result = classifyCommand("rg foo | xargs sed -i s/foo/bar/");
		expect(result.effect).toBe("unknown_global_mutation");
	});
});
