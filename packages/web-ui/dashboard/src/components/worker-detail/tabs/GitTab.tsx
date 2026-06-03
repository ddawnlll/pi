import { useState } from "react";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import type { WorkspaceSummary, GitFilePatch } from "../../../types";
import { DiffViewer } from "../../DiffViewer";

interface GitTabProps {
	workspace?: WorkspaceSummary;
	planExecId: string | null;
	workerId: string;
	patches: GitFilePatch[];
	diffLoading: boolean;
	diffError: string | null;
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex">
			<span className="text-stone-400 dark:text-stone-500 w-20 shrink-0">{label}:</span>
			<span className="text-stone-800 dark:text-stone-200 truncate">{value}</span>
		</div>
	);
}

function TableView({ patches }: { patches: GitFilePatch[] }) {
	return (
		<div className="bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded overflow-hidden">
			<table className="w-full text-xs">
				<thead>
					<tr className="bg-stone-100 dark:bg-[#222] text-stone-400 dark:text-stone-500">
						<th className="text-left px-2 py-1 font-medium">File</th>
						<th className="text-center px-2 py-1 font-medium w-16">Status</th>
						<th className="text-right px-2 py-1 font-medium w-12">+</th>
						<th className="text-right px-2 py-1 font-medium w-12">-</th>
					</tr>
				</thead>
				<tbody>
					{patches.map((fc) => {
						const addCount = (fc.patch.match(/^\+/gm) || []).length;
						const delCount = (fc.patch.match(/^-/gm) || []).length;
						const statusColors: Record<string, string> = {
							added: "text-emerald-600 dark:text-emerald-400",
							modified: "text-amber-600 dark:text-amber-400",
							deleted: "text-red-600 dark:text-red-400",
							renamed: "text-blue-700 dark:text-blue-300",
							copied: "text-violet-600 dark:text-violet-400",
							unmerged: "text-orange-600 dark:text-orange-400",
						};
						return (
							<tr key={fc.path} className="border-t border-[#E8E6E1] dark:border-[#333]">
								<td className="px-2 py-1 font-mono text-stone-800 dark:text-stone-200 truncate max-w-[200px]" title={fc.path}>{fc.path}</td>
								<td className="px-2 py-1 text-center"><span className={statusColors[fc.status] ?? "text-stone-500"}>{fc.status}</span></td>
								<td className="px-2 py-1 text-right text-emerald-600 dark:text-emerald-400 font-mono">{addCount > 0 ? `+${addCount}` : ""}</td>
								<td className="px-2 py-1 text-right text-red-600 dark:text-red-400 font-mono">{delCount > 0 ? `-${delCount}` : ""}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

export function GitTab({ workspace, planExecId, workerId, patches, diffLoading, diffError }: GitTabProps) {
	const { gitBranch: branch, gitDirty: dirty, gitCommits: commits, stage } = workspace ?? {};
	const [useTableView, setUseTableView] = useState(false);
	const [showWriteSet, setShowWriteSet] = useState(false);

	if (!branch && dirty === undefined && (!commits || commits.length === 0) && patches.length === 0 && !diffLoading && !diffError) {
		return <div className="flex items-center justify-center h-32 text-stone-400 dark:text-stone-500 text-xs pt-3">Git data unavailable</div>;
	}

	const isPending = stage !== "complete" && stage !== "failed";
	const ws = workspace as any;

	return (
		<div className="text-xs space-y-3 text-stone-600 dark:text-stone-400 pt-3">
			{branch && <Row label="Branch" value={branch} />}
			{dirty !== undefined && <Row label="Working tree" value={dirty ? "Dirty" : "Clean"} />}
			{commits && commits.length > 0 && (
				<div><span className="text-stone-400 dark:text-stone-500 block mb-1">Recent commits:</span>
					{commits.map((c: string, i: number) => <div key={i} className="font-mono truncate text-stone-600 dark:text-stone-400">{c}</div>)}
				</div>
			)}

			{ws?.empiricalWriteSet && (
				<div className="pt-2 border-t border-[#E8E6E1] dark:border-[#333]">
					<div className="flex items-center gap-1.5 mb-1">
						<span className="text-stone-400 dark:text-stone-500 text-xs font-semibold uppercase tracking-wider">WriteSet</span>
						{ws.driftStatus === "drifted" ? (
							<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
								<AlertTriangle size={8} /> Drifted ({ws.undeclaredWriteCount ?? 0} undeclared)
							</span>
						) : (
							<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
								<CheckCircle size={8} /> Clean
							</span>
						)}
					</div>
					{ws.empiricalWriteSet?.length > 0 && (
						<>
							<button onClick={() => setShowWriteSet(!showWriteSet)} className="text-xs text-blue-700 dark:text-blue-300 hover:underline">
								{showWriteSet ? "Hide" : "Show"} empirical write set ({ws.empiricalWriteSet.length} files)
							</button>
							{showWriteSet && (
								<div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
									{ws.empiricalWriteSet.map((f: string, i: number) => (
										<div key={i} className="text-xs font-mono text-stone-600 dark:text-stone-400">{f}</div>
									))}
								</div>
							)}
						</>
					)}
					{ws.integrationBlocked && <div className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400"><XCircle size={10} />Integration blocked</div>}
					{ws.requiresHumanReview && <div className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle size={10} />Requires human review</div>}
				</div>
			)}

			<div className="pt-2 border-t border-[#E8E6E1] dark:border-[#333]">
				<div className="flex items-center justify-between mb-2">
					<span className="text-stone-400 dark:text-stone-500 font-semibold">File changes:</span>
					{!isPending && patches.length > 0 && (
						<button onClick={() => setUseTableView(!useTableView)} className="text-xs text-blue-700 dark:text-blue-300 hover:underline">
							{useTableView ? "Show diff view" : "Show table view"}
						</button>
					)}
				</div>
				{diffLoading && <div className="text-stone-400 dark:text-stone-500 italic">Loading...</div>}
				{diffError && !diffLoading && <div className="text-amber-600 dark:text-amber-400 italic">{diffError}</div>}
				{!diffLoading && !diffError && isPending && <DiffViewer patches={[]} pending />}
				{!diffLoading && !diffError && !isPending && patches.length === 0 && <div className="text-stone-400 dark:text-stone-500 italic">No uncommitted changes</div>}
				{!diffLoading && !diffError && !isPending && patches.length > 0 && !useTableView && <DiffViewer patches={patches} />}
				{!diffLoading && !diffError && !isPending && patches.length > 0 && useTableView && <TableView patches={patches} />}
			</div>
		</div>
	);
}
