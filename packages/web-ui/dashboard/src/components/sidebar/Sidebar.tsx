/**
 * Sidebar — P11 Core / Brain (P19) hierarchical sidebar navigation.
 *
 * P21.A — Sidebar Hierarchy Implementation
 *
 * Provides two visually distinct sections:
 * - Platform (P11 Core): muted gray, uppercase header, `⌘` prefix
 * - Brain (P19): blue/purple accent, `🧠` header prefix, text-sm font-medium
 *
 * Each section is collapsible with a chevron indicator.
 * Duplicate entries (Memory, Proposals, Goals) are consolidated to
 * the Brain section with a cross-reference in Platform.
 */

import { useState, useCallback } from "react";
import {
	Activity,
	ClipboardCheck,
	Cpu,
	Database,
	Eye,
	FileText,
	Heart,
	Lightbulb,
	Moon,
	Puzzle,
	Shield,
	Target,
	Upload,
	ChevronDown,
	ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SidebarItem {
	id: string;
	label: string;
	icon?: LucideIcon;
	badge?: number;
	isActive?: boolean;
	href?: string;
	onClick?: () => void;
}

export interface SidebarSection {
	id: string;
	title: string;
	type: "platform" | "brain";
	items: SidebarItem[];
	isExpanded?: boolean;
}

// ---------------------------------------------------------------------------
// Style tokens (matching App.tsx conventions)
// ---------------------------------------------------------------------------

const TXT = "text-stone-800 dark:text-stone-200";
const MUT = "text-stone-400 dark:text-stone-500";
const BORD = "border-[#E8E6E1] dark:border-[#333]";
const ACC_BG = "bg-[#EBF2FF] dark:bg-[#1A2A44]";
const ACC_TXT = "text-blue-700 dark:text-blue-300";

// ---------------------------------------------------------------------------
// Section data
// ---------------------------------------------------------------------------

export const PLATFORM_SECTIONS: SidebarSection[] = [
	{
		id: "p11-core",
		title: "P11 Core",
		type: "platform",
		isExpanded: true,
		items: [
			{ id: "autonomy", label: "Autonomy", icon: Cpu },
			{ id: "plan_intake", label: "Plan Intake", icon: Upload },
			{ id: "extensions_skills", label: "Extensions & Skills", icon: Puzzle },
			{ id: "policy_audit", label: "Policy & Audit", icon: ClipboardCheck },
			{ id: "trust_dashboard", label: "Trust Dashboard", icon: Heart },
			{ id: "registry_settings", label: "Registry Settings", icon: Shield },
		],
	},
];

export const BRAIN_SECTIONS: SidebarSection[] = [
	{
		id: "p19-brain",
		title: "Brain",
		type: "brain",
		isExpanded: true,
		items: [
			{ id: "brain_state", label: "State / Overview", icon: Activity },
			{ id: "goals", label: "Goals", icon: Target },
			{ id: "proposal_inbox", label: "Proposals", icon: FileText },
			{ id: "brain_memory", label: "Memory Explorer", icon: Database },
			{ id: "brain_reflections", label: "Reflections", icon: Lightbulb },
			{ id: "brain_overnight", label: "Overnight", icon: Moon },
			{ id: "brain_trust", label: "Trust Dashboard", icon: Eye },
		],
	},
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSectionHeaderClass(type: "platform" | "brain"): string {
	if (type === "platform") {
		return "text-[10px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400";
	}
	return "text-sm font-medium text-blue-500 dark:text-blue-400";
}

function getItemIconClass(isActive: boolean, type: "platform" | "brain"): string {
	if (isActive) return ACC_TXT;
	if (type === "brain") return "text-blue-400/70 dark:text-blue-500/70";
	return MUT;
}

// ---------------------------------------------------------------------------
// Sidebar component
// ---------------------------------------------------------------------------

export interface SidebarProps {
	activeItem: string | null;
	onNavigate: (item: string) => void;
	/** Default-expand sections; defaults to both expanded */
	defaultExpanded?: Record<string, boolean>;
}

export function Sidebar({
	activeItem,
	onNavigate,
	defaultExpanded,
}: SidebarProps) {
	// Track collapsed state per section
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		const initial: Record<string, boolean> = {};
		for (const section of [...PLATFORM_SECTIONS, ...BRAIN_SECTIONS]) {
			initial[section.id] =
				defaultExpanded?.[section.id] ?? section.isExpanded ?? true;
		}
		return initial;
	});

	const toggleSection = useCallback((sectionId: string) => {
		setExpanded((prev) => ({
			...prev,
			[sectionId]: !prev[sectionId],
		}));
	}, []);

	const renderItem = useCallback(
		(item: SidebarItem, sectionType: "platform" | "brain") => {
			const Icon = item.icon;
			const isActive = activeItem === item.id;
			return (
				<button
					key={item.id}
					onClick={item.onClick ?? (() => onNavigate(item.id))}
					className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors text-left w-full ${
						isActive
							? `${ACC_BG} ${ACC_TXT}`
							: `${MUT} hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A]`
					}`}
				>
					{Icon && (
						<Icon
							size={15}
							strokeWidth={1.6}
							className={`shrink-0 ${getItemIconClass(isActive, sectionType)}`}
						/>
					)}
					<div className="min-w-0 flex-1">
						<div
							className={`text-[12px] font-medium leading-tight ${
								isActive ? ACC_TXT : TXT
							}`}
						>
							{item.label}
							{item.badge != null && item.badge > 0 && (
								<span className="ml-2 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
									{item.badge}
								</span>
							)}
						</div>
					</div>
				</button>
			);
		},
		[activeItem, onNavigate],
	);

	const renderSection = useCallback(
		(section: SidebarSection) => {
			const isExpanded = expanded[section.id] ?? true;
			const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;
			return (
				<div key={section.id} className="mb-1">
					{/* Section header */}
					<button
						onClick={() => toggleSection(section.id)}
						className={`flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md transition-colors hover:bg-stone-100 dark:hover:bg-[#2A2A2A] ${getSectionHeaderClass(section.type)}`}
						aria-expanded={isExpanded}
					>
						{section.type === "brain" && (
							<span className="shrink-0 text-base" aria-hidden="true">
								🧠
							</span>
						)}
						{section.type === "platform" && (
							<span className="shrink-0 text-[10px] opacity-60" aria-hidden="true">
								⌘
							</span>
						)}
						<span className="flex-1 truncate">{section.title}</span>
						<ChevronIcon
							size={12}
							strokeWidth={2}
							className={`shrink-0 transition-transform duration-200 ${MUT}`}
						/>
					</button>

					{/* Items (collapsible) */}
					<div
						className={`overflow-hidden transition-all duration-200 ${
							isExpanded ? "max-h-[999px] opacity-100" : "max-h-0 opacity-0"
						}`}
					>
						<div className="flex flex-col gap-0.5 px-1 pt-0.5">
							{section.items.map((item) => renderItem(item, section.type))}
						</div>
					</div>
				</div>
			);
		},
		[expanded, toggleSection, renderItem],
	);

	// Section separator
	const Separator = () => (
		<div className={`mx-3 my-1 border-t ${BORD}`} />
	);

	return (
		<div className="flex flex-col gap-1 py-2" role="navigation" aria-label="Sidebar navigation">
			{PLATFORM_SECTIONS.map(renderSection)}
			<Separator />
			{BRAIN_SECTIONS.map(renderSection)}
		</div>
	);
}
