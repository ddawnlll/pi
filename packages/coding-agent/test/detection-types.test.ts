/**
 * Tests for P8.D - Bug, risk, and improvement detection types.
 */

import { describe, expect, it } from "vitest";
import {
	confidenceLevelToScore,
	generateDetectionId,
	riskLevelToScore,
	scoreToConfidenceLevel,
	scoreToRiskLevel,
} from "../src/core/detection-types.js";

describe("Detection Types - P8.D", () => {
	describe("riskLevelToScore", () => {
		it("should convert low risk to 0.2", () => {
			expect(riskLevelToScore("low")).toBe(0.2);
		});

		it("should convert medium risk to 0.5", () => {
			expect(riskLevelToScore("medium")).toBe(0.5);
		});

		it("should convert high risk to 0.8", () => {
			expect(riskLevelToScore("high")).toBe(0.8);
		});
	});

	describe("confidenceLevelToScore", () => {
		it("should convert low confidence to 0.3", () => {
			expect(confidenceLevelToScore("low")).toBe(0.3);
		});

		it("should convert medium confidence to 0.6", () => {
			expect(confidenceLevelToScore("medium")).toBe(0.6);
		});

		it("should convert high confidence to 0.9", () => {
			expect(confidenceLevelToScore("high")).toBe(0.9);
		});
	});

	describe("scoreToConfidenceLevel", () => {
		it("should convert >= 0.75 to high", () => {
			expect(scoreToConfidenceLevel(0.75)).toBe("high");
			expect(scoreToConfidenceLevel(0.9)).toBe("high");
		});

		it("should convert 0.45-0.74 to medium", () => {
			expect(scoreToConfidenceLevel(0.45)).toBe("medium");
			expect(scoreToConfidenceLevel(0.6)).toBe("medium");
		});

		it("should convert < 0.45 to low", () => {
			expect(scoreToConfidenceLevel(0.3)).toBe("low");
			expect(scoreToConfidenceLevel(0)).toBe("low");
		});
	});

	describe("scoreToRiskLevel", () => {
		it("should convert >= 0.65 to high", () => {
			expect(scoreToRiskLevel(0.65)).toBe("high");
			expect(scoreToRiskLevel(0.8)).toBe("high");
		});

		it("should convert 0.35-0.64 to medium", () => {
			expect(scoreToRiskLevel(0.35)).toBe("medium");
			expect(scoreToRiskLevel(0.5)).toBe("medium");
		});

		it("should convert < 0.35 to low", () => {
			expect(scoreToRiskLevel(0.2)).toBe("low");
			expect(scoreToRiskLevel(0)).toBe("low");
		});
	});

	describe("generateDetectionId", () => {
		it("should generate a unique ID with detect- prefix", () => {
			const id = generateDetectionId();
			expect(id).toMatch(/^detect-/);
		});

		it("should generate unique IDs each time", () => {
			const id1 = generateDetectionId();
			const id2 = generateDetectionId();
			expect(id1).not.toBe(id2);
		});
	});
});
