import { AlertCircle, Activity } from "lucide-react";

export function EventLine({ event }: { event: any }) {
  const isErr = event.type === "error" || event.level === "error";
  return (
    <div className={`px-4 py-2.5 border-b border-[#E8E6E1] last:border-0 ${isErr ? "bg-red-50/60" : ""}`}>
      <div className="flex items-start gap-2">
        {isErr
          ? <AlertCircle size={11} className="text-red-500 mt-0.5 shrink-0" strokeWidth={2} />
          : <Activity size={11} className="text-stone-300 mt-0.5 shrink-0" strokeWidth={2} />}
        <p className={`text-[11px] leading-snug flex-1 ${isErr ? "text-red-700" : "text-stone-600"}`}>
          {event.message ?? event.msg ?? JSON.stringify(event)}
        </p>
      </div>
      {event.timestamp && (
        <p className="text-[9px] text-stone-400 mt-1 pl-4 tracking-wide">
          {new Date(event.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
