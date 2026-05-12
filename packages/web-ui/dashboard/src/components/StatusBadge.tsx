import { CircleDot, Pause, CheckCircle2, AlertCircle, Square, Ban, Clock } from "lucide-react";

function getStatusMeta(status: string): { color: string; bg: string; Icon: React.ElementType; pulse?: boolean } {
  switch (status) {
    case "running":  return { color: "text-emerald-700", bg: "bg-emerald-50", Icon: CircleDot, pulse: true };
    case "paused":   return { color: "text-amber-700",   bg: "bg-amber-50",   Icon: Pause };
    case "complete": return { color: "text-blue-700",    bg: "bg-blue-50",    Icon: CheckCircle2 };
    case "failed":   return { color: "text-red-700",     bg: "bg-red-50",     Icon: AlertCircle };
    case "stopped":  return { color: "text-orange-700",  bg: "bg-orange-50",  Icon: Square };
    case "cancelled":return { color: "text-stone-500",   bg: "bg-stone-100",  Icon: Ban };
    default:         return { color: "text-stone-400",   bg: "bg-stone-100",  Icon: Clock };
  }
}

export function StatusBadge({ status }: { status: string }) {
  const { color, bg, Icon, pulse } = getStatusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium tracking-wide ${color} ${bg}`}>
      <span className={pulse ? "relative flex h-1.5 w-1.5" : ""}>
        {pulse && (
          <>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color.replace("text-", "bg-")} opacity-50`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${color.replace("text-", "bg-")}`} />
          </>
        )}
        {!pulse && <Icon size={11} />}
      </span>
      {status}
    </span>
  );
}
