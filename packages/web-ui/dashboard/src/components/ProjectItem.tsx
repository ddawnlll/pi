import { Folder, FolderOpen, ChevronRight } from "lucide-react";

interface ProjectItemProps {
  name: string;
  active: boolean;
  onClick: () => void;
}

export function ProjectItem({ name, active, onClick }: ProjectItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs transition-all duration-150 text-left ${
        active
          ? "bg-[#EBF2FF] text-blue-700 font-medium"
          : "text-stone-600 hover:bg-stone-100 hover:text-stone-800"
      }`}
    >
      {active ? <FolderOpen size={14} strokeWidth={1.8} /> : <Folder size={14} strokeWidth={1.8} />}
      <span className="truncate">{name}</span>
      {active && <ChevronRight size={11} className="ml-auto opacity-50" />}
    </button>
  );
}
