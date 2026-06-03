import { useNavigation } from "../navigation/NavigationState";

import { AutonomyCenter } from "../features/autonomy/AutonomyCenter";
import { ExtensionsManager } from "../components/ExtensionsManager";
import { SkillsManager } from "../components/SkillsManager";
import { RegistrySettings } from "../features/settings/RegistrySettings";
import { PlanIntakePanel } from "../features/plan-intake/PlanIntakePanel";
import { PolicyAuditCenter } from "../features/policy-audit/PolicyAuditCenter";
import { TrustDashboard } from "../features/trust/TrustDashboard";
import { GoalBoard } from "../components/brain/goals/GoalBoard";
import { ProposalInbox } from "../features/proposal-inbox/ProposalInbox";
import { ObservabilityCockpit } from "../features/observability/ObservabilityCockpit";
import { PiInbox } from "../components/inbox/PiInbox";
import { BrainStatePage } from "../pages/BrainStatePage";
import { BrainMemoryPage } from "../pages/BrainMemoryPage";
import { BrainReflectionsPage } from "../pages/BrainReflectionsPage";
import { BrainTrustPage } from "../pages/BrainTrustPage";
import { BrainOvernightPage } from "../pages/BrainOvernightPage";
import { DigestPage } from "../pages/DigestPage";
import { BrainInboxPage } from "../pages/BrainInboxPage";
import { Cpu } from "lucide-react";

export function PlatformRoute() {
	const { route } = useNavigation();
	const screen = route.platformScreen;

	if (screen === "autonomy") return <AutonomyCenter className="flex-1 min-h-0" />;
	if (screen === "observability") return <ObservabilityCockpit className="flex-1 min-h-0" />;
	if (screen === "extensions_skills") return (
		<>
			<ExtensionsManager className="flex-1 min-h-0" />
			<SkillsManager className="flex-1 min-h-0" />
		</>
	);
	if (screen === "plan_intake") return <PlanIntakePanel className="flex-1 min-h-0" />;
	if (screen === "policy_audit") return <PolicyAuditCenter className="flex-1 min-h-0" />;
	if (screen === "registry_settings") return <RegistrySettings className="flex-1 min-h-0" />;
	if (screen === "pi_inbox") return <PiInbox className="flex-1 min-h-0" />;
	if (screen === "brain_overview") return <BrainStatePage />;
	if (screen === "brain_temporal") return <BrainPlaceholder title="Temporal Journal" />;
	if (screen === "brain_repo_scanner") return <BrainPlaceholder title="Repo Scanner" />;
	if (screen === "brain_proposals" || screen === "brain_drafts") return <ProposalInbox className="flex-1 min-h-0" />;
	if (screen === "brain_memory") return <BrainMemoryPage />;
	if (screen === "brain_reflections") return <BrainReflectionsPage />;
	if (screen === "brain_signals" || screen === "brain_digest") return <DigestPage />;
	if (screen === "brain_ask" || screen === "brain_inbox") return <BrainInboxPage />;
	if (screen === "brain_overnight") return <BrainOvernightPage />;
	if (screen === "brain_goals") return <GoalBoard className="flex-1 min-h-0" />;
	if (screen === "brain_trust") return <TrustDashboard className="flex-1 min-h-0" />;

	return (
		<div className="flex-1 flex flex-col items-center justify-center gap-3 text-stone-400 dark:text-stone-500">
			<Cpu size={32} strokeWidth={1.2} />
			<p className="text-sm">Choose a platform tool from the sidebar to get started.</p>
		</div>
	);
}

function BrainPlaceholder({ title }: { title: string }) {
	return (
		<div className="flex-1 flex items-center justify-center p-6">
			<div className="text-center max-w-md">
				<h2 className="text-lg font-semibold text-stone-700 dark:text-stone-200">{title}</h2>
				<p className="text-sm text-stone-400 dark:text-stone-500 mt-2">This page is not yet implemented. Check back soon.</p>
			</div>
		</div>
	);
}
