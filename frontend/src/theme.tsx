import { Check, Moon, Palette, Sun } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ThemeMode = 'light' | 'dark';
export type ThemeStyle = 'minimal' | 'playful';

interface ThemeCtxValue {
  mode: ThemeMode;
  style: ThemeStyle;
  toggleMode: () => void;
  setStyle: (s: ThemeStyle) => void;
}

const ThemeCtx = createContext<ThemeCtxValue>(null as never);

const MODE_META: Record<ThemeMode, string> = { light: '#f6f7f9', dark: '#111418' };

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    localStorage.getItem('anon-theme') === 'dark' ? 'dark' : 'light',
  );
  const [style, setStyleState] = useState<ThemeStyle>(() =>
    localStorage.getItem('anon-style') === 'playful' ? 'playful' : 'minimal',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('anon-theme', mode);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', MODE_META[mode]);
  }, [mode]);

  useEffect(() => {
    document.documentElement.dataset.style = style;
    localStorage.setItem('anon-style', style);
  }, [style]);

  return (
    <ThemeCtx.Provider
      value={{
        mode,
        style,
        toggleMode: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
        setStyle: setStyleState,
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}

export function ModeToggle() {
  const { mode, toggleMode } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggleMode} aria-label="切换日夜模式">
      {mode === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

export function StylePicker() {
  const { style, setStyle } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="切换界面风格">
          <Palette className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(
          [
            { key: 'minimal', label: '简洁' },
            { key: 'playful', label: '明快' },
          ] as const
        ).map((s) => (
          <DropdownMenuItem key={s.key} onClick={() => setStyle(s.key)}>
            <span className="flex-1">{s.label}</span>
            {style === s.key && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
