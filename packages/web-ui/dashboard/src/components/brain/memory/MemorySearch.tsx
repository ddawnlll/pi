import React from "react";
import { SearchInput } from "../common/SearchInput";

interface MemorySearchProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}

export function MemorySearch(props: MemorySearchProps) {
	return <SearchInput {...props} debounceMs={300} />;
}
