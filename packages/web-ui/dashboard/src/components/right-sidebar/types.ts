/**
 * RightSidebar types — P21.C Right Sidebar 3-Section Split
 */

export interface RightSidebarSection {
	id: string;
	type: "events" | "alerts" | "cleanup";
	title: string;
	badge?: number;
	isCollapsible?: boolean;
	isCollapsed?: boolean;
}

export interface RightSidebarItem {
	id: string;
	source: string; // 'ws-1', 'sys', etc.
	message: string;
	timestamp?: string;
	severity?: "info" | "warning" | "error" | "success";
	action?: {
		label: string;
		onClick: () => void;
	};
}

export interface AlertEntry {
	id: string;
	type: "failed" | "conflict" | "blocked";
	workspaceId: string;
}

export const RIGHT_SIDEBAR_SECTIONS: RightSidebarSection[] = [
	{
		id: "events",
		type: "events",
		title: "EVENTS",
		isCollapsible: false,
	},
	{
		id: "alerts",
		type: "alerts",
		title: "ALERTS",
		badge: 0,
		isCollapsible: true,
		isCollapsed: false,
	},
	{
		id: "cleanup",
		type: "cleanup",
		title: "CLEANUP REVIEW",
		isCollapsible: false,
	},
];
