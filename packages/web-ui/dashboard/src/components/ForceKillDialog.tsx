/**
 * ForceKillDialog — Confirmation dialog for force-killing all workers
 *
 * Shows a warning about data loss when force-killing an active plan.
 */

import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface ForceKillDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  executionTitle: string | null;
}

const OVERLAY = "bg-black/40";
const PANEL = "bg-white dark:bg-[#1E1E1E] border border-[#E8E6E1] dark:border-[#333] rounded-lg";

export function ForceKillDialog({ isOpen, onClose, onConfirm, executionTitle }: ForceKillDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${OVERLAY}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`${PANEL} w-full max-w-md mx-4 p-6`}>
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
              <AlertTriangle size={20} className="text-red-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-stone-800 dark:text-stone-200">Force Kill All Workers</h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                {executionTitle ?? "Plan execution"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-stone-400 dark:text-stone-500 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-700 dark:hover:text-stone-300"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        {/* Warning */}
        <div className="space-y-3 mb-6">
          <p className="text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
            This will immediately kill all active workers, abort in-flight LLM calls,
            and remove any git worktrees belonging to this execution.
          </p>
          <div className="rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 p-3">
            <p className="text-xs text-red-500 dark:text-red-400 leading-relaxed">
              <strong>Warning:</strong> Any uncommitted work by active workers will be lost.
              Workspaces that completed before the kill will be preserved.
              The plan will be marked as stopped and can be rerun.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] border border-[#E8E6E1] dark:border-[#333] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors"
          >
            Force Kill All Workers
          </button>
        </div>
      </div>
    </div>
  );
}
