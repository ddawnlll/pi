/**
 * ArtifactBrowser -- P5 Workstream 5.C
 *
 * A tree-based browser for execution archive artifacts.
 * Lists all generated artifacts for a plan run and allows
 * opening workspace packets, final summaries, diff patches,
 * and tool-call logs. Large artifacts are safely truncated
 * with a clear notice.
 *
 * Security: the browser only reads files from the execution
 * archive under `.pi/executions/` via the API -- it cannot
 * browse arbitrary repo files.
 */

import { useState, useCallback, useMemo } from "react";
import {
  FolderOpen, FolderClosed, FileText, FileJson, FileCode,
  ChevronRight, ChevronDown, AlertCircle, Loader2,
} from "lucide-react";
import type { ArtifactEntry, ArtifactTreeNode } from "../types-artifacts";
import { useArtifactList, useArtifactContent } from "../hooks/useArtifacts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BORD = "border-[#E8E6E1] dark:border-[#333]";
const SURF = "bg-white dark:bg-[#1E1E1E]";
const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-800 dark:text-stone-200";

/** Max lines to show for artifact content before truncation UI hint */
const MAX_DISPLAY_LINES = 500;

// ---------------------------------------------------------------------------
// Artifact type detection
// ---------------------------------------------------------------------------

/**
 * Determine the icon and label for an artifact based on its name.
 */
function getArtifactMeta(path: string): { icon: typeof FileText; label: string; category: string } {
  const basename = path.split("/").pop() ?? "";

  if (basename === "packet.md") return { icon: FileText, label: "Workspace Packet", category: "workspace" };
  if (basename === "diff.patch") return { icon: FileCode, label: "Diff Patch", category: "workspace" };
  if (basename === "tool-calls.ndjson") return { icon: FileJson, label: "Tool-Call Log", category: "workspace" };
  if (basename === "final-summary.md") return { icon: FileText, label: "Final Summary", category: "plan" };
  if (basename === "original-plan.md") return { icon: FileText, label: "Original Plan", category: "plan" };
  if (basename === "parsed-contract.json") return { icon: FileJson, label: "Parsed Contract", category: "plan" };
  if (basename === "doctor-report.json") return { icon: FileJson, label: "Doctor Report", category: "plan" };
  if (basename === "dry-run-report.json") return { icon: FileJson, label: "Dry-Run Report", category: "plan" };
  if (basename === "workspace-dag.json") return { icon: FileJson, label: "Workspace DAG", category: "plan" };
  if (basename === "safety-policy.json") return { icon: FileJson, label: "Safety Policy", category: "plan" };
  if (basename === "commits.json") return { icon: FileJson, label: "Commits", category: "plan" };
  if (basename === "reviewer-verdict.md") return { icon: FileText, label: "Reviewer Verdict", category: "workspace" };
  if (basename === "files-touched.json") return { icon: FileJson, label: "Files Touched", category: "workspace" };
  if (basename === "events.ndjson") return { icon: FileJson, label: "Events", category: "workspace" };
  if (basename === "decisions.ndjson") return { icon: FileJson, label: "Decisions", category: "workspace" };
  if (basename === "narrative.ndjson") return { icon: FileJson, label: "Narrative", category: "workspace" };
  if (basename === "audit.ndjson") return { icon: FileJson, label: "Audit", category: "workspace" };
  if (basename === "structured.ndjson") return { icon: FileJson, label: "Structured Log", category: "workspace" };
  if (basename === "raw.log") return { icon: FileText, label: "Raw Log", category: "workspace" };

  const ext = basename.includes(".") ? "." + basename.split(".").pop()!.toLowerCase() : "";
  if (ext === ".md") return { icon: FileText, label: basename, category: "document" };
  if (ext === ".json" || ext === ".ndjson") return { icon: FileJson, label: basename, category: "data" };
  if (ext === ".patch") return { icon: FileCode, label: basename, category: "diff" };
  if (ext === ".log" || ext === ".txt") return { icon: FileText, label: basename, category: "log" };
  if (ext === ".csv") return { icon: FileText, label: basename, category: "data" };
  if (ext === ".yaml" || ext === ".yml" || ext === ".toml") return { icon: FileCode, label: basename, category: "config" };

  return { icon: FileText, label: basename, category: "other" };
}

// ---------------------------------------------------------------------------
// Build tree from flat artifact list
// ---------------------------------------------------------------------------

/**
 * Convert a flat list of artifact paths into a tree structure.
 *
 * @param artifacts - Flat list of artifact entries
 * @returns Root tree node with children
 */
function buildArtifactTree(artifacts: ArtifactEntry[]): ArtifactTreeNode {
  const root: ArtifactTreeNode = {
    name: "Execution Artifacts",
    path: "",
    isDirectory: true,
    children: [],
    size: 0,
    expanded: true,
  };

  for (const entry of artifacts) {
    const parts = entry.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join("/");

      if (isLast) {
        // File node
        current.children.push({
          name: part,
          path: pathSoFar,
          isDirectory: false,
          children: [],
          size: entry.size,
        });
      } else {
        // Directory node
        let dirNode = current.children.find(c => c.isDirectory && c.name === part);
        if (!dirNode) {
          dirNode = {
            name: part,
            path: pathSoFar,
            isDirectory: true,
            children: [],
            size: 0,
            expanded: i === 0, // Expand first level
          };
          current.children.push(dirNode);
        }
        current = dirNode;
      }
    }
  }

  // Sort: directories first, then files alphabetically
  const sortChildren = (node: ArtifactTreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.isDirectory) sortChildren(child);
    }
  };
  sortChildren(root);

  return root;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a file has JSON content based on extension.
 */
