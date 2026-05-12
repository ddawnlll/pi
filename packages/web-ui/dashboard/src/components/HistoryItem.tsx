import { CircleDot, Pause, CheckCircle2, AlertCircle, Square, Ban, Clock } from "lucide-react";
import type { PlanExecution } from "../types";

function getMeta(status: string): { color: string; darkColor: string; Icon: React.ElementType } {
  switch (status) {
    case "running":  return { color: "text-emerald-600", darkColor: "dark:text-emerald-400", Icon: CircleDot };
    case "paused":   return { color: "text-amber-600",   darkColor: "dark:text-amber-400",   Icon: Pause };
    case "complete": return { color: "text-blue-600",    darkColor: "dark:text-blue-400",    Icon: CheckCircle2 };
    case "failed":   return { color: "text-red-600",     darkColor: "dark:text-red-400",     Icon: AlertCircle };
    case "stopped":  return { color: "text-orange-600",  darkColor: "dark:text-orange-400",  Icon: Square };
    case "cancelled":return { color: "text-stone-500",   darkColor: "dark:text-stone-400",   Icon: Ban };
    default:         return { color: "text-stone-400",   darkColor: "dark:text-stone-500",   Icon: Clock };
  }
}

interface HistoryItemProps {
  exec: PlanExecution;
  active: boolean;
  onClick: () => void;
}

export function HistoryItem({ exec, active, onClick }: HistoryItemProps) {
  const { color, darkColor, Icon } = getMeta(exec.status);
  const date = new Date(exec.startedAt ?? Date.now());
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs transition-all duration-150 text-left group ${
        active ? "bg-[#EBF2FF] dark:bg-[#1A2A44]" : "hover:bg-stone-50 dark:hover:bg-[#2A2A2A]"
      }`}>
      <Icon size={13} strokeWidth={1.8} className={`${color} ${darkColor} shrink-0`} />
      <span className={`truncate flex-1 ${active ? "text-blue-700 dark:text-blue-300 font-medium" : "text-stone-600 dark:text-stone-400"}`}>
        {exec.title ?? `Run ${exec.id.slice(0, 6)}`}
      </span>
      <span className="text-[10px] text-stone-400 dark:text-stone-500 shrink-0">{timeStr}</span>
    </button>
  );
}
