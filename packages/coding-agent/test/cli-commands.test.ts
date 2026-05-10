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
				byCategory: { budget: [], policy: [], config: [], models: [] },
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
				byCategory: { budget: [], policy: [], config: [], models: [] },
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
				byCategory: { budget: [], policy: [], config: [], models: [] },
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
			const content = "a".repeat(20000); // 20000 chars = ~5000 tokens
			const output = formatFileTokenEstimate("test.ts", content, 500);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 500");
			expect(output).toContain("Characters: 20,000");
			expect(output).toContain("Estimated Tokens: 5,000");
			expect(output).toContain("Medium");
		});

		it("should format token estimate for large file", () => {
			const content = "a".repeat(60000); // 60000 chars = ~15000 tokens
			const output = formatFileTokenEstimate("test.ts", content, 1500);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 1,500");
			expect(output).toContain("Characters: 60,000");
			expect(output).toContain("Estimated Tokens: 15,000");
			expect(output).toContain("Large");
		});

		it("should format token estimate for very large file", () => {
			const content = "a".repeat(120000); // 120000 chars = ~30000 tokens
			const output = formatFileTokenEstimate("test.ts", content, 3000);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 3,000");
			expect(output).toContain("Characters: 120,000");
			expect(output).toContain("Estimated Tokens: 30,000");
			expect(output).toContain("Very Large");
		});

		it("should format token estimate for huge file", () => {
			const content = "a".repeat(300000); // 300000 chars = ~75000 tokens
			const output = formatFileTokenEstimate("test.ts", content, 7500);

			expect(output).toContain("test.ts");
			expect(output).toContain("Lines: 7,500");
			expect(output).toContain("Characters: 300,000");
			expect(output).toContain("Estimated Tokens: 75,000");
			expect(output).toContain("Huge");
		});
	});
});
