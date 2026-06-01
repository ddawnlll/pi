/**
 * Drawers — P42.10 Contextual Drawer Components
 *
 * All contextual drawers are hidden by default and open on-demand
 * from relevant UI elements (workspace detail, event lines, file tree, etc.)
 *
 * Exports:
 * - TranscriptDrawer   — Worker transcript events
 * - ArtifactDrawer     — Artifacts / snapshots
 * - DebugEventDrawer   — Raw execution events (debug only)
 * - FileEvidenceDrawer — File change evidence + diff
 * - DirectiveDrawer    — Human directives for a workspace
 */

export { TranscriptDrawer } from "./TranscriptDrawer";
export type { TranscriptDrawerProps, TranscriptEvent } from "./TranscriptDrawer";

export { ArtifactDrawer } from "./ArtifactDrawer";
export type { ArtifactDrawerProps, ArtifactEntry } from "./ArtifactDrawer";

export { DebugEventDrawer } from "./DebugEventDrawer";
export type { DebugEventDrawerProps } from "./DebugEventDrawer";

export { FileEvidenceDrawer } from "./FileEvidenceDrawer";
export type { FileEvidenceDrawerProps, FileEvidence } from "./FileEvidenceDrawer";

export { DirectiveDrawer } from "./DirectiveDrawer";
export type { DirectiveDrawerProps, Directive } from "./DirectiveDrawer";

export { DrawerProvider, useDrawer, DrawerContext } from "./DrawerContext";
export type { DrawerState, DrawerProviderProps } from "./DrawerContext";
