/**
 * LeftNav — Platform navigation group for P11 dashboard shell.
 *
 * P11.S — Dashboard shell, navigation integration, and registry settings
 *
 * AC: New Platform nav entries route to the correct screens.
 *
 * Platform entries:
 * - Autonomy → AutonomyCenter
 * - Plan Intake → PlanIntakePanel
 * - Extensions & Skills → ExtensionsManager / SkillsManager
 * - Memory → MemoryCockpit
 * - Policy & Audit → PolicyAuditCenter
 * - Registry Settings → RegistrySettings
 */

import {
	Cpu,
	Database,
	Package,
	ScrollText,
	ShieldAlert,
	Sliders,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";
const BORD = "border-[#E8E6E1] dark:border-[#333]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PlatformNavItem =
	| "autonomy"
	| "plan_intake"
	| "extensions_skills"
	| "memory"
	| "policy_audit"
	| "registry_settings";

export interface PlatformNavEntry {
	id: PlatformNavItem;
	label: string;
	icon: typeof Cpu;
	description: string;
}

export const PLATFORM_NAV_ENTRIES: PlatformNavEntry[] = [
	{
		id: "autonomy",
		label: "Autonomy",
		icon: Cpu,
		description: "Orchestrator health, proposals, self-improvement triggers",
	},
	{
		id: "plan_intake",
		label: "Plan Intake",
		icon: ScrollText,
		description: "Plan analysis, DAG diff, optimization approval",
	},
	{
		id: "extensions_skills",
		label: "Extensions & Skills",
		icon: Package,
		description: "Manage extensions, skills, and their lifecycle",
	},
	{
		id: "memory",
		label: "Memory",
		icon: Database,
		description: "Memory health, provenance, compaction",
	},
	{
		id: "policy_audit",
		label: "Policy & Audit",
		icon: ShieldAlert,
		description: "Permissions, approvals, audit timeline",
	},
	{
		id: "registry_settings",
		label: "Registry Settings",
		icon: Sliders,
		description: "Local/remote registries, channels, update policy",
	},
];

// ---------------------------------------------------------------------------
// LeftNav component
// ---------------------------------------------------------------------------

interface LeftNavProps {
	activeItem: PlatformNavItem | null;
	onNavigate: (item: PlatformNavItem) => void;
}

export function LeftNav({ activeItem, onNavigate }: LeftNavProps) {
	return (
		<div className="flex flex-col gap-0.5 px-2 pb-2">
			{PLATFORM_NAV_ENTRIES.map((entry) => {
				const Icon = entry.icon;
				const isActive = activeItem === entry.id;
				return (
					<button
						key={entry.id}
						onClick={() => onNavigate(entry.id)}
						className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left ${
							isActive
								? `${ACC_BG} ${ACC_TXT}`
								: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
						}`}
					>
						<Icon size={15} strokeWidth={1.6} className="shrink-0" />
						<div className="min-w-0 flex-1">
							<div className={`text-[12px] font-medium leading-tight ${isActive ? ACC_TXT : TXT}`}>
								{entry.label}
							</div>
							<div className={`text-[10px] leading-tight mt-0.5 ${MUT} truncate`}>
								{entry.description}
							</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// PlatformSectionHeader
// ---------------------------------------------------------------------------

interface PlatformSectionHeaderProps {
	title: string;
}

export function PlatformSectionHeader({ title }: PlatformSectionHeaderProps) {
	return (
		<div className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
			{title}
		</div>
	);
}
