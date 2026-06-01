/**
 * DeadlockDependencyPanel — Shows deadlock dependency edges (P42.09).
 *
 * Displays a mini dependency graph for blocked workspaces, highlighting
 * deadlock cycles or dependency chains that prevent progress.
 * Each node shows the workspace ID, stage, and dependency relationships.
 *
 * Uses the DependencyGraphNode format from execution-core read model.
 *
 * Acceptance Criteria:
 * - Shows dependency nodes for blocked workspaces
 * - Highlights deadlock cycles when detected
 * - Visualizes dependency edges
 * - Handles empty/non-blocked states
 */

import { AlertTriangle, ArrowRight, GitBranch, RotateCw } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyNode {
  id: string;
  title?: string;
  dependsOn: string[];
  batch: number;
  stage: string;
}

export interface DeadlockDependencyPanelProps {
  /** All dependency graph nodes for the plan */
  nodes?: DependencyNode[];
  /** IDs of currently blocked workspaces */
  blockedWorkspaceIds?: string[];
  /** Optional class name */
  className?: string;
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const WARN_TXT = "text-amber-600 dark:text-amber-400";
const WARN_BG = "bg-amber-50 dark:bg-amber-900/20";
const ERR_TXT = "text-red-600 dark:text-red-400";
const ERR_BG = "bg-red-50 dark:bg-red-900/20";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect if a workspace is in a deadlock cycle.
 * A deadlock cycle exists when the workspace transitively depends on itself.
 */
function detectDeadlockCycle(
  workspaceId: string,
  nodes: Map<string, DependencyNode>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(workspaceId)) return true; // Cycle detected
  visited.add(workspaceId);

  const node = nodes.get(workspaceId);
  if (!node) return false;

  for (const dep of node.dependsOn) {
    if (detectDeadlockCycle(dep, nodes, new Set(visited))) {
      return true;
    }
  }
  return false;
}

/**
 * Find all workspaces that this workspace transitively depends on.
 */
function getTransitiveDeps(
  workspaceId: string,
  nodes: Map<string, DependencyNode>,
  result: Set<string> = new Set(),
): Set<string> {
  const node = nodes.get(workspaceId);
  if (!node) return result;

  for (const dep of node.dependsOn) {
    if (!result.has(dep)) {
      result.add(dep);
      getTransitiveDeps(dep, nodes, result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeadlockDependencyPanel({
  nodes,
  blockedWorkspaceIds,
  className = "",
}: DeadlockDependencyPanelProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div className={`text-xs ${MUT} italic py-1 ${className}`}>
        No dependency data available
      </div>
    );
  }

  if (!blockedWorkspaceIds || blockedWorkspaceIds.length === 0) {
    return (
      <div className={`text-xs ${MUT} italic py-1 ${className}`}>
        No blocked workspaces
      </div>
    );
  }

  const nodeMap = new Map<string, DependencyNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Filter to blocked workspaces
  const blockedNodes = nodes.filter((n) => blockedWorkspaceIds.includes(n.id));

  // Detect deadlock cycles
  const deadlockedIds = new Set(
    blockedNodes.filter((n) => detectDeadlockCycle(n.id, nodeMap)).map((n) => n.id),
  );

  if (blockedNodes.length === 0) {
    return (
      <div className={`text-xs ${MUT} italic py-1 ${className}`}>
        No blocked workspace dependency data
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header */}
      <div className={`flex items-center gap-1.5 ${MUT}`}>
        <GitBranch size={11} />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          Dependency Deadlock
        </span>
        {deadlockedIds.size > 0 && (
          <span className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold ${ERR_BG} ${ERR_TXT}`}>
            {deadlockedIds.size} cycle{deadlockedIds.size !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Blocked workspace list */}
      <div className="space-y-1.5">
        {blockedNodes.map((node) => {
          const isDeadlocked = deadlockedIds.has(node.id);
          const transitiveDeps = getTransitiveDeps(node.id, nodeMap);

          // Find which dependencies are also blocked (directly contributing)
          const blockingDeps = node.dependsOn.filter((dep) => {
            const d = nodeMap.get(dep);
            return d && d.stage !== "complete";
          });

          return (
            <div
              key={node.id}
              className={`rounded border p-2 ${
                isDeadlocked ? `${ERR_BG} border-red-300 dark:border-red-700` : `${BORD}`
              }`}
            >
              {/* Workspace ID + badge */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] font-mono font-medium ${TXT}`}>
                  {node.title ?? node.id.slice(0, 8)}
                </span>
                {isDeadlocked && (
                  <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold ${ERR_TXT}`}>
                    <RotateCw size={9} />
                    Deadlock
                  </span>
                )}
                <span className={`text-[9px] ${MUT} ml-auto`}>
                  Batch {node.batch}
                </span>
              </div>

              {/* Dependencies */}
              {node.dependsOn.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {node.dependsOn.map((depId) => {
                    const depNode = nodeMap.get(depId);
                    const isBlocking = blockingDeps.includes(depId);
                    return (
                      <div
                        key={depId}
                        className={`flex items-center gap-1 text-[10px] ${
                          isBlocking ? WARN_TXT : MUT
                        }`}
                      >
                        {isBlocking ? (
                          <AlertTriangle size={9} />
                        ) : (
                          <ArrowRight size={9} />
                        )}
                        <span className="font-mono">
                          {depNode?.title ?? depId.slice(0, 8)}
                        </span>
                        {depNode && (
                          <span className={`text-[9px] ${isBlocking ? WARN_TXT : MUT}`}>
                            ({depNode.stage})
                          </span>
                        )}
                        {isBlocking && (
                          <span className={`text-[9px] font-medium ${WARN_TXT}`}>
                            blocking
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* No dependencies */}
              {node.dependsOn.length === 0 && (
                <div className={`text-[10px] ${MUT} mt-1`}>
                  No dependencies — blocked by internal condition
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
