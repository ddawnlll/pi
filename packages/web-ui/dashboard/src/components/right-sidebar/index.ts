/**
 * RightSidebar module exports
 *
 * @deprecated Replaced by contextual drawers in V3 cockpit (P42.10).
 *   The permanent right sidebar must not be the default cockpit layout.
 *   RIGHT_SIDEBAR_SECTIONS are static placeholders — not production data.
 */
export { RightSidebar, type AlertEntry, type RightSidebarProps } from "./RightSidebar.js";
export {
	type RightSidebarSection,
	type RightSidebarItem,
	RIGHT_SIDEBAR_SECTIONS,
} from "./types.js";
