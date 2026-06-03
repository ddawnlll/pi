import { create } from "zustand";

// ─── localStorage helpers ─────────────────────────────────────────────────

const SELECTED_PROJECT_KEY = "pi_selected_project_id";
const SELECTED_EXEC_KEY = "pi_selected_exec_id";
const SELECTED_TASK_KEY = "pi_selected_task_id";

function loadLocal(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}

function saveLocal(key: string, value: string | null): void {
	try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─── Store ────────────────────────────────────────────────────────────────

interface SelectionState {
	selectedProjectId: string | null;
	selectedPlanExecId: string | null;
	selectedTaskId: string | null;
	selectedWorkerId: string | null;

	setProjectId: (id: string | null) => void;
	setPlanExecId: (id: string | null) => void;
	setTaskId: (id: string | null) => void;
	setWorkerId: (id: string | null) => void;
	clearSelection: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
	selectedProjectId: loadLocal(SELECTED_PROJECT_KEY),
	selectedPlanExecId: loadLocal(SELECTED_EXEC_KEY),
	selectedTaskId: loadLocal(SELECTED_TASK_KEY),
	selectedWorkerId: null,

	setProjectId: (id) => {
		saveLocal(SELECTED_PROJECT_KEY, id);
		set({ selectedProjectId: id, selectedPlanExecId: null, selectedTaskId: null, selectedWorkerId: null });
	},
	setPlanExecId: (id) => {
		saveLocal(SELECTED_EXEC_KEY, id);
		set({ selectedPlanExecId: id, selectedWorkerId: null });
	},
	setTaskId: (id) => {
		saveLocal(SELECTED_TASK_KEY, id);
		set({ selectedTaskId: id });
	},
	setWorkerId: (id) => set({ selectedWorkerId: id }),
	clearSelection: () => {
		saveLocal(SELECTED_PROJECT_KEY, null);
		saveLocal(SELECTED_EXEC_KEY, null);
		saveLocal(SELECTED_TASK_KEY, null);
		set({ selectedProjectId: null, selectedPlanExecId: null, selectedTaskId: null, selectedWorkerId: null });
	},
}));
