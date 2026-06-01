/**
 * FileEvidenceDrawer — P42.10 Contextual File Evidence Drawer
 *
 * Shows file change evidence: what changed, who changed it, which workspace
 * made the change, and the diff. Opens on-demand from Files view or
 * workspace detail cards.
 */

import { useState, useEffect } from "react";
import { Loader2, FileText, FileCode, FilePlus, FileMinus, GitBranch, AlertCircle } from "lucide-react";
import { DiffViewer } from "../DiffViewer";
import type { GitFilePatch } from "../../types";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-700 dark:text-stone-300";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEvidence {
  /** File path relative to repo root. */
  path: string;
  /** Change type. */
  status: "created" | "modified" | "deleted" | "unchanged" | "locked";
  /** Which workspace changed this file. */
  workspaceId?: string;
  /** Related command or validation. */
  relatedCommand?: string;
  /** Diff patches for this file. */
  patches?: GitFilePatch[];
  /** File size in bytes. */
  sizeBytes?: number;
}

export interface FileEvidenceDrawerProps {
  /** Project ID. */
  projectId: string | null;
  /** Plan execution ID. */
  planExecId: string | null;
  /** Optional workspace ID to scope to a specific workspace. */
  workspaceId?: string | null;
  /** Optional specific file path to show evidence for. */
  filePath?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIcon(status: FileEvidence["status"]) {
  switch (status) {
    case "created": return <FilePlus size={13} className="text-emerald-500 dark:text-emerald-400 shrink-0" />;
    case "modified": return <FileCode size={13} className="text-amber-500 dark:text-amber-400 shrink-0" />;
    case "deleted": return <FileMinus size={13} className="text-red-500 dark:text-red-400 shrink-0" />;
    case "locked": return <FileCode size={13} className="text-orange-500 dark:text-orange-400 shrink-0" />;
    default: return <FileText size={13} className="text-stone-400 dark:text-stone-500 shrink-0" />;
  }
}

function statusColor(status: FileEvidence["status"]): string {
  switch (status) {
    case "created": return "text-emerald-600 dark:text-emerald-400";
    case "modified": return "text-amber-600 dark:text-amber-400";
    case "deleted": return "text-red-600 dark:text-red-400";
    case "locked": return "text-orange-600 dark:text-orange-400";
    default: return MUT;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileEvidenceDrawer({ projectId, planExecId, workspaceId, filePath }: FileEvidenceDrawerProps) {
  const [evidence, setEvidence] = useState<FileEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  useEffect(() => {
    if (!planExecId) {
      setLoading(false);
      setError("Missing execution ID.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Fetch changed files from the read model / API
    const base = projectId
      ? `/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planExecId)}`
      : `/api/plans/${encodeURIComponent(planExecId)}`;

    let url = `${base}/workspaces${workspaceId ? `/${encodeURIComponent(workspaceId)}/git-diff` : ""}`;
    if (workspaceId && filePath) {
      url += `?file=${encodeURIComponent(filePath)}`;
    }

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          // Normalize shape from both endpoint variants
          const raw: FileEvidence[] = data.evidence ?? data.files ?? [];
          setEvidence(raw);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load file evidence");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [projectId, planExecId, workspaceId, filePath]);

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs justify-center">
        <Loader2 size={14} className="animate-spin text-stone-400" />
        <span className={MUT}>Loading file evidence...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <AlertCircle size={16} className="text-stone-400" />
        <span className={MUT}>{error}</span>
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <FileText size={16} strokeWidth={1.2} className={MUT} />
        <span className={MUT}>No file changes to show</span>
        <span className={`text-[10px] ${MUT}`}>
          Files change as workspaces complete their work.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {evidence.map((f, i) => (
        <div key={`${f.path}-${i}`}>
          {/* File row */}
          <button
            onClick={() => setExpandedFile(expandedFile === f.path ? null : f.path)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 border-b ${BORD} text-left transition-colors hover:bg-stone-50 dark:hover:bg-[#2A2A2A] ${
              expandedFile === f.path ? ACC_BG : ""
            }`}
          >
            {statusIcon(f.status)}
            <div className="flex-1 min-w-0">
              <div className={`text-xs font-medium truncate ${TXT}`}>
                {f.path}
              </div>
              <div className={`text-[10px] ${statusColor(f.status)} flex items-center gap-2`}>
                <span>{f.status}</span>
                {f.workspaceId && (
                  <span className="truncate">· {f.workspaceId.slice(0, 8)}</span>
                )}
                {f.relatedCommand && (
                  <span className={`truncate ${MUT}`}>· {f.relatedCommand}</span>
                )}
              </div>
            </div>
            <GitBranch size={11} className={MUT} />
          </button>

          {/* Expanded diff */}
          {expandedFile === f.path && f.patches && f.patches.length > 0 && (
            <div className={`border-b ${BORD}`}>
              <DiffViewer patches={f.patches} />
            </div>
          )}

          {expandedFile === f.path && (!f.patches || f.patches.length === 0) && (
            <div className={`px-3 py-3 text-xs ${MUT} border-b ${BORD}`}>
              No diff available for this file.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
