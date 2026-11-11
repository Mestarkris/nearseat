// Light (beige and white) or dark. The choice is kept on this device; the
// small script in index.html applies it before the first paint.
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const BAR = { light: "#f3ead8", dark: "#140d10" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
    try { localStorage.setItem("nearseat-theme", theme); } catch { /* private window: the choice lasts for this visit */ }
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-card text-fg transition-colors hover:border-lime hover:text-lime">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {theme === "dark"
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
          : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />}
      </svg>
    </button>
  );
}
