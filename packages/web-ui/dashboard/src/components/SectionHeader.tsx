export function SectionHeader({ title }: { title: string }) {
  return (
    <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-stone-400 select-none">
      {title}
    </p>
  );
}

export function Divider() {
  return <div className="h-px bg-[#E8E6E1] mx-0" />;
}
