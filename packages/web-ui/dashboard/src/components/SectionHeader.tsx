export function SectionHeader({ title }: { title: string }) {
  return (
    <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-stone-400 dark:text-stone-500 select-none">
      {title}
    </p>
  );
}

export function Divider() {
  return <div className="h-px bg-[#E8E6E1] dark:bg-[#333] mx-0" />;
}
