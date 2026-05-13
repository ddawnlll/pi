/**
 * CLI Commands Tests - P1 Milestone 4
 *
 * Tests for --doctor and --token-estimate CLI commands
 */

import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.js";
import {
	type DoctorResults,
	formatDoctorResults,
	formatDoctorResultsJson,
	getDoctorExitCode,
} from "../src/cli/doctor.js";
import { formatFileTokenEstimate } from "../src/cli/token-report.js";

describe("CLI Commands - P1 Milestone 4", () => {
	describe("parseArgs", () => {
		it("should parse --doctor flag", () => {
			const args = parseArgs(["--doctor"]);
			expect(args.doctor).toBe(true);
		});

		it("should parse --token-estimate with file path", () => {
			const args = parseArgs(["--token-estimate", "test.ts"]);
			expect(args.tokenEstimate).toBe("test.ts");
		});

		it("should parse --json flag", () => {
			const args = parseArgs(["--json"]);
			expect(args.json).toBe(true);
		});

		it("should parse --doctor with --json", () => {
			const args = parseArgs(["--doctor", "--json"]);
			expect(args.doctor).toBe(true);
			expect(args.json).toBe(true);
		});

		it("should parse --token-estimate with --json", () => {
			const args = parseArgs(["--token-estimate", "file.ts", "--json"]);
			expect(args.tokenEstimate).toBe("file.ts");
			expect(args.json).toBe(true);
		});
	});

	describe("formatDoctorResults", () => {
		it("should format doctor results as human-readable text", () => {
			const results: DoctorResults = {
				checks: [
					{
						name: "Test Check",
						status: "pass",
						message: "Test passed",
					},
				],
				byCategory: {
					budget: [
						{
							name: "Test Check",
							status: "pass",
							message: "Test passed",
						},
					],
					policy: [],
					config: [],
					models: [],
					edit_strategy: [],
				},
				overallStatus: "pass",
				passCount: 1,
				warnCount: 0,
				failCount: 0,
			};

			const output = formatDoctorResults(results);
			expect(output).toContain("Token Safety Doctor");
			expect(output).toContain("PASS");
			expect(output).toContain("Test Check");
		});

		it("should format doctor results as JSON", () => {
			const results: DoctorResults = {
				checks: [
					{
						name: "Test Check",
						status: "pass",
						message: "Test passed",
					},
				],
				byCategory: {
					budget: [],
					policy: [],
					config: [],
					models: [],
					edit_strategy: [],
				},
				overallStatus: "pass",
				passCount: 1,
				warnCount: 0,
				failCount: 0,
			};

			const output = formatDoctorResultsJson(results);
			const parsed = JSON.parse(output);
			expect(parsed.overallStatus).toBe("pass");
			expect(parsed.passCount).toBe(1);
		});
	});

	describe("getDoctorExitCode", () => {
		it("should return 0 for pass status", () => {
			const results: DoctorResults = {
				checks: [],
				byCategory: { budget: [], policy: [], config: [], models: [], edit_strategy: [] },
				overallStatus: "pass",
				passCount: 1,
				warnCount: 0,
				failCount: 0,
			};
			expect(getDoctorExitCode(results)).toBe(0);
		});

		it("should return 1 for warn status", () => {
			const results: DoctorResults = {
				checks: [],
				byCategory: { budget: [], policy: [], config: [], models: [], edit_strategy: [] },
				overallStatus: "warn",
				passCount: 0,
				warnCount: 1,
				failCount: 0,
			};
			expect(getDoctorExitCode(results)).toBe(1);
		});

		it("should return 2 for fail status", () => {
			const results: DoctorResults = {
				checks: [],
				byCategory: { budget: [], policy: [], config: [], models: [], edit_strategy: [] },
				overallStatus: "fail",
				passCount: 0,
				warnCount: 0,
				failCount: 1,
			};
			expect(getDoctorExitCode(results)).toBe(2);
		});
	});

	describe("formatFileTokenEstimate", () => {
		it("should format token estimate for small file", () => {
			const content = "a".repeat(1000); // 1000 chars = ~250 tokens
			const output = formatFileTokenEstimate("test.ts", content, 10);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 10");
			expect(output).toContain("Characters: 1,000");
			expect(output).toContain("Estimated Tokens: 250");
			expect(output).toContain("Small");
		});

		it("should format token estimate for medium file", () => {
			const content = "a".repeat(20000); // 20000 chars = ~5000 tokens (Medium: 4001-12000)
			const output = formatFileTokenEstimate("test.ts", content, 1200);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 1,200");
			expect(output).toContain("Characters: 20,000");
			expect(output).toContain("Estimated Tokens: 5,000");
			expect(output).toContain("Medium");
		});

		it("should format token estimate for large file", () => {
			const content = "a".repeat(52000); // 52000 chars = ~13000 tokens (Large: 12001-24000)
			const output = formatFileTokenEstimate("test.ts", content, 3000);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 3,000");
			expect(output).toContain("Characters: 52,000");
			expect(output).toContain("Estimated Tokens: 13,000");
			expect(output).toContain("Large");
		});

		it("should format token estimate for very large file", () => {
			const content = "a".repeat(100000); // 100000 chars = ~25000 tokens (Very Large: 24001-64000)
			const output = formatFileTokenEstimate("test.ts", content, 5000);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 5,000");
			expect(output).toContain("Characters: 100,000");
			expect(output).toContain("Estimated Tokens: 25,000");
			expect(output).toContain("Very Large");
		});

		it("should format token estimate for huge file", () => {
			const content = "a".repeat(260000); // 260000 chars = ~65000 tokens (Huge: >64000)
			const output = formatFileTokenEstimate("test.ts", content, 8500);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 8,500");
			expect(output).toContain("Characters: 260,000");
			expect(output).toContain("Estimated Tokens: 65,000");
			expect(output).toContain("Huge");
		});
	});
});
