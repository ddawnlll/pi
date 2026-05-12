import { Folder, FolderOpen, ChevronRight } from "lucide-react";

interface ProjectItemProps {
  name: string;
  active: boolean;
  onClick: () => void;
}

export function ProjectItem({ name, active, onClick }: ProjectItemProps) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs transition-all duration-150 text-left ${
        active
          ? "bg-[#EBF2FF] dark:bg-[#1A2A44] text-blue-700 dark:text-blue-300 font-medium"
          : "text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-[#2A2A2A] hover:text-stone-800 dark:hover:text-stone-200"
      }`}>
      {active ? <FolderOpen size={14} strokeWidth={1.8} /> : <Folder size={14} strokeWidth={1.8} />}
      <span className="truncate">{name}</span>
      {active && <ChevronRight size={11} className="ml-auto opacity-50" />}
    </button>
  );
}