function isJsonContent(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "json" || ext === "ndjson";
}

/**
 * File size formatter.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format artifact content for display.
 * For JSON/NDJSON, attempt pretty-printing. For everything else, return as-is.
 */
function formatArtifactContent(path: string, content: string): string {
  if (!isJsonContent(path)) return content;

  try {
    if (path.endsWith(".ndjson")) {
      return content
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          try { return JSON.stringify(JSON.parse(line), null, 2); }
          catch { return line; }
        })
        .join("\n");
    }
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}


/** Split a string by newlines confidently. */
function splitLines(s: string): string[] {
  return s.split(/\r?\n/);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * A single tree node in the artifact tree.
 */
function TreeNode({
  node,
  selectedPath,
  onSelectFile,
  expandedPaths,
  onToggleDir,
  depth = 0,
}: {
  node: ArtifactTreeNode;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleDir: (path: string) => void;
  depth?: number;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const meta = !node.isDirectory ? getArtifactMeta(node.path) : null;
  const Icon = meta ? meta.icon : (isExpanded ? FolderOpen : FolderClosed);

  const handleClick = useCallback(() => {
    if (node.isDirectory) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  }, [node, onToggleDir, onSelectFile]);

  return (
    <div>
      <button
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 py-1 pr-2 text-left hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors text-xs ${
          isSelected ? "bg-[#EBF2FF] dark:bg-[#1A2A44]" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.isDirectory && (
          isExpanded
            ? <ChevronDown size={10} className={`${MUT} shrink-0`} />
            : <ChevronRight size={10} className={`${MUT} shrink-0`} />
        )}
        {!node.isDirectory && <span className="w-[10px] shrink-0" />}
        <Icon size={13} className={`shrink-0 ${node.isDirectory ? MUT : ""}`} />
        <span className={`truncate flex-1 ${isSelected ? "text-blue-700 dark:text-blue-300 font-medium" : TXT}`}>
          {meta ? meta.label : node.name}
        </span>
        {!node.isDirectory && node.size > 0 && (
          <span className={`${MUT} text-[9px] shrink-0`}>{formatFileSize(node.size)}</span>
        )}
      </button>
      {node.isDirectory && isExpanded && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
              expandedPaths={expandedPaths}
              onToggleDir={onToggleDir}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Content viewer for a selected artifact.
 */
function ArtifactContentView({
  planExecId,
  artifactPath,
  onClose,
}: {
  planExecId: string;
  artifactPath: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useArtifactContent(
    artifactPath ? planExecId : null,
    artifactPath,
  );

  if (!artifactPath) {
    return (
      <div className={`h-full flex flex-col items-center justify-center gap-2 ${MUT}`}>
        <FileText size={24} strokeWidth={1.2} />
        <p className="text-xs">Select an artifact to view its content</p>
      </div>
    );
  }

  const meta = getArtifactMeta(artifactPath);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-stone-400 dark:text-stone-500">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">Loading {meta.label}...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-red-500">
        <AlertCircle size={16} />
        <span className="text-xs">Failed to load artifact</span>
        <span className="text-[10px] text-stone-400 dark:text-stone-500">{String(error)}</span>
      </div>
    );
  }

  if (!data) return null;

  const formatted = formatArtifactContent(artifactPath, data.content);
  const lines = splitLines(formatted);
  const displayLines = lines.slice(0, MAX_DISPLAY_LINES);
  const hasMore = data.truncated || lines.length > MAX_DISPLAY_LINES;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`shrink-0 flex items-center justify-between px-3 py-2 border-b ${BORD}`}>
        <div className="flex items-center gap-2 min-w-0">
          <meta.icon size={14} className="shrink-0" />
          <span className={`text-xs font-medium ${TXT} truncate`}>{meta.label}</span>
          <span className={`text-[10px] ${MUT} shrink-0`}>{formatFileSize(data.totalSize)}</span>
        </div>
        <button
          onClick={onClose}
          className={`text-xs ${MUT} hover:text-stone-600 dark:hover:text-stone-300 shrink-0`}
        >
          Close
        </button>
      </div>

      {/* Truncation notice */}
      {hasMore && (
        <div className={`shrink-0 px-3 py-1.5 text-[10px] bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 flex items-center gap-1.5`}>
          <AlertCircle size={11} className="shrink-0" />
          <span>
            Artifact is large ({formatFileSize(data.totalSize)}).
            {data.truncated
              ? ` Showing first ${formatFileSize(data.returnedSize)} of ${formatFileSize(data.totalSize)}.`
              : ` Showing first ${MAX_DISPLAY_LINES} of ${lines.length.toLocaleString()} lines.`}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <pre className={`p-3 text-xs font-mono ${TXT} whitespace-pre-wrap break-words`}>
          {displayLines.map((line, i) => (
            <div key={i} className="flex">
              <span className={`${MUT} select-none w-10 shrink-0 text-right pr-3`}>{i + 1}</span>
              <span className="flex-1 min-w-0">{line}</span>
            </div>
          ))}
          {hasMore && (
            <div className={`${MUT} italic py-2`}>
              ... {data.truncated
                ? `${formatFileSize(data.totalSize - data.returnedSize)} more`
                : `${(lines.length - MAX_DISPLAY_LINES).toLocaleString()} more lines`}
            </div>
          )}
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ArtifactBrowser component
// ---------------------------------------------------------------------------

interface ArtifactBrowserProps {
  /** Currently selected plan execution ID */
  planExecId: string | null;
}

/**
 * ArtifactBrowser provides a tree view of all generated artifacts
 * for a plan execution, with content viewing for individual files.
 *
 * It reads only from the execution archive under `.pi/executions/`
 * via the API, so it cannot browse arbitrary repo files.
 */
export function ArtifactBrowser({ planExecId }: ArtifactBrowserProps) {
  const { data, isLoading, error } = useArtifactList(planExecId);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["", "workspaces"]));

  // Reset selection when planExecId changes
  const currentPlanExecId = planExecId;
  const [lastPlanExecId, setLastPlanExecId] = useState<string | null>(null);
  if (currentPlanExecId !== lastPlanExecId) {
    setLastPlanExecId(currentPlanExecId);
    setSelectedPath(null);
    setExpandedPaths(new Set(["", "workspaces"]));
  }

  const tree = useMemo(() => {
    if (!data?.artifacts?.length) return null;
    return buildArtifactTree(data.artifacts);
  }, [data]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedPath(null);
  }, []);

  if (!planExecId) {
    return (
      <div className={`h-full flex flex-col items-center justify-center gap-2 ${MUT}`}>
        <FileText size={28} strokeWidth={1.2} />
        <p className="text-xs">Select a plan run to view its artifacts</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-stone-400 dark:text-stone-500">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-xs">Loading artifacts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-red-500">
        <AlertCircle size={16} />
        <span className="text-xs">Failed to load artifacts</span>
      </div>
    );
  }

  if (!tree || tree.children.length === 0) {
    return (
      <div className={`h-full flex flex-col items-center justify-center gap-2 ${MUT}`}>
        <FileText size={28} strokeWidth={1.2} />
        <p className="text-xs">No artifacts found for this run</p>
        <p className="text-[10px]">Artifacts are created when a plan execution completes</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tree panel */}
      <div className={`w-64 shrink-0 ${SURF} border-r ${BORD} overflow-y-auto`}>
        {tree.children.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            selectedPath={selectedPath}
            onSelectFile={handleSelectFile}
            expandedPaths={expandedPaths}
            onToggleDir={handleToggleDir}
            depth={0}
          />
        ))}
      </div>
      {/* Content panel */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <ArtifactContentView
          planExecId={planExecId}
          artifactPath={selectedPath}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}
