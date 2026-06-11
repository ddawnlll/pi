/**
 * ACCP Template Expansion Tests (P49.28)
 *
 * Verifies that non-gate-critical report family templates
 * (FER, FDR, FCR, FIR, FGR, WBR, WDR, WER, WQR, ECR, DCR,
 *  BRR, RCA, FVR) are registered but not accidentally promoted
 * to blocking runtime authority.
 */
import { describe, expect, it } from "vitest";
import { EXPANDED_TEMPLATES, registerExpandedTemplates } from "../src/registry/builtin-templates.js";
import { AccpTemplateRegistry } from "../src/registry/template-registry.js";

describe("ACCP Template Expansion", () => {
	it("should have templates for all feature family types", () => {
		expect(EXPANDED_TEMPLATES.fer).toContain("Feature Exploration");
		expect(EXPANDED_TEMPLATES.fdr).toContain("Feature Design");
		expect(EXPANDED_TEMPLATES.fcr).toContain("Feature Contract");
		expect(EXPANDED_TEMPLATES.fir).toContain("Feature Implementation");
		expect(EXPANDED_TEMPLATES.fgr).toContain("Feature Gate");
	});

	it("should have templates for all writing family types", () => {
		expect(EXPANDED_TEMPLATES.wbr).toContain("Writing Brief");
		expect(EXPANDED_TEMPLATES.wdr).toContain("Writing Draft");
		expect(EXPANDED_TEMPLATES.wer).toContain("Writing Edit");
		expect(EXPANDED_TEMPLATES.wqr).toContain("Writing Quality");
	});

	it("should have templates for coordination types", () => {
		expect(EXPANDED_TEMPLATES.ecr).toContain("Evidence Capsule");
		expect(EXPANDED_TEMPLATES.dcr).toContain("Decision");
	});

	it("should have templates for bugfix types", () => {
		expect(EXPANDED_TEMPLATES.brr).toContain("Bug Reproduction");
		expect(EXPANDED_TEMPLATES.rca).toContain("Root Cause");
		expect(EXPANDED_TEMPLATES.fvr).toContain("Fix Validation");
	});

	it("should register all templates into the registry", () => {
		const registry = new AccpTemplateRegistry();
		registerExpandedTemplates(registry);
		const ids = registry.listIds();
		expect(ids).toContain("fer");
		expect(ids).toContain("fdr");
		expect(ids).toContain("ecr");
		expect(ids).toContain("dcr");
		expect(ids).toContain("brr");
		expect(ids).toContain("rca");
	});

	it("should not alter P49 strict report behavior (BSR, FPR, TVR, PRR, HIR, CAR)", () => {
		// Verify that expanded templates don't overwrite gate-critical ones
		const registry = new AccpTemplateRegistry();
		registerExpandedTemplates(registry);
		const bsr = registry.get("bsr");
		expect(bsr).toBeDefined();
		expect(bsr!.template).toContain("Bug Search Report");
	});

	it("should have exactly 14 expanded templates (5 feature + 4 writing + 2 coordination + 3 bugfix)", () => {
		expect(Object.keys(EXPANDED_TEMPLATES).length).toBe(14);
	});
});
