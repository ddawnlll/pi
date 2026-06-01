/**
 * files/ — P42.07 Files/Diff IDE Workspace
 *
 * Execution-aware file explorer components.
 * All components consume data from the read model API, not from
 * filesystem or git direct access.
 */

export { ExecutionFileTree } from "./ExecutionFileTree";
export type { ExecutionFileTreeProps } from "./ExecutionFileTree";

export { FileDiffView } from "./FileDiffView";
export type { FileDiffViewProps } from "./FileDiffView";

export { FilePreview } from "./FilePreview";
export type { FilePreviewProps } from "./FilePreview";

export { FileEvidencePanel } from "./FileEvidencePanel";
export type { FileEvidencePanelProps } from "./FileEvidencePanel";
