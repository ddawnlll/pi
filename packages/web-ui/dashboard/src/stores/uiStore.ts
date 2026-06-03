import { create } from "zustand";
import type { DrawerPanel } from "../components/shell/ContextualRightDrawer";

interface UIState {
	// Dialogs
	showProjectDialog: boolean;
	showPlanUploadDialog: boolean;
	showTaskCreateDialog: boolean;
	showSettingsDialog: boolean;
	showRerunDialog: boolean;
	showExecutionLog: boolean;
	showGitDialog: boolean;
	showCommandsDialog: boolean;
	showForceKillConfirm: boolean;

	// Overlay panels
	showChat: boolean;
	showBrainContext: boolean;
	showArtifacts: boolean;

	// Sidebar / layout
	leftOpen: boolean;
	rightOpen: boolean;
	mobileNav: "left" | "right" | null;

	// Contextual drawer
	contextualDrawer: DrawerPanel | null;

	// Error
	errorBanner: string | null;

	// Event filter
	eventFilter: "all" | "errors";

	// Loading states
	controlActionInFlight: boolean;
	rerunning: boolean;

	// Actions
	setShowProjectDialog: (v: boolean) => void;
	setShowPlanUploadDialog: (v: boolean) => void;
	setShowTaskCreateDialog: (v: boolean) => void;
	setShowSettingsDialog: (v: boolean) => void;
	setShowRerunDialog: (v: boolean) => void;
	setShowExecutionLog: (v: boolean) => void;
	setShowGitDialog: (v: boolean) => void;
	setShowCommandsDialog: (v: boolean) => void;
	setShowForceKillConfirm: (v: boolean) => void;
	setShowChat: (v: boolean) => void;
	setShowBrainContext: (v: boolean) => void;
	setShowArtifacts: (v: boolean) => void;
	toggleLeft: () => void;
	toggleRight: () => void;
	setMobileNav: (v: "left" | "right" | null) => void;
	setContextualDrawer: (v: DrawerPanel | null) => void;
	setErrorBanner: (v: string | null) => void;
	setEventFilter: (v: "all" | "errors") => void;
	setControlActionInFlight: (v: boolean) => void;
	setRerunning: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
	showProjectDialog: false,
	showPlanUploadDialog: false,
	showTaskCreateDialog: false,
	showSettingsDialog: false,
	showRerunDialog: false,
	showExecutionLog: false,
	showGitDialog: false,
	showCommandsDialog: false,
	showForceKillConfirm: false,
	showChat: false,
	showBrainContext: false,
	showArtifacts: false,
	leftOpen: true,
	rightOpen: false,
	mobileNav: null,
	contextualDrawer: null,
	errorBanner: null,
	eventFilter: "all",
	controlActionInFlight: false,
	rerunning: false,

	setShowProjectDialog: (v) => set({ showProjectDialog: v }),
	setShowPlanUploadDialog: (v) => set({ showPlanUploadDialog: v }),
	setShowTaskCreateDialog: (v) => set({ showTaskCreateDialog: v }),
	setShowSettingsDialog: (v) => set({ showSettingsDialog: v }),
	setShowRerunDialog: (v) => set({ showRerunDialog: v }),
	setShowExecutionLog: (v) => set({ showExecutionLog: v }),
	setShowGitDialog: (v) => set({ showGitDialog: v }),
	setShowCommandsDialog: (v) => set({ showCommandsDialog: v }),
	setShowForceKillConfirm: (v) => set({ showForceKillConfirm: v }),
	setShowChat: (v) => set({ showChat: v }),
	setShowBrainContext: (v) => set({ showBrainContext: v }),
	setShowArtifacts: (v) => set({ showArtifacts: v }),
	toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
	toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
	setMobileNav: (v) => set({ mobileNav: v }),
	setContextualDrawer: (v) => set({ contextualDrawer: v }),
	setErrorBanner: (v) => set({ errorBanner: v }),
	setEventFilter: (v) => set({ eventFilter: v }),
	setControlActionInFlight: (v) => set({ controlActionInFlight: v }),
	setRerunning: (v) => set({ rerunning: v }),
}));
