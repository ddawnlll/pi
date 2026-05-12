import { CircleDot, Pause, CheckCircle2, AlertCircle, Square, Ban, Clock } from "lucide-react";

function getStatusMeta(status: string): { color: string; bg: string; darkColor: string; darkBg: string; Icon: React.ElementType; pulse?: boolean } {
  switch (status) {
    case "running":  return { color: "text-emerald-700", bg: "bg-emerald-50", darkColor: "dark:text-emerald-300", darkBg: "dark:bg-emerald-950/60", Icon: CircleDot, pulse: true };
    case "paused":   return { color: "text-amber-700",   bg: "bg-amber-50",   darkColor: "dark:text-amber-300",   darkBg: "dark:bg-amber-950/60",   Icon: Pause, pulse: false };
    case "complete": return { color: "text-blue-700",    bg: "bg-blue-50",    darkColor: "dark:text-blue-300",    darkBg: "dark:bg-blue-950/60",    Icon: CheckCircle2, pulse: false };
    case "failed":   return { color: "text-red-700",     bg: "bg-red-50",     darkColor: "dark:text-red-300",     darkBg: "dark:bg-red-950/60",     Icon: AlertCircle, pulse: false };
    case "stopped":  return { color: "text-orange-700",  bg: "bg-orange-50",  darkColor: "dark:text-orange-300",  darkBg: "dark:bg-orange-950/60",  Icon: Square, pulse: false };
    case "cancelled":return { color: "text-stone-500",   bg: "bg-stone-100",  darkColor: "dark:text-stone-400",   darkBg: "dark:bg-stone-900/60",   Icon: Ban, pulse: false };
    default:         return { color: "text-stone-400",   bg: "bg-stone-100",  darkColor: "dark:text-stone-500",   darkBg: "dark:bg-stone-900/60",   Icon: Clock, pulse: false };
  }
}

export function StatusBadge({ status }: { status: string }) {
  const { color, bg, darkColor, darkBg, Icon, pulse } = getStatusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium tracking-wide ${color} ${bg} ${darkColor} ${darkBg}`}>
      <span className={pulse ? "relative flex h-1.5 w-1.5" : ""}>
        {pulse && (
          <>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color.replace("text-", "bg-")} opacity-50`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${color.replace("text-", "bg-")} dark:bg-emerald-400`} />
          </>
        )}
        {!pulse && <Icon size={11} />}
      </span>
      {status}
    </span>
  );
}
