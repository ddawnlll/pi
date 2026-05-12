import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "";

const STORAGE_KEY = "pi-dashboard-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  // Check system preference
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const onChange = (theme: Theme) => {
      const root = document.documentElement;
      if (theme === "dark") {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    // Listen for custom event from settings
    const handler = (e: CustomEvent<Theme>) => {
      const t = e.detail;
      setThemeState(t);
      localStorage.setItem(STORAGE_KEY, t);
      onChange(t);
    };

    window.addEventListener("pi-theme-change" as any, handler as any);
    onChange(theme);

    return () => {
      window.removeEventListener("pi-theme-change" as any, handler as any);
    };
  }, [theme]);

  const setTheme = (t: Theme) => {
    window.dispatchEvent(new CustomEvent("pi-theme-change", { detail: t }));
  };

  return { theme, setTheme };
}
