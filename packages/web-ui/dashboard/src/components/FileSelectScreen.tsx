/**
 * FileSelectScreen — Step 1 of the plan upload wizard.
 *
 * Users drag-and-drop or browse for plan files (.md, .json, .txt),
 * toggle per-file selection, and choose execution mode (parallel/sequential).
 */

import { useCallback, useRef, useState, useMemo } from "react";
import {
	Upload,
	FileText,
	CheckSquare,
	Square,
	AlertTriangle,
	ArrowUpDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
	file: File;
	content: string;
	status: "ready" | "warn" | "error";
	statusMessage?: string;
}

export type ScaleMode = "stable_3" | "stable_6" | "experimental_worktree_6" | "scale_8";

const SCALE_MODE_DESCRIPTIONS: Record<ScaleMode, string> = {
	stable_3: "3 workers, direct execution — default safe mode",
	stable_6: "6 workers, patch_transaction isolation — PatchCoordinator, PatchArtifact, rollback",
	experimental_worktree_6: "6 workers, legacy worktree isolation — integration queue, validation lock",
	scale_8: "8 workers, explicit approval — highest parallelism, worktree isolation",
};

interface FileSelectScreenProps {
	files: FileEntry[];
	onFilesChange: (files: FileEntry[]) => void;
	executionMode: "parallel" | "sequential";
	onExecutionModeChange: (mode: "parallel" | "sequential") => void;
	scaleMode: ScaleMode;
	onScaleModeChange: (mode: ScaleMode) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SortKey = "name" | "size" | "status";

const ALLOWED_EXTENSIONS = [".md", ".json", ".txt"];

function getFileStatus(file: File): { status: FileEntry["status"]; message?: string } {
	const ext = "." + file.name.split(".").pop()?.toLowerCase();
	if (!ALLOWED_EXTENSIONS.includes(ext)) {
		return { status: "error", message: `Unsupported format: ${ext}. Use .md, .json, or .txt` };
	}
	if (file.size === 0) {
		return { status: "error", message: "File is empty" };
	}
	if (file.size > 1024 * 1024) {
		return { status: "warn", message: `Large file (${(file.size / 1024 / 1024).toFixed(1)} MB)` };
	}
	// Check for plan-like content markers (basic heuristic)
	return { status: "ready" };
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileSelectScreen({
	files,
	onFilesChange,
	executionMode,
	onExecutionModeChange,
	scaleMode,
	onScaleModeChange,
}: FileSelectScreenProps) {
	const [dragging, setDragging] = useState(false);
	const [sortKey, setSortKey] = useState<SortKey>("name");
	const [sortAsc, setSortAsc] = useState(true);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Track selected file names
	const selectedNames = useMemo(
		() => new Set(files.map((f) => f.file.name)),
		[files],
	);
	const allSelected = files.length > 0 && files.every((f) => selectedNames.has(f.file.name));

	// ── Sorting ──

	const sortedFiles = useMemo(() => {
		const sorted = [...files];
		sorted.sort((a, b) => {
			let cmp = 0;
			switch (sortKey) {
				case "name":
					cmp = a.file.name.localeCompare(b.file.name);
					break;
				case "size":
					cmp = a.file.size - b.file.size;
					break;
				case "status":
					cmp = a.status.localeCompare(b.status);
					break;
			}
			return sortAsc ? cmp : -cmp;
		});
		return sorted;
	}, [files, sortKey, sortAsc]);

	const cycleSort = useCallback(() => {
		const keys: SortKey[] = ["name", "size", "status"];
		const idx = keys.indexOf(sortKey);
		const next = keys[(idx + 1) % keys.length];
		if (next === sortKey) {
			setSortAsc(!sortAsc);
		} else {
			setSortKey(next);
			setSortAsc(true);
		}
	}, [sortKey, sortAsc]);

	// ── File reading ──

	const readFiles = useCallback(
		async (fileList: FileList | File[]) => {
			const newEntries: FileEntry[] = [];
			const existingNames = new Set(files.map((f) => f.file.name));

			for (const file of Array.from(fileList)) {
				if (existingNames.has(file.name)) continue; // skip duplicates
				const { status, message } = getFileStatus(file);
				try {
					const content = await file.text();
					newEntries.push({ file, content, status, statusMessage: message });
				} catch {
					newEntries.push({
						file,
						content: "",
						status: "error",
						statusMessage: "Could not read file",
					});
				}
			}

			if (newEntries.length > 0) {
				onFilesChange([...files, ...newEntries]);
			}
		},
		[files, onFilesChange],
	);

	// ── Drag & drop handlers ──

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setDragging(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setDragging(false);
			if (e.dataTransfer.files.length > 0) {
				readFiles(e.dataTransfer.files);
			}
		},
		[readFiles],
	);

	// ── Browse ──

	const handleBrowse = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileInputChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (e.target.files && e.target.files.length > 0) {
				readFiles(e.target.files);
			}
			e.target.value = "";
		},
		[readFiles],
	);

	// ── Remove file ──

	const handleRemoveFile = useCallback(
		(fileName: string) => {
			onFilesChange(files.filter((f) => f.file.name !== fileName));
		},
		[files, onFilesChange],
	);

	// ── Status badge ──

	const statusBadge = (status: FileEntry["status"], message?: string) => {
		switch (status) {
			case "ready":
				return (
					<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-900/30 text-emerald-300 border border-emerald-800">
						ready
					</span>
				);
			case "warn":
				return (
					<span
						className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-900/30 text-amber-300 border border-amber-800 cursor-help"
						title={message}
					>
						<AlertTriangle size={8} className="mr-0.5" />
						warn
					</span>
				);
			case "error":
				return (
					<span
						className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-900/30 text-red-300 border border-red-800 cursor-help"
						title={message}
					>
						error
					</span>
				);
		}
	};

	const readyCount = files.filter((f) => f.status === "ready").length;
	const warnCount = files.filter((f) => f.status === "warn").length;
	const errorCount = files.filter((f) => f.status === "error").length;

	return (
		<div className="flex flex-col gap-4">
			{/* ── Drop zone ── */}
			<div
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={handleBrowse}
				className={`relative flex flex-col items-center justify-center gap-2 p-8 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
					dragging
						? "border-blue-500 bg-blue-900/20"
						: "border-gray-600 hover:border-gray-500 bg-gray-800/50"
				}`}
			>
				<Upload size={32} className="text-gray-500" strokeWidth={1.2} />
				<p className="text-sm text-gray-400 font-medium">
					Drop plan files here
				</p>
				<p className="text-[10px] text-gray-600">
					.md &middot; .json &middot; .txt &middot; multiple OK
				</p>
				<input
					ref={fileInputRef}
					type="file"
					accept=".md,.json,.txt"
					multiple
					onChange={handleFileInputChange}
					className="hidden"
				/>
			</div>

			{/* ── Sort header (only when files present) ── */}
			{files.length > 0 && (
				<div className="flex items-center justify-between">
					<span className="text-xs text-gray-500">
						{files.length} file{files.length !== 1 ? "s" : ""} selected
						{errorCount > 0 && (
							<span className="text-red-400 ml-1">
								&middot; {errorCount} with errors
							</span>
						)}
						{warnCount > 0 && (
							<span className="text-amber-400 ml-1">
								&middot; {warnCount} with warnings
							</span>
						)}
					</span>
					<button
						onClick={cycleSort}
						className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
					>
						<ArrowUpDown size={10} />
						Sort: {sortKey}
						{sortAsc ? " \u2191" : " \u2193"}
					</button>
				</div>
			)}

			{/* ── File list ── */}
			{files.length > 0 && (
				<div className="border border-gray-700 rounded overflow-hidden">
					{sortedFiles.map((entry) => (
						<div
							key={entry.file.name}
							className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-700 last:border-b-0 hover:bg-gray-800/50 transition-colors"
						>
							{/* Checkbox (always checked since all are selected) */}
							<CheckSquare size={14} className="text-blue-400 shrink-0" />

							{/* Icon */}
							<FileText size={14} className="text-gray-500 shrink-0" />

							{/* Name & details */}
							<div className="flex-1 min-w-0">
								<p className="text-xs text-gray-200 truncate font-medium">
									{entry.file.name}
								</p>
								<p className="text-[10px] text-gray-500">
									{formatSize(entry.file.size)}
									{entry.statusMessage && (
										<span className="ml-2 text-amber-400">
											{entry.statusMessage}
										</span>
									)}
								</p>
							</div>

							{/* Status badge */}
							{statusBadge(entry.status, entry.statusMessage)}

							{/* Remove button */}
							<button
								onClick={(e) => {
									e.stopPropagation();
									handleRemoveFile(entry.file.name);
								}}
								className="text-gray-600 hover:text-red-400 transition-colors p-0.5"
								title="Remove file"
							>
								<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
									<line x1="1" y1="1" x2="9" y2="9" />
									<line x1="9" y1="1" x2="1" y2="9" />
								</svg>
							</button>
						</div>
					))}
				</div>
			)}

			{/* ── Execution mode toggle ── */}
			{files.length > 0 && (
				<div className="flex items-center gap-4">
					<span className="text-xs text-gray-500 font-medium">
						Execution mode:
					</span>
					<div className="flex bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
						<button
							onClick={() => onExecutionModeChange("parallel")}
							className={`px-3 py-1.5 text-xs font-medium transition-colors ${
								executionMode === "parallel"
									? "bg-blue-700 text-white"
									: "text-gray-400 hover:text-gray-200"
							}`}
						>
							Parallel
						</button>
						<button
							onClick={() => onExecutionModeChange("sequential")}
							className={`px-3 py-1.5 text-xs font-medium transition-colors ${
								executionMode === "sequential"
									? "bg-blue-700 text-white"
									: "text-gray-400 hover:text-gray-200"
							}`}
						>
							Sequential
						</button>
					</div>
					<span className="text-[10px] text-gray-600">
						{executionMode === "parallel"
							? "All plans run concurrently"
							: "Each plan waits for the previous to finish"}
					</span>
				</div>
			)}

			{/* ── Scale mode override ── */}
			{files.length > 0 && (
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-4">
						<span className="text-xs text-gray-500 font-medium">
							Scale mode override:
						</span>
						<span className="text-[10px] text-gray-600">
							Overrides the plan's embedded scale mode for execution
						</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{(Object.keys(SCALE_MODE_DESCRIPTIONS) as ScaleMode[]).map((mode) => (
							<button
								key={mode}
								onClick={() => onScaleModeChange(mode)}
								className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors text-left ${
									scaleMode === mode
										? "bg-blue-700 text-white border-blue-600"
										: "bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500 hover:text-gray-200"
								}`}
							>
								<span className="font-semibold">{mode.replace(/_/g, " ")}</span>
								<span className="block text-[9px] opacity-70 mt-0.5">
									{SCALE_MODE_DESCRIPTIONS[mode]}
								</span>
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
