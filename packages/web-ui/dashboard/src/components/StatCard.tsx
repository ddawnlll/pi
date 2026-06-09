interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
  /** Optional sublabel explaining the formula or source of the value. */
  sublabel?: string;
}

export function StatCard({ icon: Icon, label, value, accent = false, sublabel }: StatCardProps) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-[#E8E6E1] dark:border-[#333] bg-white dark:bg-[#1E1E1E] card-hover transition-smooth">
      <div className={`flex items-center gap-1.5 ${accent ? "text-blue-700 dark:text-blue-300" : "text-stone-400 dark:text-stone-500"}`}>
        <Icon size={13} strokeWidth={1.8} className="icon-rotate-hover" />
        <span className="text-xs font-semibold tracking-widest uppercase">{label}</span>
      </div>
      <p className="text-xl font-semibold text-stone-800 dark:text-stone-200 tracking-tight leading-none">{value}</p>
      {sublabel && <p className="text-xs text-stone-400 dark:text-stone-500 leading-none">{sublabel}</p>}
    </div>
  );
}
