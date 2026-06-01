/**
 * ArtifactDrawer — P42.10 Contextual Artifact Drawer
 *
 * Shows artifacts/snapshots for a given execution or workspace.
 * Opens on-demand from workspace detail or artifact-related UI.
 */

import { useState, useEffect } from "react";
import { Loader2, FileText, Image, Package, AlertCircle, Download } from "lucide-react";

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

const MUT = "text-stone-400 dark:text-stone-500";
const TXT = "text-stone-700 dark:text-stone-300";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArtifactEntry {
  id: string;
  name: string;
  kind: "file" | "image" | "snapshot" | "other";
  path?: string;
  sizeBytes?: number;
  workspaceId?: string;
  createdAt?: string;
  downloadUrl?: string;
}

export interface ArtifactDrawerProps {
  /** Project ID. */
  projectId: string | null;
  /** Plan execution ID. */
  planExecId: string | null;
  /** Optional workspace ID to scope artifacts. */
  workspaceId?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function kindIcon(kind: ArtifactEntry["kind"]) {
  switch (kind) {
    case "image": return <Image size={13} className="text-blue-500 dark:text-blue-400 shrink-0" />;
    case "snapshot": return <Package size={13} className="text-emerald-500 dark:text-emerald-400 shrink-0" />;
    default: return <FileText size={13} className="text-stone-400 dark:text-stone-500 shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ArtifactDrawer({ projectId, planExecId, workspaceId }: ArtifactDrawerProps) {
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!planExecId) {
      setLoading(false);
      setError("Missing execution ID.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    let url = `/api/artifacts/${encodeURIComponent(planExecId)}`;
    if (workspaceId) {
      url += `?workspaceId=${encodeURIComponent(workspaceId)}`;
    }

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setArtifacts(data.artifacts ?? data.entries ?? []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load artifacts");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [planExecId, workspaceId]);

  // ── Render ──

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-xs justify-center">
        <Loader2 size={14} className="animate-spin text-stone-400" />
        <span className={MUT}>Loading artifacts...</span>
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

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-xs">
        <Package size={16} strokeWidth={1.2} className={MUT} />
        <span className={MUT}>No artifacts found</span>
        <span className={`text-[10px] ${MUT}`}>
          Artifacts are generated after workspace completion.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {artifacts.map((a) => (
        <div
          key={a.id}
          className={`flex items-center gap-3 px-3 py-2.5 border-b ${BORD} last:border-b-0`}
        >
          {kindIcon(a.kind)}
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium truncate ${TXT}`}>
              {a.name}
            </div>
            <div className={`text-[10px] ${MUT} flex items-center gap-2`}>
              <span>{a.kind}</span>
              {a.sizeBytes != null && <span>{formatBytes(a.sizeBytes)}</span>}
              {a.workspaceId && (
                <span className="truncate">· {a.workspaceId.slice(0, 8)}</span>
              )}
            </div>
          </div>
          {a.downloadUrl && (
            <a
              href={a.downloadUrl}
              download
              className={`p-1.5 rounded hover:bg-stone-100 dark:hover:bg-[#2A2A2A] ${MUT} hover:text-stone-600 dark:hover:text-stone-300 transition-colors`}
              title="Download"
            >
              <Download size={12} />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
