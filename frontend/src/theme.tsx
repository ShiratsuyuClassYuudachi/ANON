import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ThemeCtx = createContext<{ theme: string; toggle: () => void }>(null as never);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() => localStorage.getItem('anon-theme') ?? 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('anon-theme', theme);
    document
      .querySelector('meta[name=theme-color]')
      ?.setAttribute('content', theme === 'dark' ? '#111418' : '#ffffff');
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeCtx);
  return (
    <button className="theme-toggle" onClick={toggle} aria-label="切换主题">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
