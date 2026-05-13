interface IconBtnProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  variant?: "ghost" | "outline" | "accent";
  danger?: boolean;
  size?: "sm" | "md";
}

export function IconBtn({ icon: Icon, label, onClick, variant = "ghost", danger = false, size = "md" }: IconBtnProps) {
  const pad = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const styles: Record<string, string> = {
    ghost:   "text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-800 dark:hover:text-stone-200",
    outline: "border border-[#E8E6E1] dark:border-[#333] text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-[#2A2A2A] hover:border-stone-300 dark:hover:border-[#555]",
    accent:  "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
  };
  const dangerStyle = danger ? "text-stone-500 dark:text-stone-400 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400" : "";
  return (
    <button onClick={onClick} aria-label={label} title={label}
      className={`inline-flex items-center justify-center rounded-lg transition-all duration-150 font-medium ${pad} ${danger ? dangerStyle : styles[variant]}`}>
      <Icon size={15} strokeWidth={1.8} />
    </button>
  );
}

interface LabeledBtnProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  accent?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function LabeledBtn({ icon: Icon, label, onClick, accent = false, danger = false, disabled = false }: LabeledBtnProps) {
  let cls = "inline-flex items-center gap-2 px-3 h-8 rounded-lg text-xs font-medium transition-all duration-150 border ";
  if (disabled) {
    cls += "text-stone-300 dark:text-stone-600 border-[#E8E6E1]/50 dark:border-[#333]/50 cursor-not-allowed bg-stone-50 dark:bg-[#1A1A1A]";
  } else if (accent) cls += "bg-blue-600 text-white border-transparent hover:bg-blue-700 shadow-sm";
  else if (danger) cls += "text-stone-500 dark:text-stone-400 border-[#E8E6E1] dark:border-[#333] hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400 hover:border-red-200 dark:hover:border-red-800";
  else cls += "text-stone-600 dark:text-stone-400 border-[#E8E6E1] dark:border-[#333] hover:bg-stone-50 dark:hover:bg-[#2A2A2A] hover:border-stone-300 dark:hover:border-[#555]";
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className={cls}>
      <Icon size={13} strokeWidth={1.8} /> {label}
    </button>
  );
}
