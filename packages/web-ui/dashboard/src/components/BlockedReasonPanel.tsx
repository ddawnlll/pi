/**
 * BlockedReasonPanel — displays why a task is blocked and how to resolve it.
 */

import React from "react";
import { AlertTriangle, ShieldAlert, Ban, DollarSign, GitBranch, UserCheck } from "lucide-react";

interface BlockedReasonPanelProps {
	blockedBy?: string;
	reason?: string;
}

const BLOCKED_CONFIG: Record<string, { icon: typeof AlertTriangle; label: string; hint: string }> = {
	approval_revoked: { icon: Ban, label: "Approval Revoked", hint: "Re-approve the task to continue." },
	approval_required: { icon: UserCheck, label: "Approval Required", hint: "This phase needs fresh approval before it can run." },
	dirty_integration_queue: { icon: GitBranch, label: "Dirty Integration Queue", hint: "Resolve pending integration queue entries before continuing." },
	budget_exceeded: { icon: DollarSign, label: "Budget Exceeded", hint: "Increase the budget limit or reduce task scope." },
	policy_changed: { icon: ShieldAlert, label: "Policy Changed", hint: "The active policy has changed since the task was created. Review and re-approve." },
	no_policy: { icon: ShieldAlert, label: "No Policy", hint: "No policy snapshot found. Re-create the task." },
};

export function BlockedReasonPanel({ blockedBy, reason }: BlockedReasonPanelProps) {
	if (!blockedBy && !reason) return null;

	const cfg = blockedBy ? BLOCKED_CONFIG[blockedBy] : null;
	const Icon = cfg?.icon ?? AlertTriangle;

	return (
		<div className="flex items-start gap-3 px-3 py-2.5 rounded border border-amber-700 bg-amber-900/20">
			<Icon size={16} className="text-amber-400 shrink-0 mt-0.5" />
			<div className="min-w-0 text-xs">
				<p className="text-amber-300 font-medium">{cfg?.label ?? "Blocked"}</p>
				{reason && <p className="text-amber-400/80 mt-0.5">{reason}</p>}
				{cfg && <p className="text-amber-500 mt-1 italic">{cfg.hint}</p>}
			</div>
		</div>
	);
}
