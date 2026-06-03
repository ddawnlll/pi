/**
 * Pi Dashboard — Shared Design Tokens
 *
 * Centralized design tokens. All components import from here.
 * Colors are currently hardcoded hex values matching the original
 * dashboard appearance. Future: migrate to claude.css @theme tokens
 * when the Tailwind v4 @theme inline pipeline is fully verified.
 */

// ─── Surface tokens ─────────────────────────────────────────────────────

/** App page background */
export const BG = "bg-[#F7F6F3] dark:bg-[#161616]";

/** Card / panel surface background */
export const SURF = "bg-white dark:bg-[#1E1E1E]";

/** Subtle alternate surface (hover states, sub-rows) */
export const SURF_ALT = "bg-stone-100 dark:bg-[#2A2A2A]";

// ─── Border tokens ──────────────────────────────────────────────────────

/** Standard 1px border */
export const BORD = "border-[#E8E6E1] dark:border-[#333]";

/** Border-bottom only (section dividers) */
export const BORD_B = "border-b border-[#E8E6E1] dark:border-[#333]";

// ─── Text tokens ────────────────────────────────────────────────────────

/** Primary body text */
export const TXT = "text-stone-800 dark:text-stone-200";

/** Muted / secondary text */
export const MUT = "text-stone-400 dark:text-stone-500";

// ─── Accent tokens ──────────────────────────────────────────────────────

/** Accent background (active / selected states) */
export const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";

/** Accent text */
export const ACC_TXT = "text-blue-700 dark:text-blue-300";

/** Primary action (buttons, links, focus rings) */
export const PRI = "bg-blue-600 text-white hover:bg-blue-700 shadow-sm";

// ─── Shadow / depth tokens ──────────────────────────────────────────────

/** Subtle shadow for cards */
export const SHADOW_CARD = "shadow-sm";

/** Standard shadow for elevated panels */
export const SHADOW_PANEL = "shadow";

/** Stronger shadow for active / selected surfaces */
export const SHADOW_ACTIVE = "shadow-md";

/** Modal / overlay shadow */
export const SHADOW_MODAL = "shadow-xl";

// ─── Typography scale tokens ────────────────────────────────────────────

/** Section / panel heading */
export const typeHeading = "text-base font-semibold";

/** Section sub-heading */
export const typeSubHeading = "text-sm font-semibold";

/** Section label (uppercase micro-labels) */
export const typeSectionLabel = "text-xs font-semibold uppercase tracking-widest";

/** Body text */
export const typeBody = "text-sm";

/** Strong body text */
export const typeBodyStrong = "text-sm font-medium";

/** Caption / metadata */
export const typeCaption = "text-xs text-stone-400 dark:text-stone-500";

/** Badge label */
export const typeBadge = "text-xs font-medium";

/** Metric value (large numbers) */
export const typeMetric = "text-xl font-semibold tracking-tight leading-none";

/** Monospace / code */
export const typeMono = "text-xs font-mono";

// ─── Focus ring ─────────────────────────────────────────────────────────

export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F7F6F3] dark:focus-visible:ring-offset-[#161616]";
