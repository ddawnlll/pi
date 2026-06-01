/**
 * Workspaces Components — P42.05
 *
 * Exports:
 * - WorkspaceBoard - Main workspace board with grouped cards
 * - WorkspaceGroup - Status-grouped workspace list
 * - WorkspaceCardV3 - Individual workspace card
 * - WorkspaceStatusBadge - Status indicator badge
 * - WorkspaceCardActions - Action buttons for workspace cards
 */

export { WorkspaceBoard } from "./WorkspaceBoard";
export type { WorkspaceBoardProps } from "./WorkspaceBoard";

export { WorkspaceGroup } from "./WorkspaceGroup";
export type { WorkspaceGroupProps, WorkspaceGroupId } from "./WorkspaceGroup";

export { WorkspaceCardV3 } from "./WorkspaceCardV3";
export type { WorkspaceCardV3Props, WorkspaceCardV3Data } from "./WorkspaceCardV3";

export { WorkspaceStatusBadge } from "./WorkspaceStatusBadge";
export type { WorkspaceStatusBadgeProps } from "./WorkspaceStatusBadge";

export { WorkspaceCardActions } from "./WorkspaceCardActions";
export type { WorkspaceCardActionsProps } from "./WorkspaceCardActions";
