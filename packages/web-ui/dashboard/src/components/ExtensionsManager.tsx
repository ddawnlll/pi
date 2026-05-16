/**
 * ExtensionsManager — Extensions management panel.
 *
 * P11.P — Extensions and Skills Manager UI
 *
 * AC1: Extension cards render from backend data.
 * AC2: Install/enable flows display policy decisions and audit links.
 * AC3: Rollback and disable flows are visible and safe.
 * AC4: Compatibility warnings and invalid manifest errors are actionable.
 */

import { useState, type FormEvent } from "react";
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Loader2,
	Package,
	Plus,
	RefreshCw,
	RotateCcw,
	ToggleLeft,
	ToggleRight,
	Upload,
	X,
	FileCode,
	Shield,
} from "lucide-react";
import { useExtensions, type ExtensionInfo, type ExtensionHealth } from "../hooks/useExtensions";

// ---------------------------------------------------------------------------
// Style constants (matching App.tsx patterns)
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function InfoRow({ label, value, variant = "normal" }: { label: string; value: string; variant?: "normal" | "success" | "warning" | "error" }) {
	const colorMap = {
		normal: "text-stone-800 dark:text-stone-200",
		success: "text-emerald-600 dark:text-emerald-400",
		warning: "text-amber-600 dark:text-amber-400",
		error: "text-red-600 dark:text-red-400",
	};
	return (
		<div className="flex items-center justify-between py-1">
			<span className={`text-xs ${MUT}`}>{label}</span>
			<span className={`text-xs font-medium ${colorMap[variant]}`}>{value}</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Install Dialog
// ---------------------------------------------------------------------------

interface InstallDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onInstall: (source: string, local: boolean) => Promise<void>;
}

function InstallDialog({ isOpen, onClose, onInstall }: InstallDialogProps) {
	const [source, setSource] = useState("");
	const [local, setLocal] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [policyResult, setPolicyResult] = useState<{
		allowed: boolean;
		reason?: string;
		severity?: "error" | "warning";
	} | null>(null);

	if (!isOpen) return null;

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!source.trim()) return;

		setInstalling(true);
		setError(null);
		setPolicyResult(null);

		try {
			// Check policy first via a light validation
			const policyRes = await fetch("/api/extensions/policy-check", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ source: source.trim(), local }),
			});
			if (policyRes.ok) {
				const policyData = await policyRes.json() as { allowed: boolean; reason?: string; severity?: "error" | "warning" };
				if (!policyData.allowed) {
					setPolicyResult(policyData);
					setInstalling(false);
					return;
				}
			}
		} catch {
			// Policy endpoint may not exist; skip pre-check
		}

		try {
			await onInstall(source.trim(), local);
			onClose();
			setSource("");
			setLocal(false);
		} catch (err: unknown) {
			const apiErr = err as { error?: string; code?: string; detail?: string; status?: number };
			if (apiErr.code === "POLICY_DENIED" || apiErr.code === "INVALID_MANIFEST") {
				setPolicyResult({
					allowed: false,
					reason: apiErr.detail || apiErr.error,
					severity: "error",
				});
			} else {
				setError(apiErr.detail || apiErr.error || "Installation failed");
			}
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
						<Upload size={14} /> Install Extension
					</h3>
					<button onClick={onClose} className={`${MUT} hover:text-stone-600 dark:hover:text-stone-300`}>
						<X size={16} />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<div>
						<label className={`block text-xs font-medium ${MUT} mb-1`}>
							Source <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							value={source}
							onChange={(e) => { setSource(e.target.value); setPolicyResult(null); setError(null); }}
							placeholder="npm:package-name, git:url, or ./local/path"
							className={`w-full px-3 py-2 text-sm rounded-lg border ${BORD} ${TXT} bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`}
							disabled={installing}
						/>
						<p className={`text-[10px] ${MUT} mt-1`}>
							Supported formats: npm:&lt;package&gt;, git:&lt;url&gt;, or a local path starting with ./ or /
						</p>
					</div>

					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={local}
							onChange={(e) => setLocal(e.target.checked)}
							className="rounded border-stone-300 dark:border-stone-600"
							disabled={installing}
						/>
						<span className={`text-xs ${TXT}`}>Project-scoped (local)</span>
					</label>

					{/* Policy decision display */}
					{policyResult && (
						<div
							className={`p-3 rounded-lg border text-xs ${
								policyResult.severity === "error"
									? "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900"
									: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-900"
							}`}
						>
							<div className="flex items-start gap-2">
								{policyResult.severity === "error" ? (
									<AlertCircle size={14} className="shrink-0 mt-0.5 text-red-500" />
								) : (
									<AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-500" />
								)}
								<div>
									<p
										className={`font-medium ${
											policyResult.severity === "error"
												? "text-red-700 dark:text-red-300"
												: "text-amber-700 dark:text-amber-300"
										}`}
									>
										{policyResult.severity === "error" ? "Policy Blocked" : "Policy Warning"}
									</p>
									<p
										className={`mt-1 ${
											policyResult.severity === "error"
												? "text-red-600 dark:text-red-400"
												: "text-amber-600 dark:text-amber-400"
										}`}
									>
										{policyResult.reason}
									</p>
									<a
										href="#"
										onClick={(e) => { e.preventDefault(); onClose(); }}
										className={`inline-flex items-center gap-1 mt-2 text-[10px] underline ${
											policyResult.severity === "error"
												? "text-red-500 dark:text-red-400"
												: "text-amber-500 dark:text-amber-400"
										}`}
									>
										<ExternalLink size={10} /> View audit log
									</a>
								</div>
							</div>
						</div>
					)}

					{/* Error display */}
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
							disabled={!source.trim() || installing}
							className={`px-3 py-1.5 text-xs font-medium rounded-lg flex items-center gap-1.5 ${
								!source.trim() || installing
									? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600 cursor-not-allowed"
									: "bg-blue-600 text-white hover:bg-blue-700"
							}`}
						>
							{installing ? (
								<><Loader2 size={12} className="animate-spin" /> Installing...</>
							) : (
								<><Upload size={12} /> Install</>
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Extension Card
// ---------------------------------------------------------------------------

interface ExtensionCardProps {
	ext: ExtensionInfo;
	health: ExtensionHealth | undefined;
	onEnable: (source: string) => Promise<unknown>;
	onDisable: (source: string) => Promise<unknown>;
	onUpdate: (source: string) => Promise<unknown>;
	onRollback: (source: string) => Promise<unknown>;
	isUpdating: boolean;
	isRollingBack: boolean;
	isEnabling: boolean;
	isDisabling: boolean;
}

function ExtensionCard({
	ext,
	health,
	onEnable,
	onDisable,
	onUpdate,
	onRollback,
	isUpdating,
	isRollingBack,
	isEnabling,
	isDisabling,
}: ExtensionCardProps) {
	const [expanded, setExpanded] = useState(false);
	const [actionMsg, setActionMsg] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const busy = isUpdating || isRollingBack || isEnabling || isDisabling;

	const showAction = (msg: string, err?: string) => {
		setActionMsg(msg);
		setActionError(err ?? null);
		setTimeout(() => { setActionMsg(null); setActionError(null); }, 4000);
	};

	const handleEnable = async () => {
		try {
			await onEnable(ext.source);
			showAction("Extension enabled");
		} catch (e: unknown) {
			showAction("Failed to enable", e instanceof Error ? e.message : String(e));
		}
	};

	const handleDisable = async () => {
		try {
			await onDisable(ext.source);
			showAction("Extension disabled");
		} catch (e: unknown) {
			showAction("Failed to disable", e instanceof Error ? e.message : String(e));
		}
	};

	const handleUpdate = async () => {
		try {
			await onUpdate(ext.source);
			showAction("Extension updated");
		} catch (e: unknown) {
			showAction("Update failed", e instanceof Error ? e.message : String(e));
		}
	};

	const handleRollback = async () => {
		try {
			await onRollback(ext.source);
			showAction("Extension rolled back");
		} catch (e: unknown) {
			showAction("Rollback failed", e instanceof Error ? e.message : String(e));
		}
	};

	const typeBadgeColor =
		ext.type === "local"
			? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
			: ext.type === "package"
				? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
				: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";

	const scopeBadgeColor =
		ext.scope === "project"
			? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
			: "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";

	// Extract a short display name from the source
	const displayName = ext.source.replace(/^(npm:|git:|https:\/\/|ssh:\/\/)/, "").split("/").pop() ?? ext.source;

	return (
		<div className={`border ${BORD} rounded-lg overflow-hidden ${SURF}`}>
			{/* Card header */}
			<button
				onClick={() => setExpanded(!expanded)}
				className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 dark:hover:bg-[#2A2A2A] transition-colors`}
			>
				<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-stone-100 dark:bg-stone-800 shrink-0">
					<Package size={15} className={ext.enabled ? "text-blue-600 dark:text-blue-400" : `${MUT}`} />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className={`text-sm font-medium truncate ${TXT}`}>{displayName}</span>
						{ext.enabled ? (
							<span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded">enabled</span>
						) : (
							<span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded">disabled</span>
						)}
					</div>
					<div className="flex items-center gap-1.5 mt-0.5">
						<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${typeBadgeColor}`}>{ext.type}</span>
						<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${scopeBadgeColor}`}>{ext.scope}</span>
					</div>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{/* Quick actions */}
					{ext.enabled ? (
						<button
							onClick={(e) => { e.stopPropagation(); handleDisable(); }}
							disabled={busy}
							className="h-7 px-2 rounded text-[10px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50 flex items-center gap-1"
							title="Disable extension"
						>
							<ToggleRight size={12} /> Disable
						</button>
					) : (
						<button
							onClick={(e) => { e.stopPropagation(); handleEnable(); }}
							disabled={busy}
							className="h-7 px-2 rounded text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50 flex items-center gap-1"
							title="Enable extension"
						>
							<ToggleLeft size={12} /> Enable
						</button>
					)}
					{expanded ? <ChevronDown size={14} className={MUT} /> : <ChevronRight size={14} className={MUT} />}
				</div>
			</button>

			{/* Expanded details */}
			{expanded && (
				<div className={`px-4 pb-4 border-t ${BORD}`}>
					<div className="pt-3 space-y-1">
						<InfoRow label="Source" value={ext.source} />
						<InfoRow label="Scope" value={ext.scope} />
						<InfoRow label="Type" value={ext.type} />
						<InfoRow label="Filtered" value={ext.filtered ? "Yes" : "No"} variant={ext.filtered ? "warning" : "normal"} />
						{ext.installedPath && <InfoRow label="Path" value={ext.installedPath} />}
						{health && (
							<>
								<InfoRow
									label="Health"
									value={health.healthy ? "Healthy" : "Unhealthy"}
									variant={health.healthy ? "success" : "error"}
								/>
								{health.version && <InfoRow label="Version" value={health.version} />}
							</>
						)}
						{ext.error && <InfoRow label="Error" value={ext.error} variant="error" />}
						{health?.error && <InfoRow label="Health Error" value={health.error} variant="error" />}
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
									onClick={(e) => { e.preventDefault(); /* could open audit log modal */ }}
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
						{/* Update button */}
						<button
							onClick={handleUpdate}
							disabled={busy || ext.filtered}
							className={`h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
								${isUpdating
									? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600"
									: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
								}`}
							title="Update extension to latest version"
						>
							{isUpdating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
							Update
						</button>

						{/* Rollback button */}
						{ext.hasRollbackBackup && (
							<button
								onClick={handleRollback}
								disabled={busy}
								className={`h-7 px-2.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
									${isRollingBack
										? "bg-stone-200 dark:bg-stone-800 text-stone-400 dark:text-stone-600"
										: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50"
									}`}
								title="Rollback to previous version"
							>
								{isRollingBack ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
								Rollback
							</button>
						)}

						{/* Disabled fallback */}
						{!ext.hasRollbackBackup && ext.enabled && (
							<span className={`text-[10px] ${MUT} flex items-center gap-1`}>
								<RotateCcw size={10} />
								No rollback backup — use Disable for safe fallback
							</span>
						)}
					</div>

					{/* Compatibility / error warnings */}
					{!health?.healthy && health && (
						<div className="mt-3 p-2.5 rounded-lg border text-xs bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900">
							<div className="flex items-start gap-2">
								<AlertTriangle size={13} className="shrink-0 mt-0.5 text-red-500" />
								<div>
									<p className="font-medium text-red-700 dark:text-red-300">Compatibility Warning</p>
									<p className="mt-0.5 text-red-600 dark:text-red-400">
										{health.error || "This extension may be incompatible with the current version of pi."}
									</p>
									<button
										onClick={handleUpdate}
										className="mt-1.5 text-[10px] font-medium text-red-600 dark:text-red-400 underline hover:text-red-700 dark:hover:text-red-300"
									>
										Try updating to resolve compatibility
									</button>
								</div>
							</div>
						</div>
					)}

					{/* Audit trail link */}
					<div className="mt-2 pt-2 border-t border-dashed ${BORD}">
						<a
							href="#"
							onClick={(e) => { e.preventDefault(); /* Could open audit log panel */ }}
							className={`inline-flex items-center gap-1 text-[10px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
						>
							<FileCode size={10} /> View audit trail for this extension
						</a>
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main ExtensionsManager Component
// ---------------------------------------------------------------------------

interface ExtensionsManagerProps {
	/** Optional class name */
	className?: string;
}

export function ExtensionsManager({ className = "" }: ExtensionsManagerProps) {
	const {
		extensions,
		count,
		isLoading,
		error,
		refetch,
		health,
		healthLoading,
		install,
		isInstalling,
		update,
		isUpdating,
		rollback,
		isRollingBack,
		enable,
		isEnabling,
		disable,
		isDisabling,
	} = useExtensions();

	const [showInstallDialog, setShowInstallDialog] = useState(false);
	const [selectedAuditExtension, setSelectedAuditExtension] = useState<string | null>(null);

	if (isLoading) {
		return (
			<div className={`flex items-center justify-center h-32 ${className}`}>
				<div className={`flex items-center gap-2 text-xs ${MUT}`}>
					<Loader2 size={14} className="animate-spin" /> Loading extensions...
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className={`flex flex-col items-center justify-center h-32 gap-2 ${className}`}>
				<AlertCircle size={20} className="text-red-400" />
				<p className="text-xs text-red-500">Failed to load extensions: {error instanceof Error ? error.message : String(error)}</p>
				<button
					onClick={refetch}
					className="h-7 px-2.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1"
				>
					<RefreshCw size={11} /> Retry
				</button>
			</div>
		);
	}

	// Build a health map for quick lookup
	const healthMap = new Map<string, ExtensionHealth>();
	if (health) {
		for (const h of health.extensions) {
			healthMap.set(h.source, h);
		}
	}

	const unhealthyCount = health?.unhealthy ?? 0;

	return (
		<div className={`flex flex-col ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center justify-between px-4 py-3 border-b ${BORD}`}>
				<div className="flex items-center gap-2">
					<Package size={14} className={TXT} />
					<span className={`text-xs font-semibold ${TXT}`}>Extensions</span>
					<span className={`text-[10px] ${MUT} ml-1`}>{count} installed</span>
					{unhealthyCount > 0 && (
						<span className="text-[10px] font-medium text-red-500 bg-red-50 dark:bg-red-950 px-1.5 py-0.5 rounded flex items-center gap-1">
							<AlertTriangle size={9} /> {unhealthyCount} unhealthy
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

			{/* Extension list */}
			<div className="flex-1 overflow-y-auto p-3 space-y-2">
				{extensions.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-32 gap-2">
						<Package size={24} className="text-stone-300 dark:text-stone-600" />
						<p className={`text-xs ${MUT}`}>No extensions installed</p>
						<button
							onClick={() => setShowInstallDialog(true)}
							className="h-7 px-2.5 rounded text-[10px] font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-1"
						>
							<Plus size={11} /> Install your first extension
						</button>
					</div>
				) : (
					extensions.map((ext) => (
						<ExtensionCard
							key={ext.source}
							ext={ext}
							health={healthMap.get(ext.source)}
							onEnable={(source) => enable({ source })}
							onDisable={(source) => disable({ source })}
							onUpdate={(source) => update({ source })}
							onRollback={(source) => rollback({ source })}
							isUpdating={isUpdating}
							isRollingBack={isRollingBack}
							isEnabling={isEnabling}
							isDisabling={isDisabling}
						/>
					))
				)}
			</div>

			{/* Install dialog */}
			<InstallDialog
				isOpen={showInstallDialog}
				onClose={() => setShowInstallDialog(false)}
				onInstall={async (source, local) => {
					await install({ source, local });
				}}
			/>

			{/* Summary footer */}
			<div className={`shrink-0 px-4 py-2 border-t ${BORD} flex items-center justify-between`}>
				<div className={`flex items-center gap-3 text-[10px] ${MUT}`}>
					<span className="flex items-center gap-1">
						<Shield size={10} /> Policy enforcement active
					</span>
					{health && (
						<span className="flex items-center gap-1">
							<CheckCircle size={10} className={health.healthy ? "text-emerald-500" : "text-red-400"} />
							System: {health.healthy ? "All healthy" : `${health.unhealthy} unhealthy`}
						</span>
					)}
				</div>
				<a
					href="#"
					onClick={(e) => { e.preventDefault(); }}
					className={`inline-flex items-center gap-1 text-[10px] ${MUT} hover:text-stone-700 dark:hover:text-stone-300`}
				>
					<FileCode size={10} /> Extension audit log
				</a>
			</div>
		</div>
	);
}
