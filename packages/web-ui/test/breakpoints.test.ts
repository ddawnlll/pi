/**
 * Tests for the responsive breakpoint utilities.
 *
 * Acceptance criteria:
 * 1. BREAKPOINTS constant defines all 5 standard breakpoints (sm, md, lg, xl, 2xl)
 * 2. breakpointUp returns true when width >= breakpoint threshold
 * 3. breakpointDown returns true when width <= breakpoint threshold
 * 4. isBreakpoint with { min, max } range works correctly
 * 5. isBreakpoint with only min or only max works correctly
 * 6. getCurrentBreakpoint returns the matching breakpoint name
 * 7. breakpointLabel returns a human-readable label for each breakpoint
 * 8. BREAKPOINTS values are immutable (frozen)
 */

import { describe, expect, it } from "vitest";
import {
	BREAKPOINTS,
	type Breakpoint,
	breakpointDown,
	breakpointLabel,
	breakpointUp,
	breakpointValue,
	getCurrentBreakpoint,
	isBreakpoint,
} from "../src/utils/breakpoints.js";

describe("BREAKPOINTS constant", () => {
	it("defines all five standard breakpoints", () => {
		expect(BREAKPOINTS).toHaveProperty("sm");
		expect(BREAKPOINTS).toHaveProperty("md");
		expect(BREAKPOINTS).toHaveProperty("lg");
		expect(BREAKPOINTS).toHaveProperty("xl");
		expect(BREAKPOINTS).toHaveProperty("2xl");
	});

	it("sm is 640px", () => {
		expect(BREAKPOINTS.sm).toBe(640);
	});

	it("md is 768px", () => {
		expect(BREAKPOINTS.md).toBe(768);
	});

	it("lg is 1024px", () => {
		expect(BREAKPOINTS.lg).toBe(1024);
	});

	it("xl is 1280px", () => {
		expect(BREAKPOINTS.xl).toBe(1280);
	});

	it("2xl is 1536px", () => {
		expect(BREAKPOINTS["2xl"]).toBe(1536);
	});

	it("values ascend in order", () => {
		const values = Object.values(BREAKPOINTS);
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeGreaterThan(values[i - 1]);
		}
	});

	it("object is frozen (immutable)", () => {
		expect(Object.isFrozen(BREAKPOINTS)).toBe(true);
	});
});

describe("breakpointUp", () => {
	it("returns true when width equals breakpoint threshold", () => {
		expect(breakpointUp("sm", 640)).toBe(true);
		expect(breakpointUp("md", 768)).toBe(true);
		expect(breakpointUp("lg", 1024)).toBe(true);
	});

	it("returns true when width exceeds breakpoint threshold", () => {
		expect(breakpointUp("sm", 800)).toBe(true);
		expect(breakpointUp("md", 1024)).toBe(true);
		expect(breakpointUp("lg", 1440)).toBe(true);
	});

	it("returns false when width is below breakpoint threshold", () => {
		expect(breakpointUp("md", 400)).toBe(false);
		expect(breakpointUp("lg", 800)).toBe(false);
		expect(breakpointUp("xl", 1024)).toBe(false);
	});

	it("handles edge case width=0", () => {
		expect(breakpointUp("sm", 0)).toBe(false);
	});

	it("handles large width", () => {
		expect(breakpointUp("2xl", 2000)).toBe(true);
	});
});

describe("breakpointDown", () => {
	it("returns true when width equals breakpoint threshold", () => {
		expect(breakpointDown("sm", 640)).toBe(true);
		expect(breakpointDown("md", 768)).toBe(true);
		expect(breakpointDown("lg", 1024)).toBe(true);
	});

	it("returns true when width is below breakpoint threshold", () => {
		expect(breakpointDown("sm", 320)).toBe(true);
		expect(breakpointDown("md", 640)).toBe(true);
		expect(breakpointDown("lg", 768)).toBe(true);
	});

	it("returns false when width exceeds breakpoint threshold", () => {
		expect(breakpointDown("md", 1024)).toBe(false);
		expect(breakpointDown("lg", 1280)).toBe(false);
		expect(breakpointDown("xl", 1440)).toBe(false);
	});

	it("handles edge case width=0", () => {
		expect(breakpointDown("sm", 0)).toBe(true);
	});
});

