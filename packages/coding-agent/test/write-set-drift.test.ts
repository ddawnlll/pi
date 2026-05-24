/**
 * Test suite for writeSet Drift Detection (P23 W5).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { WriteSetDriftDetector, createWriteSetDriftDetector } from "../src/core/write-set-drift.js";

describe("WriteSetDriftDetector", () => {
  let repoDir: string;
  let detector: WriteSetDriftDetector;

  function writeFile(dir: string, filePath: string, content: string): void {
    const fullPath = join(dir, filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  beforeEach(() => {
    repoDir = join(tmpdir(), `drift-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(repoDir, { recursive: true });
    execSync("git init", { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "# Test");
    execSync("git add -A && git commit -m 'initial'", { cwd: repoDir });
    detector = createWriteSetDriftDetector({}, repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  describe("pattern matching", () => {
    it("matches exact file paths", () => {
      const r = (detector as any).isFileCoveredByPatterns("src/core/test.ts", ["src/core/test.ts"]);
      expect(r).toBe(true);
    });

    it("matches directory patterns", () => {
      const r = (detector as any).isFileCoveredByPatterns("src/core/test.ts", ["src/core/"]);
      expect(r).toBe(true);
    });

    it("matches wildcard patterns", () => {
      const r = (detector as any).isFileCoveredByPatterns("packages/coding-agent/src/index.ts", ["packages/*/src/**"]);
      expect(r).toBe(true);
    });

    it("does not match files outside pattern", () => {
      const r = (detector as any).isFileCoveredByPatterns("src/other/file.ts", ["src/scheduler/"]);
      expect(r).toBe(false);
    });
  });

  describe("drift detection", () => {
    it("flags drift when undeclared writes exceed threshold of 3", async () => {
      const baseCommit = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
      writeFile(repoDir, "src/other/a.ts", "a");
      writeFile(repoDir, "src/other/b.ts", "b");
      writeFile(repoDir, "src/other/c.ts", "c");
      writeFile(repoDir, "src/other/d.ts", "d");
      execSync("git add -A && git commit -m 'add other files'", { cwd: repoDir });

      const result = await detector.recordAndCompare("plan-2", "ws-2", repoDir, ["src/scheduler/"], baseCommit);
      expect(result.undeclaredWriteCount).toBeGreaterThan(3);
      expect(result.driftFlagged).toBe(true);
      expect(result.requiresHumanReview).toBe(true);
      expect(result.integrationBlocked).toBe(false);
    });

    it("clean workspace passes without drift", async () => {
      const baseCommit = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
      writeFile(repoDir, "src/scheduler/worker.ts", "worker");
      execSync("git add -A && git commit -m 'add worker'", { cwd: repoDir });

      const result = await detector.recordAndCompare("plan-3", "ws-3", repoDir, ["src/scheduler/"], baseCommit);
      expect(result.undeclaredWriteCount).toBe(0);
      expect(result.driftFlagged).toBe(false);
      expect(result.requiresHumanReview).toBe(false);
    });

    it("block_integration mode blocks when drift detected", async () => {
      const blockingDetector = createWriteSetDriftDetector({
        driftThresholdFiles: 0,
        onDriftDetected: "block_integration",
      }, repoDir);

      const baseCommit = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
      writeFile(repoDir, "src/other/block.ts", "blocked");
      execSync("git add -A && git commit -m 'add block'", { cwd: repoDir });

      const result = await blockingDetector.recordAndCompare("plan-4", "ws-4", repoDir, ["src/scheduler/"], baseCommit);
      expect(result.driftFlagged).toBe(true);
      expect(result.integrationBlocked).toBe(true);
      expect(result.requiresHumanReview).toBe(false);
    });

    it("disabled detection skips comparison", async () => {
      const disabledDetector = createWriteSetDriftDetector({ enabled: false }, repoDir);
      writeFile(repoDir, "src/any/file.ts", "anything");
      execSync("git add -A && git commit -m 'add file'", { cwd: repoDir });

      const result = await disabledDetector.recordAndCompare("plan-5", "ws-5", repoDir, ["src/scheduler/"]);
      expect(result.driftFlagged).toBe(false);
      expect(result.empiricalWriteSet).toEqual([]);
    });
  });

  describe("artifact persistence", () => {
    it("writes drift report artifact to disk", async () => {
      const baseCommit = execSync("git rev-parse HEAD", { cwd: repoDir }).toString().trim();
      writeFile(repoDir, "src/other/file.ts", "drift");
      execSync("git add -A && git commit -m 'add drift'", { cwd: repoDir });
      await detector.recordAndCompare("plan-6", "ws-6", repoDir, ["src/scheduler/"], baseCommit);
      const artifactPath = join(repoDir, ".pi", "executions", "plan-6", "worktrees", "ws-6.drift.json");
      expect(existsSync(artifactPath)).toBe(true);
    });
  });
});
