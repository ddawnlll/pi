/**
 * GoalBoard — TUI component for displaying goals in a kanban-style board.
 *
 * This is a placeholder/stub for the P15.G Goal Board UI Primitive.
 * The full implementation will render goals as cards organized by status
 * columns (active, paused, completed, etc.) with priority indicators.
 */

/**
 * A single item (goal) on the goal board.
 */
export interface GoalBoardItem {
	id: string;
	title: string;
	description: string;
	priority: "critical" | "high" | "normal" | "low";
	status: "active" | "completed" | "paused" | "cancelled" | "needs_review";
	milestoneProgress: number;
}

/**
 * A column on the goal board, grouping items by status.
 */
export interface GoalBoardColumn {
	id: string;
	title: string;
	items: GoalBoardItem[];
}

/**
 * Theme configuration for the GoalBoard component.
 */
export interface GoalBoardTheme {
	columnWidth: number;
	headerStyle: string;
	cardStyle: string;
}

/**
 * GoalBoard component — renders a kanban-style board of goals.
 *
 * @param _props - Component properties
 * @returns An empty array (stub)
 */
export function GoalBoard(_props: {
	columns: GoalBoardColumn[];
	theme?: Partial<GoalBoardTheme>;
	class?: string;
	children?: unknown[];
}): unknown[] {
	// Stub — returns empty fragment
	return [];
}
