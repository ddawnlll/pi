/**
 * LeftNav — Platform navigation group for the dashboard shell.
 *
 * V5.13: This component is DEPRECATED for rendering. The project-centric
 * Sidebar (./sidebar/Sidebar.tsx) is the single source of navigation truth.
 * LeftNav is retained only for type definitions (`PlatformNavItem`) and
 * the `PlatformNavEntry` data shape.
 *
 * Brain entries (P19 / V5.13) live exclusively in Sidebar.tsx.
 *
 * Platform entries (P11):
 * - Autonomy → AutonomyCenter
 * - Plan Intake → PlanIntakePanel
 * - Extensions & Skills → ExtensionsManager / SkillsManager
 * - Policy & Audit → PolicyAuditCenter
 * - Pi Inbox → PiInbox
 * - Registry Settings → RegistrySettings
 */

import {
	Activity,
	Bell,
	Cpu,
	Database,
	Eye,
	Inbox,
	Moon,
	Package,
	RotateCw,
	ScrollText,
	Shield,
	ShieldAlert,
	Sliders,
	Sunrise,
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
	| "observability"
	| "pi_inbox"
	| "plan_intake"
	| "extensions_skills"
	| "policy_audit"
	| "registry_settings"
	// P19 brain pages (V5.13 unified Brain section)
	| "brain_overview"
	| "brain_ask"
	| "brain_temporal"
	| "brain_memory"
	| "brain_repo_scanner"
	| "brain_signals"
	| "brain_proposals"
	| "brain_drafts"
	| "brain_reflections"
	| "brain_overnight"
	| "brain_goals"
	| "brain_trust"
	| "brain_digest"
	| "brain_inbox";

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
		id: "observability",
		label: "Observability",
		icon: Activity,
		description: "Telemetry events, stats, errors, time-series",
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
		id: "policy_audit",
		label: "Policy & Audit",
		icon: ShieldAlert,
		description: "Permissions, approvals, audit timeline",
	},

	{
		id: "pi_inbox",
		label: "Pi Inbox",
		icon: Bell,
		description: "Message center, system notifications, alerts",
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
		id: "brain_overview",
		label: "Overview",
		icon: Eye,
		description: "Brain daemon status, observations, signals, timeline",
	},
	{
		id: "brain_ask",
		label: "Ask Pi",
		icon: Cpu,
		description: "Interact with Pi, ask questions, give instructions",
	},
	{
		id: "brain_temporal",
		label: "Temporal Journal",
		icon: RotateCw,
		description: "Deterministic event timeline, rollups, stuck item tracking",
	},
	{
		id: "brain_memory",
		label: "Memory",
		icon: Database,
		description: "Full memory CRUD, search, filters",
	},
	{
		id: "brain_repo_scanner",
		label: "Repo Scanner",
		icon: ScrollText,
		description: "Repository observations, file changes, evidence",
	},
	{
		id: "brain_signals",
		label: "Signals",
		icon: Activity,
		description: "Active signals, signal feed, pattern detection",
	},
	{
		id: "brain_proposals",
		label: "Proposals",
		icon: Inbox,
		description: "Top-ranked proposals with recommendations",
	},
	{
		id: "brain_drafts",
		label: "Drafts",
		icon: ScrollText,
		description: "Draft proposals awaiting completion or review",
	},
	{
		id: "brain_reflections",
		label: "Reflections",
		icon: RotateCw,
		description: "Post-plan reflections, worked/failed, suggestions",
	},
	{
		id: "brain_overnight",
		label: "Overnight",
		icon: Moon,
		description: "Queue overnight runs, schedule, history",
	},
	{
		id: "brain_trust",
		label: "Trust",
		icon: Shield,
		description: "Trust metrics, safety, approvals, audit health",
	},
	{
		id: "brain_goals",
		label: "Goals",
		icon: Target,
		description: "Goal board, milestones, drift alerts",
	},

	{
		id: "brain_digest",
		label: "Morning Digest",
		icon: Sunrise,
		description: "Morning overview, top signals, pending proposals, goal progress",
	},
	{
		id: "brain_inbox",
		label: "Worker Inbox",
		icon: Inbox,
		description: "Worker handoff inbox and triage router",
	},
];

// ---------------------------------------------------------------------------
// LeftNav component (DEPRECATED — use Sidebar instead)
// ---------------------------------------------------------------------------

interface LeftNavProps {
	activeItem: PlatformNavItem | null;
	onNavigate: (item: PlatformNavItem) => void;
	/** @deprecated Brain section moved to Sidebar — this prop is ignored */
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

/**
 * @deprecated Use Sidebar component instead. LeftNav renders only Platform entries.
 * Brain navigation has moved to the project-centric Sidebar.
 */
export function LeftNav({ activeItem, onNavigate }: LeftNavProps) {
	return (
		<div className="flex flex-col gap-0.5 px-2 pb-2">
			<div className={`mt-0 mb-0.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${MUT}`}>
				Platform
			</div>
			{renderEntries(PLATFORM_NAV_ENTRIES, activeItem, onNavigate)}
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
