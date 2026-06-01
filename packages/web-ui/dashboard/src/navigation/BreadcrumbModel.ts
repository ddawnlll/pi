/**
 * Breadcrumb Model — P42 V3 App Shell
 *
 * Breadcrumb segments represent the current navigation path.
 * Each segment is clickable and navigates to that level.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreadcrumbSegment {
  /** Display label for the segment. */
  label: string;
  /** Unique key for the segment. */
  key: string;
  /** Click handler (navigates to this level). */
  onClick?: () => void;
  /** Whether this segment is the last (current) item. */
  isLast?: boolean;
  /** Optional icon to show before the label. */
  icon?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a long ID to a readable short form.
 */
export function truncateId(id: string, chars = 6): string {
  if (id.length <= chars + 2) return id;
  return `${id.slice(0, chars)}…`;
}

/**
 * Build breadcrumbs for an execution run view.
 */
export function buildRunBreadcrumbs(
  projectName: string | null,
  projectId: string | null,
  taskName: string | null,
  taskId: string | null,
  runTitle: string | null,
  runId: string | null,
  onNavigate?: (route: string) => void,
): BreadcrumbSegment[] {
  const crumbs: BreadcrumbSegment[] = [];

  // Pi logo/home
  crumbs.push({
    label: "Pi",
    key: "home",
    onClick: () => onNavigate?.("/"),
  });

  // Project
  if (projectName || projectId) {
    crumbs.push({
      label: projectName ?? truncateId(projectId ?? ""),
      key: `project-${projectId ?? "unknown"}`,
      onClick: () => onNavigate?.(`/projects/${projectId}`),
    });
  }

  // Task
  if (taskName || taskId) {
    crumbs.push({
      label: taskName ?? truncateId(taskId ?? ""),
      key: `task-${taskId ?? "unknown"}`,
      onClick: () => onNavigate?.(`/projects/${projectId}/tasks/${taskId}`),
    });
  }

  // Run
  if (runTitle || runId) {
    crumbs.push({
      label: runTitle ?? `Run ${truncateId(runId ?? "")}`,
      key: `run-${runId ?? "unknown"}`,
      isLast: true,
    });
  }

  return crumbs;
}

/**
 * Build breadcrumbs for a workspace detail view.
 */
export function buildWorkspaceBreadcrumbs(
  projectName: string | null,
  projectId: string | null,
  taskName: string | null,
  taskId: string | null,
  runTitle: string | null,
  runId: string | null,
  workspaceId: string | null,
  onNavigate?: (route: string) => void,
): BreadcrumbSegment[] {
  const crumbs = buildRunBreadcrumbs(projectName, projectId, taskName, taskId, runTitle, runId, onNavigate);

  if (workspaceId) {
    crumbs.push({
      label: truncateId(workspaceId),
      key: `workspace-${workspaceId}`,
      isLast: true,
    });
  }

  return crumbs;
}
