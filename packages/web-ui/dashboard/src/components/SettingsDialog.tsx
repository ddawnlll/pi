import { useState, useEffect, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSettings, useProjectMeta } from "../hooks/useSettings";
import type { Project } from "../types";

type TabId = "general" | "budgets" | "project" | "advanced";

const DASHBOARD_THEME_KEY = "pi-dashboard-theme";

interface SettingsDialogProps {
	isOpen: boolean;
	onClose: () => void;
	project?: Project | null;
}

/** Deep compare two plain values (primitives / simple objects) */
function isEqual(a: unknown, b: unknown): boolean {
	if (typeof a !== typeof b) return false;
	if (a === b) return true;
	if (a && b && typeof a === "object" && typeof b === "object") {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	return false;
}

/** Read dashboard theme from localStorage (never touches pi agent) */
const STORAGE = typeof window !== "undefined" ? window.localStorage : null;
function readDashboardTheme(): string {
	try { return STORAGE?.getItem(DASHBOARD_THEME_KEY) ?? ""; } catch { return ""; }
}
function writeDashboardTheme(value: string): void {
	try {
		if (value) { STORAGE?.setItem(DASHBOARD_THEME_KEY, value); }
		else { STORAGE?.removeItem(DASHBOARD_THEME_KEY); }
	} catch { /* ignore */ }
}

export function SettingsDialog({ isOpen, onClose, project }: SettingsDialogProps) {
	const {
		settings,
		budgets,
		aiModels,
		modelsLoading,
		isLoading,
		isSaving,
		updateSettings,
		updateProject: updateProjectSettings,
		refetch,
	} = useSettings();
	const { updateProject: updateProjectMeta, isSaving: projectSaving } = useProjectMeta();

	const [activeTab, setActiveTab] = useState<TabId>("general");
	const [saved, setSaved] = useState(false);
	const [justSaved, setJustSaved] = useState(false);

	// Original values (snapshot when dialog opens)
	const [orig, setOrig] = useState<Record<string, unknown>>({});
	const [origBudgets, setOrigBudgets] = useState<Record<string, unknown>>({});
	const [origProject, setOrigProject] = useState<Record<string, unknown>>({});

	// Form state: General (steering + follow-up only — provider/model moved to Project tab)
	const [steeringMode, setSteeringMode] = useState<"all" | "one-at-a-time">("one-at-a-time");
	const [followUpMode, setFollowUpMode] = useState<"all" | "one-at-a-time">("one-at-a-time");
	// Dashboard visual theme — localStorage only, never sent to pi agent API
	const [theme, setTheme] = useState("");

	// Form state: Budgets
	const [budgetFlash, setBudgetFlash] = useState(4000);
	const [budgetWorker, setBudgetWorker] = useState(12000);
	const [budgetLead, setBudgetLead] = useState(24000);
	const [budgetReviewer, setBudgetReviewer] = useState(16000);
	const [budgetDebug, setBudgetDebug] = useState(24000);
	const [budgetMaxAuto, setBudgetMaxAuto] = useState(64000);
	const [millionContextEnabled, setMillionContextEnabled] = useState(false);

	// Form state: Project (includes per-project provider/model)
	const [projectName, setProjectName] = useState("");
	const [projectRootPath, setProjectRootPath] = useState("");
	const [projectProvider, setProjectProvider] = useState("");
	const [projectModel, setProjectModel] = useState("");

	// Form state: Advanced
	const [shellPath, setShellPath] = useState("");
	const [quietStartup, setQuietStartup] = useState(false);
	const [collapseChangelog, setCollapseChangelog] = useState(false);
	const [enableInstallTelemetry, setEnableInstallTelemetry] = useState(true);
	const [enableSkillCommands, setEnableSkillCommands] = useState(true);

	// P4.5: Edit strategy mode
	const [editStrategyMode, setEditStrategyMode] = useState<"token_saving" | "hybrid" | "speed">("hybrid");

	// Load settings into form state + snapshot originals
	// Note: no auto-refetch on open — TanStack Query keeps settings fresh
	// via staleTime. The second effect handles populating the form.
	useEffect(() => {
		// Skip updating form state if we just saved (prevents refetch from overwriting)
		if (justSaved) {
			setJustSaved(false);
			return;
		}

		const pp = (settings.defaultProvider as string | undefined) ?? "";
		const pm = (settings.defaultModel as string | undefined) ?? "";

		setProjectProvider(pp);
		setProjectModel(pm);
		setSteeringMode((settings.steeringMode as "all" | "one-at-a-time") ?? "one-at-a-time");
		setFollowUpMode((settings.followUpMode as "all" | "one-at-a-time") ?? "one-at-a-time");
		setTheme(readDashboardTheme());

		// P4.5: Load edit strategy mode
		setEditStrategyMode((settings.editStrategyMode as "token_saving" | "hybrid" | "speed") ?? "hybrid");

		setOrig({
			steeringMode: settings.steeringMode ?? "one-at-a-time",
			followUpMode: settings.followUpMode ?? "one-at-a-time",
			editStrategyMode: (settings.editStrategyMode as string) ?? "hybrid",
			shellPath: (settings.shellPath as string) ?? "",
			quietStartup: (settings.quietStartup as boolean) ?? false,
			collapseChangelog: (settings.collapseChangelog as boolean) ?? false,
			enableInstallTelemetry: (settings.enableInstallTelemetry as boolean) ?? true,
			enableSkillCommands: (settings.enableSkillCommands as boolean) ?? true,
		});

		if (budgets) {
			setBudgetFlash(budgets.flash);
			setBudgetWorker(budgets.worker);
			setBudgetLead(budgets.lead);
			setBudgetReviewer(budgets.reviewer);
			setBudgetDebug(budgets.debug);
			setBudgetMaxAuto(budgets.maxAuto);
			setMillionContextEnabled(budgets.millionContextEnabled);
			setOrigBudgets({
				flash: budgets.flash,
				worker: budgets.worker,
				lead: budgets.lead,
				reviewer: budgets.reviewer,
				debug: budgets.debug,
				maxAuto: budgets.maxAuto,
				millionContextEnabled: budgets.millionContextEnabled,
			});
		}

		if (project) {
			setProjectName(project.name ?? "");
			setProjectRootPath(project.rootPath ?? "");
		}

		setOrigProject({
			projectName: project?.name ?? "",
			projectRootPath: project?.rootPath ?? "",
			projectProvider: pp,
			projectModel: pm,
		});

		setShellPath((settings.shellPath as string) ?? "");
		setQuietStartup((settings.quietStartup as boolean) ?? false);
		setCollapseChangelog((settings.collapseChangelog as boolean) ?? false);
		setEnableInstallTelemetry((settings.enableInstallTelemetry as boolean) ?? true);
		setEnableSkillCommands((settings.enableSkillCommands as boolean) ?? true);
	}, [settings, budgets, project, justSaved]);

	// ---- Dirty state per tab ----

	const generalDirty = useMemo(
		() =>
			!isEqual(steeringMode, orig.steeringMode) ||
			!isEqual(followUpMode, orig.followUpMode) ||
			!isEqual(editStrategyMode, orig.editStrategyMode),
		[steeringMode, followUpMode, editStrategyMode, orig],
	);

	const budgetsDirty = useMemo(
		() =>
			!isEqual(budgetFlash, origBudgets.flash) ||
			!isEqual(budgetWorker, origBudgets.worker) ||
			!isEqual(budgetLead, origBudgets.lead) ||
			!isEqual(budgetReviewer, origBudgets.reviewer) ||
			!isEqual(budgetDebug, origBudgets.debug) ||
			!isEqual(budgetMaxAuto, origBudgets.maxAuto) ||
			!isEqual(millionContextEnabled, origBudgets.millionContextEnabled),
		[budgetFlash, budgetWorker, budgetLead, budgetReviewer, budgetDebug, budgetMaxAuto, millionContextEnabled, origBudgets],
	);

	const projectDirty = useMemo(() => {
		if (!project) return false;
		return (
			projectName !== (origProject.projectName as string) ||
			projectRootPath !== (origProject.projectRootPath as string) ||
			!isEqual(projectProvider, origProject.projectProvider) ||
			!isEqual(projectModel, origProject.projectModel)
		);
	}, [projectName, projectRootPath, projectProvider, projectModel, project, origProject]);

	const advancedDirty = useMemo(
		() =>
			!isEqual(shellPath, orig.shellPath) ||
			!isEqual(quietStartup, orig.quietStartup) ||
			!isEqual(collapseChangelog, orig.collapseChangelog) ||
			!isEqual(enableInstallTelemetry, orig.enableInstallTelemetry) ||
			!isEqual(enableSkillCommands, orig.enableSkillCommands),
		[shellPath, quietStartup, collapseChangelog, enableInstallTelemetry, enableSkillCommands, orig],
	);

	// Compute change counts per tab
	const generalChanges = useMemo(() => {
		let count = 0;
		if (!isEqual(steeringMode, orig.steeringMode)) count++;
		if (!isEqual(followUpMode, orig.followUpMode)) count++;
		return count;
	}, [steeringMode, followUpMode, orig]);

	const budgetsChanges = useMemo(() => {
		let count = 0;
		if (!isEqual(budgetFlash, origBudgets.flash)) count++;
		if (!isEqual(budgetWorker, origBudgets.worker)) count++;
		if (!isEqual(budgetLead, origBudgets.lead)) count++;
		if (!isEqual(budgetReviewer, origBudgets.reviewer)) count++;
		if (!isEqual(budgetDebug, origBudgets.debug)) count++;
		if (!isEqual(budgetMaxAuto, origBudgets.maxAuto)) count++;
		if (!isEqual(millionContextEnabled, origBudgets.millionContextEnabled)) count++;
		return count;
	}, [budgetFlash, budgetWorker, budgetLead, budgetReviewer, budgetDebug, budgetMaxAuto, millionContextEnabled, origBudgets]);

	const projectChanges = useMemo(() => {
		if (!project) return 0;
		let count = 0;
		if (projectName !== (origProject.projectName as string)) count++;
		if (projectRootPath !== (origProject.projectRootPath as string)) count++;
		if (!isEqual(projectProvider, origProject.projectProvider)) count++;
		if (!isEqual(projectModel, origProject.projectModel)) count++;
		return count;
	}, [projectName, projectRootPath, projectProvider, projectModel, project, origProject]);

	const totalChanges = generalChanges + budgetsChanges + projectChanges;

	const handleClose = useCallback(() => {
		setSaved(false);
		onClose();
	}, [onClose]);

	const handleSaveGeneral = async () => {
		setJustSaved(true);
		await updateSettings({
			steeringMode,
			followUpMode, editStrategyMode,
		});
		setOrig({
			...orig,
			steeringMode,
			followUpMode,
			editStrategyMode,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	const handleSaveBudgets = async () => {
		await updateSettings({
			contextBudgets: {
				flash: budgetFlash,
				worker: budgetWorker,
				lead: budgetLead,
				reviewer: budgetReviewer,
				debug: budgetDebug,
				maxAuto: budgetMaxAuto,
				millionContextEnabled,
			},
		});
		setOrigBudgets({
			flash: budgetFlash,
			worker: budgetWorker,
			lead: budgetLead,
			reviewer: budgetReviewer,
			debug: budgetDebug,
			maxAuto: budgetMaxAuto,
			millionContextEnabled,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	const handleSaveProject = async () => {
		if (project) {
			await updateProjectMeta({
				projectId: project.id,
				name: projectName || undefined,
				rootPath: projectRootPath || undefined,
			});
		}
		// Provider and model are per-project settings
		await updateProjectSettings({
			defaultProvider: projectProvider || null,
			defaultModel: projectModel || null,
		});
		setOrigProject({
			projectName,
			projectRootPath,
			projectProvider,
			projectModel,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	const handleSaveAdvanced = async () => {
		await updateSettings({
			shellPath: shellPath || null,
			quietStartup,
			collapseChangelog,
			enableInstallTelemetry,
			enableSkillCommands,
		});
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	// ---- Theme helper (localStorage only) ----
	const handleThemeChange = (newTheme: string) => {
		setTheme(newTheme);
		writeDashboardTheme(newTheme);
		try { document.documentElement.setAttribute("data-theme", newTheme || "dark"); } catch { /* ignore */ }
	};

	// ---- Provider / Model helpers (per-project) ----

	const modelsForProvider = useMemo(() => {
		if (!projectProvider) return [];
		const entry = aiModels.find((a) => a.provider === projectProvider);
		return entry?.models ?? [];
	}, [projectProvider, aiModels]);

	// Reset model if current model isn't valid for the selected provider
	const handleProviderChange = (provider: string) => {
		setProjectProvider(provider);
		// If the current model isn't from the new provider, reset it
		const entry = aiModels.find((a) => a.provider === provider);
		if (entry && !entry.models.some((m) => m.id === projectModel)) {
			setProjectModel("");
		}
	};

	const tabs: { id: TabId; label: string; changes?: number }[] = [
		{ id: "general", label: "General", changes: generalChanges },
		{ id: "budgets", label: "Context Budgets", changes: budgetsChanges },
		{ id: "project", label: "Project", changes: projectChanges },
		{ id: "advanced", label: "Advanced" },
	];

	const inputClass =
		"w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500";
	const labelClass = "text-xs text-gray-400 block mb-1";
	const toggleClass =
		"relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none";
	const toggleActiveClass = "bg-blue-600";
	const toggleInactiveClass = "bg-gray-700";

	return (
		<AnimatePresence>
			{isOpen && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
					onClick={handleClose}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.1 }}
						className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl min-w-[560px] max-w-2xl max-h-[80vh] flex flex-col"
						onClick={(e) => e.stopPropagation()}
					>
						{/* Header */}
						<div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
							<h2 className="text-lg font-semibold text-gray-100">
								Settings
								{totalChanges > 0 && (
									<span className="ml-2 text-xs font-normal text-yellow-400">
										({totalChanges} unsaved change{totalChanges !== 1 ? "s" : ""})
									</span>
								)}
							</h2>
							<button
								onClick={handleClose}
								className="text-gray-500 hover:text-gray-300 text-sm"
							>
								Close
							</button>
						</div>

						{/* Tabs */}
						<div className="flex border-b border-gray-700 px-6">
							{tabs.map((tab) => (
								<button
									key={tab.id}
									onClick={() => setActiveTab(tab.id)}
									className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
										activeTab === tab.id
											? "border-blue-500 text-blue-400"
											: "border-transparent text-gray-500 hover:text-gray-300"
									}`}
								>
									{tab.label}
									{tab.changes !== undefined && tab.changes > 0 && (
										<span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-600 text-[10px] text-white font-semibold">
											{tab.changes}
										</span>
									)}
								</button>
							))}
						</div>

						{/* Content */}
						<div className="flex-1 overflow-y-auto px-6 py-4">
							{isLoading ? (
								<div className="text-gray-500 text-sm py-8 text-center">Loading settings...</div>
							) : (
								<>
									{/* General Tab */}
									{activeTab === "general" && (
										<div className="space-y-4">
											<p className="text-xs text-gray-500 mb-3">
												General agent behavior settings. Provider and model are per-project (see Project tab).
											</p>
											<div>
												<label className={labelClass}>Steering Mode</label>
												<select
													value={steeringMode}
													onChange={(e) =>
														setSteeringMode(e.target.value as "all" | "one-at-a-time")
													}
													className={inputClass}
												>
													<option value="one-at-a-time">One at a time</option>
													<option value="all">All</option>
												</select>
											</div>
											<div>
												<label className={labelClass}>Follow-up Mode</label>
												<select
													value={followUpMode}
													onChange={(e) =>
														setFollowUpMode(e.target.value as "all" | "one-at-a-time")
													}
													className={inputClass}
												>
													<option value="one-at-a-time">One at a time</option>
													<option value="all">All</option>
												</select>
											</div>
											{/* P4.5: Edit Strategy Mode */}
											<div>
												<label className={labelClass}>Edit Strategy</label>
												<select
													value={editStrategyMode}
													onChange={(e) => setEditStrategyMode(e.target.value as "token_saving" | "hybrid" | "speed")}
													className={inputClass}
												>
													<option value="hybrid">Hybrid (default)</option>
													<option value="token_saving">Token Saving</option>
													<option value="speed">Speed</option>
												</select>
												<p className="text-xs text-gray-600 mt-1">Controls full-file rewrites vs targeted patches. Hybrid allows rewrites for manageable files; Token Saving prefers patches; Speed disables token restrictions.</p>
											</div>
											<hr className="border-gray-700 my-3" />
											<p className="text-xs text-gray-500 mb-1">Dashboard appearance (does not affect agent settings)</p>
											<div>
												<label className={labelClass}>Theme</label>
												<select
													value={theme}
													onChange={(e) => handleThemeChange(e.target.value)}
													className={inputClass}
												>
													<option value="">Default</option>
													<option value="dark">Dark</option>
													<option value="light">Light</option>
												</select>
											</div>
											<div className="pt-2 flex items-center justify-between">
												{generalChanges > 0 && (
													<span className="text-xs text-yellow-500">
														{generalChanges} change{generalChanges !== 1 ? "s" : ""}
													</span>
												)}
												<div className="flex-1" />
												<button
													onClick={handleSaveGeneral}
													disabled={isSaving || !generalDirty}
													className={`px-4 py-2 text-xs rounded transition-colors disabled:opacity-40 ${
														generalDirty
															? "bg-blue-700 hover:bg-blue-600 text-white"
															: "bg-gray-700 text-gray-500 cursor-not-allowed"
													}`}
												>
													{isSaving ? "Saving..." : generalDirty ? "Save" : "No changes"}
												</button>
											</div>
										</div>
									)}

									{/* Context Budgets Tab */}
									{activeTab === "budgets" && (
										<div className="space-y-4">
											<p className="text-xs text-gray-500 mb-3">
												Token budget limits per agent role. These prevent excessive token
												consumption during plan execution (P1 Token Consumption feature).
											</p>
											<div className="grid grid-cols-2 gap-4">
												<div>
													<label className={labelClass}>
														Flash Budget (tokens)
													</label>
													<input
														type="number"
														value={budgetFlash}
														onChange={(e) => setBudgetFlash(Number(e.target.value))}
														min={500}
														step={500}
														className={inputClass}
													/>
												</div>
												<div>
													<label className={labelClass}>
														Worker Budget (tokens)
													</label>
													<input
														type="number"
														value={budgetWorker}
														onChange={(e) => setBudgetWorker(Number(e.target.value))}
														min={1000}
														step={1000}
														className={inputClass}
													/>
												</div>
												<div>
													<label className={labelClass}>
														Lead Budget (tokens)
													</label>
													<input
														type="number"
														value={budgetLead}
														onChange={(e) => setBudgetLead(Number(e.target.value))}
														min={1000}
														step={1000}
														className={inputClass}
													/>
												</div>
												<div>
													<label className={labelClass}>
														Reviewer Budget (tokens)
													</label>
													<input
														type="number"
														value={budgetReviewer}
														onChange={(e) => setBudgetReviewer(Number(e.target.value))}
														min={1000}
														step={1000}
														className={inputClass}
													/>
												</div>
												<div>
													<label className={labelClass}>
														Debug Budget (tokens)
													</label>
													<input
														type="number"
														value={budgetDebug}
														onChange={(e) => setBudgetDebug(Number(e.target.value))}
														min={1000}
														step={1000}
														className={inputClass}
													/>
												</div>
												<div>
													<label className={labelClass}>
														Max Auto Context (tokens)
													</label>
													<input
														type="number"
														value={budgetMaxAuto}
														onChange={(e) => setBudgetMaxAuto(Number(e.target.value))}
														min={1000}
														step={1000}
														className={inputClass}
													/>
												</div>
											</div>
											<div className="flex items-center gap-3 pt-2">
												<button
													type="button"
													onClick={() => setMillionContextEnabled(!millionContextEnabled)}
													className={`${toggleClass} ${
														millionContextEnabled ? toggleActiveClass : toggleInactiveClass
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															millionContextEnabled ? "translate-x-[18px]" : "translate-x-[2px]"
														}`}
													/>
												</button>
												<label className="text-xs text-gray-300 cursor-pointer">
													Enable 1M Context
												</label>
											</div>
											<div className="pt-2 flex items-center justify-between">
												{budgetsChanges > 0 && (
													<span className="text-xs text-yellow-500">
														{budgetsChanges} change{budgetsChanges !== 1 ? "s" : ""}
													</span>
												)}
												<div className="flex-1" />
												<button
													onClick={handleSaveBudgets}
													disabled={isSaving || !budgetsDirty}
													className={`px-4 py-2 text-xs rounded transition-colors disabled:opacity-40 ${
														budgetsDirty
															? "bg-blue-700 hover:bg-blue-600 text-white"
															: "bg-gray-700 text-gray-500 cursor-not-allowed"
													}`}
												>
													{isSaving ? "Saving..." : budgetsDirty ? "Save" : "No changes"}
												</button>
											</div>
										</div>
									)}

									{/* Project Tab */}
									{activeTab === "project" && (
										<div className="space-y-4">
											<p className="text-xs text-gray-500 mb-3">
												Project-specific settings. Provider and model apply to this project only.
											</p>
											<div>
												<label className={labelClass}>Project Name</label>
												<input
													type="text"
													value={projectName}
													onChange={(e) => setProjectName(e.target.value)}
													placeholder={project?.name ?? "Project name"}
													className={inputClass}
												/>
											</div>
											<div>
												<label className={labelClass}>Root Path</label>
												<input
													type="text"
													value={projectRootPath}
													onChange={(e) => setProjectRootPath(e.target.value)}
													placeholder={project?.rootPath ?? "/path/to/project"}
													className={inputClass}
												/>
											</div>

											{/* Per-project Provider */}
											<div>
												<label className={labelClass}>Provider</label>
												{modelsLoading ? (
													<div className="text-xs text-gray-500 py-2">Loading providers...</div>
												) : (
													<select
														value={projectProvider}
														onChange={(e) => handleProviderChange(e.target.value)}
														className={inputClass}
													>
														<option value="">-- None --</option>
														{aiModels.map((p) => (
															<option key={p.provider} value={p.provider}>
																{p.provider}
															</option>
														))}
													</select>
												)}
											</div>

											{/* Per-project Model */}
											<div>
												<label className={labelClass}>Model</label>
												{modelsLoading ? (
													<div className="text-xs text-gray-500 py-2">Loading models...</div>
												) : (
													<select
														value={projectModel}
														onChange={(e) => setProjectModel(e.target.value)}
														className={inputClass}
														disabled={!projectProvider}
													>
														<option value="">-- None --</option>
														{modelsForProvider.map((m) => (
															<option key={m.id} value={m.id}>
																{m.name ?? m.id}
															</option>
														))}
													</select>
												)}
												{!projectProvider && (
													<p className="text-xs text-gray-600 mt-1">
														Select a provider first to see available models.
													</p>
												)}
											</div>

											<div className="pt-2 flex justify-end">
												<button
													onClick={handleSaveProject}
													disabled={isSaving || projectSaving || !projectDirty}
													className={`px-4 py-2 text-xs rounded transition-colors disabled:opacity-40 ${
														projectDirty
															? "bg-blue-700 hover:bg-blue-600 text-white"
															: "bg-gray-700 text-gray-500 cursor-not-allowed"
													}`}
												>
													{isSaving || projectSaving
														? "Saving..."
														: projectDirty
															? "Save"
															: "No changes"}
												</button>
											</div>
										</div>
									)}

									{/* Advanced Tab */}
									{activeTab === "advanced" && (
										<div className="space-y-4">
											<div>
												<label className={labelClass}>Shell Path</label>
												<input
													type="text"
													value={shellPath}
													onChange={(e) => setShellPath(e.target.value)}
													placeholder="/bin/bash (default)"
													className={inputClass}
												/>
											</div>
											<div className="flex items-center gap-3">
												<button
													type="button"
													onClick={() => setQuietStartup(!quietStartup)}
													className={`${toggleClass} ${
														quietStartup ? toggleActiveClass : toggleInactiveClass
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															quietStartup ? "translate-x-[18px]" : "translate-x-[2px]"
														}`}
													/>
												</button>
												<label className="text-xs text-gray-300 cursor-pointer">
													Quiet Startup
												</label>
											</div>
											<div className="flex items-center gap-3">
												<button
													type="button"
													onClick={() => setCollapseChangelog(!collapseChangelog)}
													className={`${toggleClass} ${
														collapseChangelog ? toggleActiveClass : toggleInactiveClass
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															collapseChangelog ? "translate-x-[18px]" : "translate-x-[2px]"
														}`}
													/>
												</button>
												<label className="text-xs text-gray-300 cursor-pointer">
													Collapse Changelog
												</label>
											</div>
											<div className="flex items-center gap-3">
												<button
													type="button"
													onClick={() => setEnableInstallTelemetry(!enableInstallTelemetry)}
													className={`${toggleClass} ${
														enableInstallTelemetry ? toggleActiveClass : toggleInactiveClass
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															enableInstallTelemetry
																? "translate-x-[18px]"
																: "translate-x-[2px]"
														}`}
													/>
												</button>
												<label className="text-xs text-gray-300 cursor-pointer">
													Install Telemetry
												</label>
											</div>
											<div className="flex items-center gap-3">
												<button
													type="button"
													onClick={() => setEnableSkillCommands(!enableSkillCommands)}
													className={`${toggleClass} ${
														enableSkillCommands ? toggleActiveClass : toggleInactiveClass
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															enableSkillCommands
																? "translate-x-[18px]"
																: "translate-x-[2px]"
														}`}
													/>
												</button>
												<label className="text-xs text-gray-300 cursor-pointer">
													Enable Skill Commands
												</label>
											</div>
											<div className="pt-2 flex items-center justify-between">
												{advancedDirty && (
													<span className="text-xs text-yellow-500">Unsaved changes</span>
												)}
												<div className="flex-1" />
												<button
													onClick={handleSaveAdvanced}
													disabled={isSaving || !advancedDirty}
													className={`px-4 py-2 text-xs rounded transition-colors disabled:opacity-40 ${
														advancedDirty
															? "bg-blue-700 hover:bg-blue-600 text-white"
															: "bg-gray-700 text-gray-500 cursor-not-allowed"
													}`}
												>
													{isSaving ? "Saving..." : advancedDirty ? "Save" : "No changes"}
												</button>
											</div>
										</div>
									)}
								</>
							)}
						</div>

						{/* Footer */}
						{saved && (
							<div className="px-6 py-2 border-t border-gray-700">
								<p className="text-xs text-green-400">Settings saved successfully.</p>
							</div>
						)}
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
