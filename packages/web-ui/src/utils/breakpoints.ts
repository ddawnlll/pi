/**
 * Responsive breakpoint constants and utility helpers for the web-ui package.
 *
 * Breakpoints (matching Tailwind's defaults):
 *   - sm:  640px
 *   - md:  768px
 *   - lg:  1024px
 *   - xl:  1280px
 *   - 2xl: 1536px
 *
 * Usage:
 * ```typescript
 * import { BREAKPOINTS, isBreakpoint, breakpointUp } from "../utils/breakpoints.js";
 *
 * // Check if viewport is at or above a breakpoint
 * const isDesktop = breakpointUp("lg", window.innerWidth);
 *
 * // Check if viewport matches a specific breakpoint range
 * const isMobile = isBreakpoint("sm", { max: true }, window.innerWidth);
 * ```
 */

/** Shared breakpoint values in pixels, matching Tailwind defaults. */
export const BREAKPOINTS = Object.freeze({
	sm: 640,
	md: 768,
	lg: 1024,
	xl: 1280,
	"2xl": 1536,
} as const);

/** Breakpoint key type. */
export type Breakpoint = keyof typeof BREAKPOINTS;

/** Configuration for a breakpoint range check. */
export interface BreakpointRange {
	/** Check if viewport is AT or ABOVE this breakpoint. */
	min?: Breakpoint;
	/** Check if viewport is AT or BELOW this breakpoint. */
	max?: Breakpoint;
}

/**
 * Returns the pixel value for a named breakpoint.
 */
export function breakpointValue(name: Breakpoint): number {
	return BREAKPOINTS[name];
}

/**
 * Check if a given viewport width is at or above a breakpoint.
 *
 * @example
 * ```ts
 * if (breakpointUp("lg", window.innerWidth)) { /* desktop layout *\/ }
 * ```
 */
export function breakpointUp(name: Breakpoint, width: number): boolean {
	return width >= BREAKPOINTS[name];
}

/**
 * Check if a given viewport width is at or below a breakpoint.
 *
 * @example
 * ```ts
 * if (breakpointDown("md", window.innerWidth)) { /* mobile layout *\/ }
 * ```
 */
export function breakpointDown(name: Breakpoint, width: number): boolean {
	return width <= BREAKPOINTS[name];
}

/**
 * Check if a given viewport width falls within a breakpoint range.
 *
 * @example
 * ```ts
 * // Tablet range: 768px <= width <= 1024px
 * const isTablet = isBreakpoint({ min: "md", max: "lg" }, window.innerWidth);
 *
 * // Mobile: width <= 768px
 * const isMobile = isBreakpoint({ max: "md" }, window.innerWidth);
 *
 * // Desktop: width >= 1024px
 * const isDesktop = isBreakpoint({ min: "lg" }, window.innerWidth);
 * ```
 */
export function isBreakpoint(range: BreakpointRange, width: number): boolean {
	if (range.min && width < BREAKPOINTS[range.min]) return false;
	if (range.max && width > BREAKPOINTS[range.max]) return false;
	return true;
}

/**
 * React-compatible hook pattern as a convenience.
 * For Lit components, call this in `connectedCallback` + `resizeHandler`.
 */
export function getCurrentBreakpoint(width: number): Breakpoint {
	if (width >= BREAKPOINTS["2xl"]) return "2xl";
	if (width >= BREAKPOINTS.xl) return "xl";
	if (width >= BREAKPOINTS.lg) return "lg";
	if (width >= BREAKPOINTS.md) return "md";
	return "sm";
}

/**
 * Human-readable label for a breakpoint.
 */
export function breakpointLabel(name: Breakpoint): string {
	const labels: Record<Breakpoint, string> = {
		sm: "Mobile (small)",
		md: "Tablet (medium)",
		lg: "Desktop (large)",
		xl: "Desktop (extra large)",
		"2xl": "Desktop (2x extra large)",
	};
	return labels[name];
}
