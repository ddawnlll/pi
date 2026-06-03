interface CommandsTabProps {
	lines: string[];
}

export function CommandsTab({ lines }: CommandsTabProps) {
	const cmdLines = lines.filter((l) =>
		l.startsWith("$ ") || l.includes("tool_call") || l.includes("tool_use") ||
		l.includes("<function=") || l.includes("function_call"),
	);

	if (cmdLines.length === 0) {
		return <div className="flex items-center justify-center h-32 text-stone-400 dark:text-stone-500 text-xs pt-3">No commands detected yet</div>;
	}

	return (
		<div className="bg-stone-50 dark:bg-[#161616] rounded border border-[#E8E6E1] dark:border-[#333] p-2 overflow-y-auto font-mono text-xs text-stone-800 dark:text-stone-200 mt-3"
			style={{ maxHeight: "60vh", minHeight: "120px" }}>
			{cmdLines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)}
		</div>
	);
}
