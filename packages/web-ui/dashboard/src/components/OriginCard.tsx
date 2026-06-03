/**
 * OriginCard — shows how a task was created and its provenance.
 */

import React from "react";
import { FileUp, Lightbulb, Bot, Moon, Terminal } from "lucide-react";
import type { TaskOrigin } from "../types";

interface OriginCardProps {
	origin: TaskOrigin;
}

const ORIGIN_CONFIG: Record<
	TaskOrigin["type"],
	{ icon: typeof FileUp; label: string; color: string }
> = {
	user_upload: { icon: FileUp, label: "User Upload", color: "text-blue-400" },
	proposal_accepted: { icon: Lightbulb, label: "Proposal Accepted", color: "text-purple-400" },
	plan_factory: { icon: Bot, label: "Plan Factory", color: "text-emerald-400" },
	overnight_bundle: { icon: Moon, label: "Overnight Bundle", color: "text-indigo-400" },
	manual: { icon: Terminal, label: "Manual", color: "text-stone-500 dark:text-stone-400" },
};

export function OriginCard({ origin }: OriginCardProps) {
	const cfg = ORIGIN_CONFIG[origin.type];
	const Icon = cfg.icon;

	return (
		<div className="flex items-start gap-3 px-3 py-2 rounded border border-[#E8E6E1] dark:border-[#333] bg-[#F7F6F3] dark:bg-[#161616]/50">
			<Icon size={16} className={`${cfg.color} shrink-0 mt-0.5`} />
			<div className="min-w-0 text-xs">
				<p className="text-stone-700 dark:text-stone-300 font-medium">{cfg.label}</p>
				{origin.sourcePlanFiles && origin.sourcePlanFiles.length > 0 && (
					<p className="text-stone-400 dark:text-stone-500 mt-0.5">
						Files: {origin.sourcePlanFiles.join(", ")}
					</p>
				)}
				{origin.proposalId && (
					<p className="text-stone-400 dark:text-stone-500">Proposal: {origin.proposalId}</p>
				)}
				{origin.decisionId && (
					<p className="text-stone-400 dark:text-stone-500">Decision: {origin.decisionId}</p>
				)}
				{origin.goalIds && origin.goalIds.length > 0 && (
					<p className="text-stone-400 dark:text-stone-500">Goals: {origin.goalIds.join(", ")}</p>
				)}
			</div>
		</div>
	);
}
