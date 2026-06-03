import { useSelectionStore } from "../stores/selectionStore";
import { useNavigation } from "../navigation/NavigationState";
import { WorkspaceDetailPage } from "../pages/workspace/WorkspaceDetailPage";
import { Cpu } from "lucide-react";

export function WorkspaceDetailRoute() {
	const { selectedProjectId, selectedPlanExecId } = useSelectionStore();
	const { route, navigateToRun, setCockpitTab } = useNavigation();
	const workspaceId = route.workspaceId;

	if (!workspaceId) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-3 text-stone-400 dark:text-stone-500">
				<Cpu size={32} strokeWidth={1.2} />
				<p className="text-sm">No workspace selected</p>
			</div>
		);
	}

	return (
		<div className="flex-1 min-h-0 overflow-hidden">
			<WorkspaceDetailPage
				projectId={selectedProjectId}
				planExecId={selectedPlanExecId}
				workspaceId={workspaceId}
				onBackToWorkspaces={() => {
					if (selectedPlanExecId) {
						navigateToRun(selectedPlanExecId);
						setCockpitTab("workspaces");
					} else {
						navigateToRun("");
					}
				}}
			/>
		</div>
	);
}
