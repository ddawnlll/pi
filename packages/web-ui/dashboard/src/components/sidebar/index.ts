/**
 * Sidebar module exports
 *
 * @deprecated The Sidebar component (P22.A) is replaced by TaskRunSidebar (P42 V3).
 *   Use TaskRunSidebar for the V3 app shell.
 *   BRAIN_ITEMS and PLATFORM_ITEMS are static placeholders — not production data.
 */
export {
	type SidebarItem,
	type SidebarSection,
	type SidebarProps,
	Sidebar,
	BRAIN_ITEMS,
	PLATFORM_ITEMS,
} from "./Sidebar.js";
export { BrainNudgeCard, type BrainNudgeCardProps } from "./BrainNudgeCard.js";
