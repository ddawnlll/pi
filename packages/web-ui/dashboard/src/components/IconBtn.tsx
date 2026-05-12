interface IconBtnProps {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  variant?: "ghost" | "outline" | "accent";
  danger?: boolean;
  size?: "sm" | "md";
}

export function IconBtn({
  icon: Icon,
  label,
  onClick,
  variant = "ghost",
  danger = false,
  size = "md",
}: IconBtnProps) {
  const base = "inline-flex items-center justify-center rounded-lg transition-all duration-150 font-medium";
  const pad = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const styles: Record<string, string> = {
    ghost:   "text-stone-500 hover:bg-stone-100 hover:text-stone-800",
    outline: "border border-[#E8E6E1] text-stone-600 hover:bg-stone-50 hover:border-stone-300",
    accent:  "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
  };
  const dangerStyle = danger ? "text-stone-500 hover:bg-red-50 hover:text-red-600" : "";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${base} ${pad} ${danger ? dangerStyle : styles[variant]}`}
    >
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
}

export function LabeledBtn({
  icon: Icon,
  label,
  onClick,
  accent = false,
  danger = false,
}: LabeledBtnProps) {
  let cls = "inline-flex items-center gap-2 px-3 h-8 rounded-lg text-xs font-medium transition-all duration-150 border ";
  if (accent) cls += "bg-blue-600 text-white border-transparent hover:bg-blue-700 shadow-sm";
  else if (danger) cls += "text-stone-500 border-[#E8E6E1] hover:bg-red-50 hover:text-red-600 hover:border-red-200";
  else cls += "text-stone-600 border-[#E8E6E1] hover:bg-stone-50 hover:border-stone-300";
  return (
    <button onClick={onClick} className={cls}>
      <Icon size={13} strokeWidth={1.8} />
      {label}
    </button>
  );
}
