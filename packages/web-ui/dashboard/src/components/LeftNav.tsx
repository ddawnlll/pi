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
 *
 * Brain entries (P19):
 * - Brain State → BrainStatePage
 * - Memory Explorer → BrainMemoryPage
 * - Reflections → BrainReflectionsPage
 * - Overnight → BrainOvernightPage
 * - Goals → GoalBoard
 * - Proposals → ProposalInbox
 * - Trust → BrainTrustPage
 */

import {
	Cpu,
	Database,
	Inbox,
	Moon,
	Package,
	RotateCw,
	ScrollText,
	Shield,
	ShieldAlert,
	Sliders,
	Target,
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
	| "goals"
	| "proposal_inbox"
	| "plan_intake"
	| "extensions_skills"
	| "memory"
	| "policy_audit"
	| "trust_dashboard"
	| "registry_settings"
	// P19 brain pages
	| "brain_state"
	| "brain_memory"
	| "brain_reflections"
	| "brain_overnight"
	| "brain_goals"
	| "brain_proposals"
	| "brain_trust";

export interface PlatformNavEntry {
	id: PlatformNavItem;
	label: string;
	icon: typeof Cpu;
	description: string;
}

// ── P11 Platform entries ──

export const PLATFORM_NAV_ENTRIES: PlatformNavEntry[] = [
	{
		id: "autonomy",
		label: "Autonomy",
		icon: Cpu,
		description: "Orchestrator health, proposals, self-improvement triggers",
	},
	{
		id: "proposal_inbox",
		label: "Proposal Inbox",
		icon: Inbox,
		description: "Top-ranked proposals with recommendations",
	},
	{
		id: "goals",
		label: "Goals",
		icon: Target,
		description: "Goal board, milestones, drift alerts",
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
		id: "trust_dashboard",
		label: "Trust Dashboard",
		icon: Shield,
		description: "Trust metrics, safety, approvals, audit health",
	},
	{
		id: "registry_settings",
		label: "Registry Settings",
		icon: Sliders,
		description: "Local/remote registries, channels, update policy",
	},
];

// ── P19 Brain entries ──

export const BRAIN_NAV_ENTRIES: PlatformNavEntry[] = [
	{
		id: "brain_state",
		label: "Brain State",
		icon: Cpu,
		description: "Daemon status, observations, signals, timeline",
	},
	{
		id: "brain_memory",
		label: "Memory Explorer",
		icon: Database,
		description: "Full memory CRUD, search, filters",
	},
	{
		id: "brain_reflections",
		label: "Reflections",
		icon: RotateCw,
		description: "Post-plan reflections, worked/failed, suggestions",
	},
	{
		id: "brain_proposals",
		label: "Proposals",
		icon: Inbox,
		description: "Top-ranked proposals with recommendations",
	},
	{
		id: "brain_goals",
		label: "Goals",
		icon: Target,
		description: "Goal board, milestones, drift alerts",
	},
	{
		id: "brain_trust",
		label: "Trust Dashboard",
		icon: Shield,
		description: "Trust metrics, safety, approvals, audit health",
	},
	{
		id: "brain_overnight",
		label: "Overnight",
		icon: Moon,
		description: "Queue overnight runs, schedule, history",
	},
];

// ---------------------------------------------------------------------------
// LeftNav component
// ---------------------------------------------------------------------------

interface LeftNavProps {
	activeItem: PlatformNavItem | null;
	onNavigate: (item: PlatformNavItem) => void;
	showBrainSection?: boolean;
}

function renderEntries(
	entries: PlatformNavEntry[],
	activeItem: PlatformNavItem | null,
	onNavigate: (item: PlatformNavItem) => void,
) {
	return entries.map((entry) => {
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
	});
}

export function LeftNav({ activeItem, onNavigate, showBrainSection = true }: LeftNavProps) {
	return (
		<div className="flex flex-col gap-0.5 px-2 pb-2">
			{renderEntries(PLATFORM_NAV_ENTRIES, activeItem, onNavigate)}

			{showBrainSection && (
				<>
					<div className={`mt-2 mb-0.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
						Brain (P19)
					</div>
					{renderEntries(BRAIN_NAV_ENTRIES, activeItem, onNavigate)}
				</>
			)}
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
