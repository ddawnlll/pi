/**
 * RegistrySettings — Registry settings panel for P11 platform.
 *
 * P11.S — Dashboard shell, navigation integration, and registry settings
 *
 * AC: Registry settings render and save through backend API or state stub as appropriate.
 *
 * Settings:
 * - Local registry paths
 * - Remote registry placeholders
 * - Trusted channels
 * - Update policy
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Loader2,
	Plus,
	RefreshCw,
	Save,
	Trash2,
	X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const SURF = "bg-white dark:bg-[#1E1E1E]";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistrySettingsData {
	localRegistryPaths: string[];
	remoteRegistries: RemoteRegistry[];
	trustedChannels: string[];
	updatePolicy: UpdatePolicy;
}

export interface RemoteRegistry {
	id: string;
	url: string;
	name: string;
	enabled: boolean;
}

export interface UpdatePolicy {
	mode: "auto" | "manual" | "approval";
	checkIntervalHours: number;
	allowPrerelease: boolean;
	requireCompatibilityCheck: boolean;
}

// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: RegistrySettingsData = {
	localRegistryPaths: [
		".pi/extensions",
		".pi/skills",
	],
	remoteRegistries: [
		{ id: "default", url: "https://registry.pi.sh", name: "Pi Official", enabled: true },
	],
	trustedChannels: ["stable", "beta"],
	updatePolicy: {
		mode: "approval",
		checkIntervalHours: 24,
		allowPrerelease: false,
		requireCompatibilityCheck: true,
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_BASE = "";

async function fetchSettings(): Promise<RegistrySettingsData> {
	try {
		const r = await fetch(`${API_BASE}/api/registry/settings`);
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const data = await r.json();
		if (data?.success && data?.settings) {
			return data.settings as RegistrySettingsData;
		}
		// Fallback to defaults
		return { ...DEFAULT_SETTINGS };
	} catch {
		// If API unavailable, return defaults
		return { ...DEFAULT_SETTINGS };
	}
}

async function saveSettings(settings: RegistrySettingsData): Promise<{ success: boolean; error?: string }> {
	try {
		const r = await fetch(`${API_BASE}/api/registry/settings`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(settings),
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const data = await r.json();
		return data as { success: boolean; error?: string };
	} catch (e) {
		return { success: false, error: String(e) };
	}
}

// ---------------------------------------------------------------------------
// RegistrySettings component
// ---------------------------------------------------------------------------

interface RegistrySettingsProps {
	className?: string;
}

export function RegistrySettings({ className = "" }: RegistrySettingsProps) {
	const [settings, setSettings] = useState<RegistrySettingsData | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);
	const [newLocalPath, setNewLocalPath] = useState("");
	const [newRemoteUrl, setNewRemoteUrl] = useState("");
	const [newRemoteName, setNewRemoteName] = useState("");
	const [newChannel, setNewChannel] = useState("");
	const [expandedSection, setExpandedSection] = useState<string>("local");
	const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await fetchSettings();
			setSettings(data);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		return () => {
			if (successTimerRef.current) clearTimeout(successTimerRef.current);
		};
	}, []);

	const showSuccess = useCallback((msg: string) => {
		setSuccessMsg(msg);
		if (successTimerRef.current) clearTimeout(successTimerRef.current);
		successTimerRef.current = setTimeout(() => setSuccessMsg(null), 3000);
	}, []);

	const handleSave = useCallback(async () => {
		if (!settings) return;
		setSaving(true);
		setError(null);
		try {
			const res = await saveSettings(settings);
			if (res.success) {
				showSuccess("Registry settings saved.");
			} else {
				setError(res.error ?? "Failed to save settings");
			}
		} catch (e) {
			setError(String(e));
		} finally {
			setSaving(false);
		}
	}, [settings, showSuccess]);

	// ── Local registry paths ──

	const addLocalPath = useCallback(() => {
		if (!settings || !newLocalPath.trim()) return;
		if (settings.localRegistryPaths.includes(newLocalPath.trim())) {
			setNewLocalPath("");
			return;
		}
		setSettings({
			...settings,
			localRegistryPaths: [...settings.localRegistryPaths, newLocalPath.trim()],
		});
		setNewLocalPath("");
	}, [settings, newLocalPath]);

	const removeLocalPath = useCallback((path: string) => {
		if (!settings) return;
		setSettings({
			...settings,
			localRegistryPaths: settings.localRegistryPaths.filter(p => p !== path),
		});
	}, [settings]);

	// ── Remote registries ──

	const addRemoteRegistry = useCallback(() => {
		if (!settings || !newRemoteUrl.trim() || !newRemoteName.trim()) return;
		const id = `remote-${Date.now()}`;
		setSettings({
			...settings,
			remoteRegistries: [
				...settings.remoteRegistries,
				{ id, url: newRemoteUrl.trim(), name: newRemoteName.trim(), enabled: true },
			],
		});
		setNewRemoteUrl("");
		setNewRemoteName("");
	}, [settings, newRemoteUrl, newRemoteName]);

	const removeRemoteRegistry = useCallback((id: string) => {
		if (!settings) return;
		setSettings({
			...settings,
			remoteRegistries: settings.remoteRegistries.filter(r => r.id !== id),
		});
	}, [settings]);

	const toggleRemoteRegistry = useCallback((id: string) => {
		if (!settings) return;
		setSettings({
			...settings,
			remoteRegistries: settings.remoteRegistries.map(r =>
				r.id === id ? { ...r, enabled: !r.enabled } : r
			),
		});
	}, [settings]);

	// ── Trusted channels ──

	const addChannel = useCallback(() => {
		if (!settings || !newChannel.trim()) return;
		if (settings.trustedChannels.includes(newChannel.trim())) {
			setNewChannel("");
			return;
		}
		setSettings({
			...settings,
			trustedChannels: [...settings.trustedChannels, newChannel.trim()],
		});
		setNewChannel("");
	}, [settings, newChannel]);

	const removeChannel = useCallback((channel: string) => {
		if (!settings) return;
		setSettings({
			...settings,
			trustedChannels: settings.trustedChannels.filter(c => c !== channel),
		});
	}, [settings]);

	// ── Update policy ──

	const setPolicyField = useCallback(<K extends keyof UpdatePolicy>(key: K, value: UpdatePolicy[K]) => {
		if (!settings) return;
		setSettings({
			...settings,
			updatePolicy: { ...settings.updatePolicy, [key]: value },
		});
	}, [settings]);

	// ── Render ──

	if (loading) {
		return (
			<div className={`flex items-center justify-center h-48 ${className}`}>
				<div className={`flex items-center gap-2 text-sm ${MUT}`}>
					<Loader2 size={16} className="animate-spin" /> Loading registry settings...
				</div>
			</div>
		);
	}

	if (!settings) {
		return (
			<div className={`flex items-center justify-center h-48 ${className}`}>
				<div className={`flex items-center gap-2 text-sm text-red-500`}>
					<AlertCircle size={16} /> Failed to load registry settings.
					<button onClick={load} className="underline hover:no-underline">Retry</button>
				</div>
			</div>
		);
	}

	const sectionToggle = (id: string) => (
		<button
			onClick={() => setExpandedSection(expandedSection === id ? "" : id)}
			className="p-1 rounded hover:bg-stone-100 dark:hover:bg-[#2A2A2A]"
		>
			{expandedSection === id
				? <ChevronUp size={14} className={MUT} />
				: <ChevronDown size={14} className={MUT} />
			}
		</button>
	);

	return (
		<div className={`${SURF} h-full flex flex-col overflow-hidden ${className}`}>
			{/* Header */}
			<div className={`shrink-0 flex items-center justify-between px-5 h-11 border-b ${BORD}`}>
				<h2 className={`text-[13px] font-semibold ${TXT}`}>Registry Settings</h2>
				<div className="flex items-center gap-2">
					<button
						onClick={load}
						className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`}
					>
						<RefreshCw size={12} /> Reset
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className={`flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11px] font-semibold transition-colors ${
							saving
								? "bg-stone-200 dark:bg-[#333] text-stone-400 dark:text-stone-500 cursor-not-allowed"
								: "bg-blue-600 text-white hover:bg-blue-700"
						}`}
					>
						{saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
						{saving ? "Saving..." : "Save"}
					</button>
				</div>
			</div>

			{/* Success/Error messages */}
			{successMsg && (
				<div className={`shrink-0 flex items-center gap-2 px-5 py-2 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border-b ${BORD}`}>
					<Check size={13} className="shrink-0" />
					<span className="flex-1">{successMsg}</span>
					<button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-600"><X size={12} /></button>
				</div>
			)}
			{error && (
				<div className={`shrink-0 flex items-center gap-2 px-5 py-2 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b ${BORD}`}>
					<AlertCircle size={13} className="shrink-0" />
					<span className="flex-1">{error}</span>
					<button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
				</div>
			)}

			{/* Scrollable settings content */}
			<div className="flex-1 overflow-y-auto">
				<div className="p-5 space-y-5">

					{/* ── Local Registry Paths ── */}
					<div className={`border ${BORD} rounded-lg overflow-hidden`}>
						<div className={`flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-[#222] border-b ${BORD}`}>
							<div className="flex items-center gap-2">
								{sectionToggle("local")}
								<h3 className={`text-[12px] font-semibold ${TXT}`}>Local Registry Paths</h3>
							</div>
							<span className={`text-[10px] ${MUT}`}>{settings.localRegistryPaths.length} path{settings.localRegistryPaths.length !== 1 ? "s" : ""}</span>
						</div>
						{expandedSection === "local" && (
							<div className="p-4 space-y-2">
								<p className={`text-[11px] ${MUT} mb-2`}>
									Directories where Pi scans for locally installed extensions and skills.
								</p>
								{settings.localRegistryPaths.length === 0 ? (
									<p className={`text-xs ${MUT} italic`}>No local registry paths configured.</p>
								) : (
									settings.localRegistryPaths.map((path) => (
										<div key={path} className="flex items-center gap-2">
											<span className={`flex-1 text-xs font-mono ${TXT} px-2.5 py-1.5 rounded bg-stone-50 dark:bg-[#161616] border ${BORD}`}>
												{path}
											</span>
											<button
												onClick={() => removeLocalPath(path)}
												className="p-1.5 rounded text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
											>
												<Trash2 size={12} />
											</button>
										</div>
									))
								)}
								<div className="flex items-center gap-2 mt-2">
									<input
										type="text"
										value={newLocalPath}
										onChange={(e) => setNewLocalPath(e.target.value)}
										onKeyDown={(e) => { if (e.key === "Enter") addLocalPath(); }}
										placeholder="Add path (e.g. .pi/extensions)"
										className={`flex-1 h-8 px-2.5 text-xs rounded-lg border ${BORD} ${TXT} bg-transparent outline-none focus:border-blue-400 dark:focus:border-blue-500`}
									/>
									<button
										onClick={addLocalPath}
										disabled={!newLocalPath.trim()}
										className={`flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-medium transition-colors ${
											newLocalPath.trim()
												? `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1E3355}`
												: `${MUT} bg-stone-100 dark:bg-[#222] cursor-not-allowed`
										}`}
									>
										<Plus size={12} /> Add
									</button>
								</div>
							</div>
						)}
					</div>

					{/* ── Remote Registries ── */}
					<div className={`border ${BORD} rounded-lg overflow-hidden`}>
						<div className={`flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-[#222] border-b ${BORD}`}>
							<div className="flex items-center gap-2">
								{sectionToggle("remote")}
								<h3 className={`text-[12px] font-semibold ${TXT}`}>Remote Registries</h3>
							</div>
							<span className={`text-[10px] ${MUT}`}>
								{settings.remoteRegistries.filter(r => r.enabled).length} / {settings.remoteRegistries.length} active
							</span>
						</div>
						{expandedSection === "remote" && (
							<div className="p-4 space-y-2">
								<p className={`text-[11px] ${MUT} mb-2`}>
									Remote registries for discovering and installing community extensions and skills.
								</p>
								{settings.remoteRegistries.length === 0 ? (
									<p className={`text-xs ${MUT} italic`}>No remote registries configured.</p>
								) : (
									settings.remoteRegistries.map((reg) => (
										<div key={reg.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${BORD} ${!reg.enabled ? "opacity-50" : ""}`}>
											<button
												onClick={() => toggleRemoteRegistry(reg.id)}
												className={`h-5 w-5 rounded border ${BORD} flex items-center justify-center transition-colors ${
													reg.enabled
														? "bg-blue-600 border-blue-600"
														: "bg-transparent"
												}`}
											>
												{reg.enabled && <Check size={10} className="text-white" />}
											</button>
											<div className="flex-1 min-w-0">
												<div className={`text-xs font-medium ${TXT}`}>{reg.name}</div>
												<div className={`text-[10px] font-mono ${MUT} truncate`}>{reg.url}</div>
											</div>
											<button
												onClick={() => removeRemoteRegistry(reg.id)}
												className="p-1.5 rounded text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
											>
												<Trash2 size={12} />
											</button>
										</div>
									))
								)}
								<div className="flex items-center gap-2 mt-2">
									<input
										type="text"
										value={newRemoteName}
										onChange={(e) => setNewRemoteName(e.target.value)}
										placeholder="Name"
										className={`flex-[2] h-8 px-2.5 text-xs rounded-lg border ${BORD} ${TXT} bg-transparent outline-none focus:border-blue-400 dark:focus:border-blue-500`}
									/>
									<input
										type="text"
										value={newRemoteUrl}
										onChange={(e) => setNewRemoteUrl(e.target.value)}
										onKeyDown={(e) => { if (e.key === "Enter") addRemoteRegistry(); }}
										placeholder="URL (https://...)"
										className={`flex-[3] h-8 px-2.5 text-xs rounded-lg border ${BORD} ${TXT} bg-transparent outline-none focus:border-blue-400 dark:focus:border-blue-500`}
									/>
									<button
										onClick={addRemoteRegistry}
										disabled={!newRemoteUrl.trim() || !newRemoteName.trim()}
										className={`flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-medium transition-colors ${
											newRemoteUrl.trim() && newRemoteName.trim()
												? `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1E3355}`
												: `${MUT} bg-stone-100 dark:bg-[#222] cursor-not-allowed`
										}`}
									>
										<Plus size={12} /> Add
									</button>
								</div>
							</div>
						)}
					</div>

					{/* ── Trusted Channels ── */}
					<div className={`border ${BORD} rounded-lg overflow-hidden`}>
						<div className={`flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-[#222] border-b ${BORD}`}>
							<div className="flex items-center gap-2">
								{sectionToggle("channels")}
								<h3 className={`text-[12px] font-semibold ${TXT}`}>Trusted Channels</h3>
							</div>
							<span className={`text-[10px] ${MUT}`}>{settings.trustedChannels.length} channel{settings.trustedChannels.length !== 1 ? "s" : ""}</span>
						</div>
						{expandedSection === "channels" && (
							<div className="p-4 space-y-2">
								<p className={`text-[11px] ${MUT} mb-2`}>
									Update channels that are trusted for automatic or approval-based installations.
								</p>
								{settings.trustedChannels.length === 0 ? (
									<p className={`text-xs ${MUT} italic`}>No trusted channels configured.</p>
								) : (
									<div className="flex flex-wrap gap-2">
										{settings.trustedChannels.map((channel) => (
											<div key={channel} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium border ${BORD} ${ACC_BG} ${ACC_TXT}`}>
												<span>{channel}</span>
												<button
													onClick={() => removeChannel(channel)}
													className="hover:text-red-500"
												>
													<X size={11} />
												</button>
											</div>
										))}
									</div>
								)}
								<div className="flex items-center gap-2 mt-2">
									<input
										type="text"
										value={newChannel}
										onChange={(e) => setNewChannel(e.target.value)}
										onKeyDown={(e) => { if (e.key === "Enter") addChannel(); }}
										placeholder="Channel name (e.g. stable)"
										className={`flex-1 h-8 px-2.5 text-xs rounded-lg border ${BORD} ${TXT} bg-transparent outline-none focus:border-blue-400 dark:focus:border-blue-500`}
									/>
									<button
										onClick={addChannel}
										disabled={!newChannel.trim()}
										className={`flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-medium transition-colors ${
											newChannel.trim()
												? `${ACC_BG} ${ACC_TXT} hover:bg-blue-100 dark:hover:bg-[#1E3355}`
												: `${MUT} bg-stone-100 dark:bg-[#222] cursor-not-allowed`
										}`}
									>
										<Plus size={12} /> Add
									</button>
								</div>
							</div>
						)}
					</div>

					{/* ── Update Policy ── */}
					<div className={`border ${BORD} rounded-lg overflow-hidden`}>
						<div className={`flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-[#222] border-b ${BORD}`}>
							<div className="flex items-center gap-2">
								{sectionToggle("policy")}
								<h3 className={`text-[12px] font-semibold ${TXT}`}>Update Policy</h3>
							</div>
							<span className={`text-[10px] font-medium ${ACC_TXT}`}>
								{settings.updatePolicy.mode === "auto" ? "Automatic" : settings.updatePolicy.mode === "manual" ? "Manual" : "Approval required"}
							</span>
						</div>
						{expandedSection === "policy" && (
							<div className="p-4 space-y-4">
								{/* Update mode */}
								<div>
									<label className={`block text-[11px] font-medium ${TXT} mb-1.5`}>Update Mode</label>
									<div className="flex gap-2">
										{(["auto", "manual", "approval"] as const).map((mode) => (
											<button
												key={mode}
												onClick={() => setPolicyField("mode", mode)}
												className={`flex-1 h-8 rounded-lg text-[11px] font-medium border transition-colors ${
													settings.updatePolicy.mode === mode
														? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
														: `${BORD} ${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-[#222]`
												}`}
											>
												{mode === "auto" ? "Auto" : mode === "manual" ? "Manual" : "Approval"}
											</button>
										))}
									</div>
									<p className={`text-[10px] ${MUT} mt-1`}>
										{settings.updatePolicy.mode === "auto"
											? "Updates install automatically when available."
											: settings.updatePolicy.mode === "manual"
												? "Updates require manual trigger."
												: "Updates require explicit approval before installation."
										}
									</p>
								</div>

								{/* Check interval */}
								<div>
									<label className={`block text-[11px] font-medium ${TXT} mb-1.5`}>
										Check Interval: every {settings.updatePolicy.checkIntervalHours} hour{settings.updatePolicy.checkIntervalHours !== 1 ? "s" : ""}
									</label>
									<input
										type="range"
										min={1}
										max={168}
										value={settings.updatePolicy.checkIntervalHours}
										onChange={(e) => setPolicyField("checkIntervalHours", Number(e.target.value))}
										className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-stone-200 dark:bg-[#333] accent-blue-600"
									/>
									<div className="flex justify-between text-[9px] ${MUT} mt-0.5">
										<span>1 hour</span>
										<span>7 days</span>
									</div>
								</div>

								{/* Toggles */}
								<div className="space-y-3">
									<label className="flex items-center gap-3 cursor-pointer">
										<button
											onClick={() => setPolicyField("allowPrerelease", !settings.updatePolicy.allowPrerelease)}
											className={`h-5 w-9 rounded-full transition-colors relative ${
												settings.updatePolicy.allowPrerelease ? "bg-blue-600" : "bg-stone-300 dark:bg-[#555]"
											}`}
										>
											<div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
												settings.updatePolicy.allowPrerelease ? "translate-x-4" : "translate-x-0"
											}`} />
										</button>
										<span className={`text-xs ${TXT}`}>Allow pre-release updates</span>
									</label>
									<label className="flex items-center gap-3 cursor-pointer">
										<button
											onClick={() => setPolicyField("requireCompatibilityCheck", !settings.updatePolicy.requireCompatibilityCheck)}
											className={`h-5 w-9 rounded-full transition-colors relative ${
												settings.updatePolicy.requireCompatibilityCheck ? "bg-blue-600" : "bg-stone-300 dark:bg-[#555]"
											}`}
										>
											<div className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
												settings.updatePolicy.requireCompatibilityCheck ? "translate-x-4" : "translate-x-0"
											}`} />
										</button>
										<span className={`text-xs ${TXT}`}>Require compatibility check before updates</span>
									</label>
								</div>
							</div>
						)}
					</div>

					{/* ── Footer info ── */}
					<div className={`text-[10px] ${MUT} text-center pt-2 pb-4`}>
						Registry settings are persisted to the backend. <ExternalLink size={9} className="inline" /> Learn more
					</div>
				</div>
			</div>
		</div>
	);
}
