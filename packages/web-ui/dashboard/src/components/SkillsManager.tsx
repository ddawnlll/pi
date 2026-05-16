/**
 * SkillsManager — Skills management panel.
 *
 * P11.P — Extensions and Skills Manager UI
 *
 * AC1: Skill cards render from backend data.
 * AC2: Install/test flows display policy decisions and audit links.
 * AC4: Compatibility warnings and invalid manifest errors are actionable.
 */

import { useState, type FormEvent } from "react";
import {
	AlertCircle,
	AlertTriangle,
	BookOpen,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	FileCode,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import { useSkills, useSkillDetail, useAuditEvents, type SkillEntry, type SkillTestResult } from "../hooks/useSkills";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";

// ---------------------------------------------------------------------------
// Skill Test Result Modal
// ---------------------------------------------------------------------------

interface TestResultModalProps {
	result: SkillTestResult;
	logs: string;
	onClose: () => void;
}

function TestResultModal({ result, logs, onClose }: TestResultModalProps) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className={`${SURF} border ${BORD} rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4 shrink-0">
					<h3 className={`text-sm font-semibold ${TXT} flex items-center gap-2`}>
						<Zap size={14} />
						Test Result: {result.skillName}
					</h3>
					<button onClick={onClose} className={`${MUT} hover:text-stone-600 dark:hover:text-stone-300`}>
						<X size={16} />
					</button>
				</div>

				{/* Status badges */}
				<div className="flex gap-3 mb-4 shrink-0">
					<div
						className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium ${
							result.status === "passed"
								? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
								: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
						}`}
					>
						{result.status === "passed" ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
						{result.status.toUpperCase()}
					</div>
					<div
						className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium ${
							result.qualityStatus === "compliant"
								? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
								: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
						}`}
					>
						{result.qualityStatus === "compliant" ? (
							<CheckCircle size={12} />
						) : (
							<AlertTriangle size={12} />
						)}
						{result.qualityStatus === "compliant" ? "COMPLIANT" : "NON-COMPLIANT"}
					</div>
				</div>

				{/* Execution info */}
				<div className="flex gap-4 text-xs text-stone-500 dark:text-stone-400 mb-4 shrink-0">
					<span>Duration: {(result.executionTimeMs / 1000).toFixed(2)}s</span>
					<span>Started: {new Date(result.startedAt).toLocaleTimeString()}</span>
				</div>

				{/* Error message */}
				{result.errorMessage && (
					<div className="p-3 rounded-lg border text-xs mb-4 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 shrink-0">
						<strong>Error:</strong> {result.errorMessage}
					</div>
				)}

				{/* Output logs */}
				<div className="flex-1 min-h-0 overflow-y-auto">
					<label className={`block text-[10px] font-medium ${MUT} mb-1`}>Test Logs</label>
					<pre className="bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-3 font-mono text-[10px] text-stone-700 dark:text-stone-300 whitespace-pre-wrap max-h-60 overflow-y-auto">
						{logs || "No output"}
					</pre>
				</div>

				{/* Audit link */}
				<div className="mt-4 pt-3 border-t ${BORD} shrink-0">
					<a
						href="#"
						onClick={(e) => { e.preventDefault(); onClose(); }}
						className={`inline-flex items-center gap-1 text-[10px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
					>
						<ExternalLink size={10} /> View test in audit log
					</a>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Skill Detail Modal
// ---------------------------------------------------------------------------

interface SkillDetailModalProps {
	name: string;
	onClose: () => void;
}

function SkillDetailModal({ name, onClose }: SkillDetailModalProps) {
	const { skill, isLoading, error } = useSkillDetail(name);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className={`${SURF} border ${BORD} rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4 shrink-0">
					<h3 className={`text-sm font-semibold ${TXT} flex items-center gap-2`}>
						<BookOpen size={14} /> Skill: {name}
					</h3>
					<button onClick={onClose} className={`${MUT} hover:text-stone-600 dark:hover:text-stone-300`}>
						<X size={16} />
					</button>
				</div>

				{isLoading && (
					<div className="flex items-center justify-center py-8">
						<Loader2 size={16} className="animate-spin text-stone-400" />
					</div>
				)}

				{error && (
					<div className="p-3 rounded-lg border text-xs bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
						{error instanceof Error ? error.message : String(error)}
					</div>
				)}

				{skill && (
					<div className="flex-1 min-h-0 overflow-y-auto space-y-4">
						<div className="grid grid-cols-2 gap-3 text-xs">
							<div>
								<span className={MUT}>Name</span>
								<p className={`font-medium ${TXT}`}>{skill.name}</p>
							</div>
							<div>
								<span className={MUT}>Valid</span>
								<p className={`font-medium ${skill.valid ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
									{skill.valid ? "Yes" : "No"}
								</p>
							</div>
							<div className="col-span-2">
								<span className={MUT}>Description</span>
								<p className={`font-medium ${TXT}`}>{skill.description || "No description"}</p>
							</div>
							<div className="col-span-2">
								<span className={MUT}>File Path</span>
								<p className={`font-mono text-[10px] ${TXT} break-all`}>{skill.filePath}</p>
							</div>
							{skill.baseDir && (
								<div className="col-span-2">
									<span className={MUT}>Base Directory</span>
									<p className={`font-mono text-[10px] ${TXT} break-all`}>{skill.baseDir}</p>
								</div>
							)}
							<div>
								<span className={MUT}>Required</span>
								<p className={`font-medium ${skill.required ? "text-amber-600 dark:text-amber-400" : TXT}`}>
									{skill.required ? "Yes" : "No"}
								</p>
							</div>
							{skill.disableModelInvocation !== undefined && (
								<div>
									<span className={MUT}>Model Invocation</span>
									<p className={`font-medium ${skill.disableModelInvocation ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
										{skill.disableModelInvocation ? "Disabled" : "Enabled"}
									</p>
								</div>
							)}
						</div>

						{/* Validation messages */}
						{skill.validationMessages && skill.validationMessages.length > 0 && (
							<div>
								<span className={`block text-xs font-medium ${MUT} mb-2`}>Validation Messages</span>
								<div className="space-y-1">
									{skill.validationMessages.map((msg, i) => (
										<div
											key={i}
											className={`p-2 rounded text-[10px] flex items-start gap-1.5 ${
												msg.toLowerCase().includes("error")
													? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
													: msg.toLowerCase().includes("warn")
														? "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
														: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
											}`}
										>
											{msg.toLowerCase().includes("error") ? (
												<AlertCircle size={10} className="shrink-0 mt-0.5" />
											) : msg.toLowerCase().includes("warn") ? (
												<AlertTriangle size={10} className="shrink-0 mt-0.5" />
											) : (
												<CheckCircle size={10} className="shrink-0 mt-0.5" />
											)}
											<span>{msg}</span>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Content preview */}
						{skill.content && (
							<div>
								<span className={`block text-xs font-medium ${MUT} mb-2`}>Content Preview</span>
								<pre className="bg-stone-50 dark:bg-[#161616] border border-[#E8E6E1] dark:border-[#333] rounded p-3 font-mono text-[10px] text-stone-700 dark:text-stone-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
									{skill.content.length > 2000
										? `${skill.content.slice(0, 2000)}\n... (${skill.content.length - 2000} more characters)`
										: skill.content}
								</pre>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Skill Card
// ---------------------------------------------------------------------------

interface SkillCardProps {
	skill: SkillEntry;
	onTest: (name: string) => Promise<void>;
	onUninstall: (name: string) => Promise<void>;
	onViewDetail: (name: string) => void;
	isTesting: boolean;
	isUninstalling: boolean;
}

function SkillCard({ skill, onTest, onUninstall, onViewDetail, isTesting, isUninstalling }: SkillCardProps) {
	const [expanded, setExpanded] = useState(false);
	const [actionMsg, setActionMsg] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const busy = isTesting || isUninstalling;

	const showAction = (msg: string, err?: string) => {
		setActionMsg(msg);
		setActionError(err ?? null);
		setTimeout(() => { setActionMsg(null); setActionError(null); }, 4000);
	};

	const handleTest = async () => {
		try {
			await onTest(skill.name);
			showAction("Test completed");
		} catch (e: unknown) {
			showAction("Test failed", e instanceof Error ? e.message : String(e));
		}
	};

	const handleUninstall = async () => {
		try {
			await onUninstall(skill.name);
			showAction("Skill uninstalled");
		} catch (e: unknown) {
			showAction("Uninstall failed", e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<div className={`border ${BORD} rounded-lg overflow-hidden ${SURF}`}>
			{/* Card header */}
			<button
				onClick={() => setExpanded(!expanded)}
				className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors`}
			>
				<div
					className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
						skill.valid
							? "bg-emerald-50 dark:bg-emerald-900/30"
							: "bg-red-50 dark:bg-red-950"
					}`}
				>
					<BookOpen
						size={15}
						className={
							skill.valid
								? "text-emerald-600 dark:text-emerald-400"
								: "text-red-600 dark:text-red-400"
						}
					/>
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className={`text-sm font-medium truncate ${TXT}`}>{skill.name}</span>
						{skill.valid ? (
							<span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">valid</span>
						) : (
							<span className="text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 px-1.5 py-0.5 rounded">invalid</span>
						)}
						{skill.required && (
							<span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">required</span>
						)}
					</div>
					<p className={`text-xs truncate ${MUT} mt-0.5`}>{skill.description || "No description"}</p>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{expanded ? <ChevronDown size={14} className={MUT} /> : <ChevronRight size={14} className={MUT} />}
				</div>
			</button>

			{/* Expanded details */}
			{expanded && (
				<div className={`px-4 pb-4 border-t ${BORD}`}>
					<div className="pt-3 space-y-1">
						<div className="flex items-center justify-between py-1">
							<span className={`text-xs ${MUT}`}>File</span>
							<span className={`text-[10px] font-mono ${TXT} max-w-[200px] truncate`}>{skill.filePath}</span>
						</div>
						{skill.manifestSource && (
							<div className="flex items-center justify-between py-1">
								<span className={`text-xs ${MUT}`}>Manifest Source</span>
								<span className={`text-xs ${TXT}`}>{skill.manifestSource}</span>
							</div>
						)}
					</div>

					{/* Action feedback */}
					{actionMsg && (
						<div
							className={`mt-3 p-2 rounded text-xs ${
								actionError
									? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900"
									: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900"
							}`}
						>
							<div className="flex items-center gap-1.5">
								{actionError ? <AlertCircle size={11} /> : <CheckCircle size={11} />}
								<span>{actionError || actionMsg}</span>
							</div>
							{actionError && (
								<a
									href="#"
									onClick={(e) => { e.preventDefault(); }}
									className={`inline-flex items-center gap-1 mt-1 text-[10px] underline ${
										actionError ? "text-red-500 dark:text-red-400" : ""
									}`}
								>
									<ExternalLink size={9} /> View audit log
								</a>
							)}
						</div>
					)}

					{/* Action buttons */}
					<div className="flex flex-wrap gap-2 mt-3">
						<button
							onClick={handleTest}
							disabled={busy}
							className={`h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
								${isTesting
									? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600"
									: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
								}`}
							title="Test this skill"
						>
							{isTesting ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
							Test
						</button>

						<button
							onClick={() => onViewDetail(skill.name)}
							className="h-7 px-2.5 rounded text-[10px] font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors flex items-center gap-1"
						>
							<FileCode size={11} /> View Details
						</button>

						<button
							onClick={handleUninstall}
							disabled={busy || skill.required}
							className={`h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto
								${isUninstalling || skill.required
									? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600"
									: "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
								}`}
							title={skill.required ? "Required skills cannot be uninstalled" : "Uninstall this skill"}
						>
							{isUninstalling ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
							Uninstall
						</button>
					</div>

					{/* Invalid skill warning */}
					{!skill.valid && (
						<div className="mt-3 p-2.5 rounded-lg border text-xs bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900">
							<div className="flex items-start gap-2">
								<AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-500" />
								<div>
									<p className="font-medium text-red-700 dark:text-red-300">Invalid Skill Manifest</p>
									<p className="mt-0.5 text-red-600 dark:text-red-400">
										This skill failed validation. Check the manifest format and required fields.
									</p>
									<button
										onClick={() => onViewDetail(skill.name)}
										className="mt-1.5 text-[10px] font-medium text-red-600 dark:text-red-400 underline hover:text-red-700 dark:hover:text-red-300"
									>
										View validation details
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Install Skill Dialog
// ---------------------------------------------------------------------------

interface InstallSkillDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onInstall: (params: {
		name: string;
		description?: string;
		version?: string;
		source?: string;
		url?: string;
		content?: string;
		path?: string;
	}) => Promise<void>;
}

function InstallSkillDialog({ isOpen, onClose, onInstall }: InstallSkillDialogProps) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [sourceType, setSourceType] = useState<"url" | "content" | "path" | "metadata">("url");
	const [url, setUrl] = useState("");
	const [content, setContent] = useState("");
	const [path, setPath] = useState("");
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!isOpen) return null;

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return;

		setInstalling(true);
		setError(null);

		try {
			const params: {
				name: string;
				description?: string;
				version?: string;
				source?: string;
				url?: string;
				content?: string;
				path?: string;
			} = { name: name.trim(), description: description.trim() || undefined };

			if (sourceType === "url") {
				if (!url.trim()) {
					setError("URL is required");
					setInstalling(false);
					return;
				}
				params.url = url.trim();
			} else if (sourceType === "content") {
				if (!content.trim()) {
					setError("Content is required");
					setInstalling(false);
					return;
				}
				params.content = content.trim();
			} else if (sourceType === "path") {
				if (!path.trim()) {
					setError("Path is required");
					setInstalling(false);
					return;
				}
				params.path = path.trim();
			}

			await onInstall(params);
			onClose();
			setName("");
			setDescription("");
			setUrl("");
			setContent("");
			setPath("");
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setInstalling(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
			<div
				className={`${SURF} border ${BORD} rounded-lg shadow-xl p-6 max-w-lg w-full mx-4`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between mb-4">
					<h3 className={`text-sm font-semibold ${TXT} flex items-center gap-2`}>
						<BookOpen size={14} /> Install Skill
					</h3>
					<button onClick={onClose} className={`${MUT} hover:text-stone-600 dark:hover:text-stone-300`}>
						<X size={16} />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div>
						<label className={`block text-xs font-medium ${MUT} mb-1`}>
							Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="my-skill-name"
							className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
							disabled={installing}
						/>
						<p className={`text-[10px] ${MUT} mt-1`}>Lowercase letters, numbers, and hyphens only.</p>
					</div>

					<div>
						<label className={`block text-xs font-medium ${MUT} mb-1`}>Description</label>
						<input
							type="text"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief description of the skill"
							className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
							disabled={installing}
						/>
					</div>

					{/* Source type selector */}
					<div>
						<label className={`block text-xs font-medium ${MUT} mb-2`}>Source</label>
						<div className="flex gap-1 mb-3">
							{(["url", "content", "path", "metadata"] as const).map((type) => (
								<button
									key={type}
									type="button"
									onClick={() => setSourceType(type)}
									className={`flex-1 h-7 rounded text-[10px] font-medium transition-colors ${
										sourceType === type
											? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
											: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
									}`}
								>
									{type === "url" ? "URL" : type === "content" ? "Content" : type === "path" ? "File Path" : "Metadata"}
								</button>
							))}
						</div>

						{sourceType === "url" && (
							<input
								type="text"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="https://example.com/skill.md"
								className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
								disabled={installing}
							/>
						)}

						{sourceType === "content" && (
							<textarea
								value={content}
								onChange={(e) => setContent(e.target.value)}
								placeholder={"---\nname: my-skill\ndescription: My custom skill\n---\n\n# My Skill\n\nContent here..."}
								rows={6}
								className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 font-mono`}
								disabled={installing}
							/>
						)}

						{sourceType === "path" && (
							<input
								type="text"
								value={path}
								onChange={(e) => setPath(e.target.value)}
								placeholder="/path/to/skill.md"
								className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
								disabled={installing}
							/>
						)}
					</div>

					{error && (
						<div className="p-3 rounded-lg border text-xs bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
							{error}
						</div>
					)}

					<div className="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${BORD} ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
							disabled={installing}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!name.trim() || installing}
							className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 ${
								!name.trim() || installing
									? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600 cursor-not-allowed"
									: "bg-blue-600 text-white hover:bg-blue-700"
							}`}
						>
							{installing ? (
								<><Loader2 size={12} className="animate-spin" /> Installing...</>
							) : (
								<><BookOpen size={12} /> Install</>
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main SkillsManager Component
// ---------------------------------------------------------------------------

interface SkillsManagerProps {
	/** Optional class name */
	className?: string;
}

export function SkillsManager({ className = "" }: SkillsManagerProps) {
	const {
		skills,
		count,
		diagnostics,
		isLoading,
		error,
		refetch,
		install,
		isInstalling,
		test,
		isTesting,
		testData,
		testError,
		resetTest,
		uninstall,
		isUninstalling,
	} = useSkills();

	const [showInstallDialog, setShowInstallDialog] = useState(false);
	const [detailSkillName, setDetailSkillName] = useState<string | null>(null);
	const [testResult, setTestResult] = useState<SkillTestResult | null>(null);
	const [testLogs, setTestLogs] = useState<string>("");

	if (isLoading) {
		return (
			<div className={`flex items-center justify-center h-32 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${MUT}`}>
					<Loader2 size={14} className="animate-spin" /> Loading skills...
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`flex flex-col items-center justify-center h-32 gap-2 ${className}`}>
				<AlertCircle size={20} className="text-red-400" />
				<p className="text-xs text-red-500">Failed to load skills: {error instanceof Error ? error.message : String(error)}</p>
				<button
					onClick={refetch}
					className="h-7 px-2.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1"
				>
					<RefreshCw size={11} /> Retry
				</button>
			</div>
		);
	}

	const handleTest = async (name: string) => {
		try {
			const res = await test({ name });
			setTestResult(res.testResult);
			setTestLogs(res.logs);
		} catch (err: unknown) {
			// Error is handled by the card's catch
			throw err;
		}
	};

	const handleUninstall = async (name: string) => {
		await uninstall(name);
	};

	const invalidCount = skills.filter((s) => !s.valid).length;
	const errorCount = diagnostics.filter((d) => d.severity === "error").length;

	return (
		<div className={`flex flex-col ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center justify-between px-4 py-3 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<BookOpen size={14} className={TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>Skills</span>
					<span className={`text-[10px] ${MUT} ml-1`}>{count} installed</span>
					{invalidCount > 0 && (
						<span className="text-[10px] font-medium text-red-500 bg-red-50 dark:bg-red-950 px-1.5 py-0.5 rounded flex items-center gap-1">
							<AlertTriangle size={9} /> {invalidCount} invalid
						</span>
					)}
					{errorCount > 0 && (
						<span className="text-[10px] font-medium text-amber-500 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded flex items-center gap-1">
							<AlertTriangle size={9} /> {errorCount} errors
						</span>
					)}
				</div>
				<div className="flex items-center gap-1.5">
					<button
						onClick={refetch}
						className="h-7 px-2 rounded text-[10px] font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] transition-colors flex items-center gap-1"
					>
						<RefreshCw size={11} /> Refresh
					</button>
					<button
						onClick={() => setShowInstallDialog(true)}
						disabled={isInstalling}
						className="h-7 px-2.5 rounded text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
					>
						{isInstalling ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
						Install
					</button>
				</div>
			</div>

			{/* Diagnostics banner */}
			{diagnostics.length > 0 && (
				<div className={`shrink-0 px-4 py-2 border-b ${BORD} bg-amber-50/50 dark:bg-amber-950/20`}>
					<div className="flex flex-col gap-1">
						{diagnostics.map((d, i) => (
							<div key={i} className={`text-[10px] flex items-start gap-1.5 ${
								d.severity === "error"
									? "text-red-600 dark:text-red-400"
									: d.severity === "warning"
										? "text-amber-600 dark:text-amber-400"
										: "text-stone-500 dark:text-stone-400"
							}`}>
								{d.severity === "error" ? <AlertCircle size={9} className="shrink-0 mt-0.5" /> : <AlertTriangle size={9} className="shrink-0 mt-0.5" />}
								<span>{d.skillName ? `[${d.skillName}] ` : ""}{d.message}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Skill list */}
			<div className="flex-1 overflow-y-auto p-3 space-y-2">
				{skills.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-32 gap-2">
						<BookOpen size={24} className="text-stone-300 dark:text-stone-600" />
						<p className={`text-xs ${MUT}`}>No skills installed</p>
						<button
							onClick={() => setShowInstallDialog(true)}
							className="h-7 px-2.5 rounded text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1"
						>
							<Plus size={11} /> Install your first skill
						</button>
					</div>
				) : (
					skills.map((s) => (
						<SkillCard
							key={s.name}
							skill={s}
							onTest={handleTest}
							onUninstall={handleUninstall}
							onViewDetail={(name) => setDetailSkillName(name)}
							isTesting={isTesting}
							isUninstalling={isUninstalling}
						/>
					))
				)}
			</div>

			{/* Footer */}
			<div className={`shrink-0 px-4 py-2 border-t ${BORD}`}>
				<AuditEventsBlock />
			</div>

			{/* Install dialog */}
			<InstallSkillDialog
				isOpen={showInstallDialog}
				onClose={() => setShowInstallDialog(false)}
				onInstall={async (params) => {
					await install(params);
				}}
			/>

			{/* Detail modal */}
			{detailSkillName && (
				<SkillDetailModal
					name={detailSkillName}
					onClose={() => setDetailSkillName(null)}
				/>
			)}

			{/* Test result modal */}
			{testResult && (
				<TestResultModal
					result={testResult}
					logs={testLogs}
					onClose={() => { setTestResult(null); setTestLogs(""); resetTest(); }}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Audit Events Block
// ---------------------------------------------------------------------------

function AuditEventsBlock() {
	const { events, count, isLoading, error, refetch } = useAuditEvents({ limit: 10 });
	const [expanded, setExpanded] = useState(false);

	const verdictColor = (verdict: string) => {
		switch (verdict) {
			case "denied": return "text-red-600 dark:text-red-400";
			case "allowed": return "text-emerald-600 dark:text-emerald-400";
			default: return TXT;
		}
	};

	if (isLoading) return null;
	if (error) return null;
	if (events.length === 0) return null;

	return (
		<div className={`border-t ${BORD} pt-2 mt-2`}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex items-center gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
			>
				{expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
				Recent Audit Events ({count})
			</button>

			{expanded && (
				<div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
					{events.map((ev) => (
						<div key={ev.id} className={`p-2 rounded text-[10px] border ${BORD} flex items-start gap-1.5`}>
							<AlertCircle size={9} className={`shrink-0 mt-0.5 ${verdictColor(ev.verdict)}`} />
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-1.5">
									<span className="font-medium text-stone-700 dark:text-stone-300">{ev.skillName}</span>
									<span className={`${verdictColor(ev.verdict)} font-medium`}>{ev.verdict}</span>
								</div>
								<p className="text-stone-500 dark:text-stone-400 mt-0.5">{ev.reason}</p>
								<p className="text-stone-400 dark:text-stone-500 mt-0.5">{new Date(ev.occurredAt).toLocaleString()}</p>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}


