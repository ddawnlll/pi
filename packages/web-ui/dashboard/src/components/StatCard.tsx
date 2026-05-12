interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
}

export function StatCard({ icon: Icon, label, value, accent = false }: StatCardProps) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-[#E8E6E1] bg-white">
      <div className={`flex items-center gap-1.5 ${accent ? "text-blue-600" : "text-stone-400"}`}>
        <Icon size={13} strokeWidth={1.8} />
        <span className="text-[10px] font-semibold tracking-widest uppercase">{label}</span>
      </div>
      <p className="text-xl font-semibold text-stone-800 tracking-tight leading-none">{value}</p>
    </div>
  );
}