describe("isBreakpoint range check", () => {
	it("matches width within min-max range", () => {
		// Tablet range: 768 <= width <= 1024
		expect(isBreakpoint({ min: "md", max: "lg" }, 768)).toBe(true);
		expect(isBreakpoint({ min: "md", max: "lg" }, 900)).toBe(true);
		expect(isBreakpoint({ min: "md", max: "lg" }, 1024)).toBe(true);
	});

	it("rejects width below min", () => {
		expect(isBreakpoint({ min: "md", max: "lg" }, 640)).toBe(false);
		expect(isBreakpoint({ min: "md", max: "lg" }, 767)).toBe(false);
	});

	it("rejects width above max", () => {
		expect(isBreakpoint({ min: "md", max: "lg" }, 1025)).toBe(false);
		expect(isBreakpoint({ min: "md", max: "lg" }, 1280)).toBe(false);
	});

	it("handles only min constraint", () => {
		// Desktop: width >= 1024
		expect(isBreakpoint({ min: "lg" }, 1024)).toBe(true);
		expect(isBreakpoint({ min: "lg" }, 1280)).toBe(true);
		expect(isBreakpoint({ min: "lg" }, 768)).toBe(false);
	});

	it("handles only max constraint", () => {
		// Mobile: width <= 768
		expect(isBreakpoint({ max: "md" }, 320)).toBe(true);
		expect(isBreakpoint({ max: "md" }, 640)).toBe(true);
		expect(isBreakpoint({ max: "md" }, 768)).toBe(true);
		expect(isBreakpoint({ max: "md" }, 1024)).toBe(false);
	});

	it("handles empty range (no constraints)", () => {
		expect(isBreakpoint({}, 0)).toBe(true);
		expect(isBreakpoint({}, 9999)).toBe(true);
	});
});

describe("getCurrentBreakpoint", () => {
	it("returns 'sm' for widths below 768", () => {
		expect(getCurrentBreakpoint(0)).toBe("sm");
		expect(getCurrentBreakpoint(320)).toBe("sm");
		expect(getCurrentBreakpoint(640)).toBe("sm");
		expect(getCurrentBreakpoint(767)).toBe("sm");
	});

	it("returns 'md' for widths 768-1023", () => {
		expect(getCurrentBreakpoint(768)).toBe("md");
		expect(getCurrentBreakpoint(800)).toBe("md");
		expect(getCurrentBreakpoint(1023)).toBe("md");
	});

	it("returns 'lg' for widths 1024-1279", () => {
		expect(getCurrentBreakpoint(1024)).toBe("lg");
		expect(getCurrentBreakpoint(1200)).toBe("lg");
		expect(getCurrentBreakpoint(1279)).toBe("lg");
	});

	it("returns 'xl' for widths 1280-1535", () => {
		expect(getCurrentBreakpoint(1280)).toBe("xl");
		expect(getCurrentBreakpoint(1440)).toBe("xl");
		expect(getCurrentBreakpoint(1535)).toBe("xl");
	});

	it("returns '2xl' for widths 1536 and above", () => {
		expect(getCurrentBreakpoint(1536)).toBe("2xl");
		expect(getCurrentBreakpoint(1920)).toBe("2xl");
		expect(getCurrentBreakpoint(2560)).toBe("2xl");
	});
});

describe("breakpointValue", () => {
	it("returns correct pixel values", () => {
		expect(breakpointValue("sm")).toBe(640);
		expect(breakpointValue("md")).toBe(768);
		expect(breakpointValue("lg")).toBe(1024);
		expect(breakpointValue("xl")).toBe(1280);
		expect(breakpointValue("2xl")).toBe(1536);
	});
});

describe("breakpointLabel", () => {
	it("returns a human-readable label for each breakpoint", () => {
		const labels: Record<Breakpoint, RegExp> = {
			sm: /mobile/i,
			md: /tablet/i,
			lg: /desktop.*large/i,
			xl: /desktop.*extra large/i,
			"2xl": /2x/i,
		};

		for (const [bp, pattern] of Object.entries(labels)) {
			expect(breakpointLabel(bp as Breakpoint)).toMatch(pattern);
		}
	});
});
