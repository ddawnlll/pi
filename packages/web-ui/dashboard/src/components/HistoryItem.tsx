import { CircleDot, Pause, CheckCircle2, AlertCircle, Square, Ban, Clock } from "lucide-react";
import type { PlanExecution } from "../types";

function getMeta(status: string): { color: string; Icon: React.ElementType } {
  switch (status) {
    case "running":  return { color: "text-emerald-600", Icon: CircleDot };
    case "paused":   return { color: "text-amber-600",   Icon: Pause };
    case "complete": return { color: "text-blue-600",    Icon: CheckCircle2 };
    case "failed":   return { color: "text-red-600",     Icon: AlertCircle };
    case "stopped":  return { color: "text-orange-600",  Icon: Square };
    case "cancelled":return { color: "text-stone-500",   Icon: Ban };
    default:         return { color: "text-stone-400",   Icon: Clock };
  }
}

interface HistoryItemProps {
  exec: PlanExecution;
  active: boolean;
  onClick: () => void;
}

export function HistoryItem({ exec, active, onClick }: HistoryItemProps) {
  const { color, Icon } = getMeta(exec.status);
  const date = new Date(exec.startedAt ?? Date.now());
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs transition-all duration-150 text-left group ${
        active ? "bg-[#EBF2FF]" : "hover:bg-stone-50"
      }`}
    >
      <Icon size={13} strokeWidth={1.8} className={`${color} shrink-0`} />
      <span className={`truncate flex-1 ${active ? "text-blue-700 font-medium" : "text-stone-600"}`}>
        {exec.title ?? `Run ${exec.id.slice(0, 6)}`}
      </span>
      <span className="text-[10px] text-stone-400 shrink-0">{timeStr}</span>
    </button>
  );
}
