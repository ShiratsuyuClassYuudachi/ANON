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
export type ThemeStyle = 'minimal' | 'playful' | 'anon-tokyo';

interface ThemeCtxValue {
  mode: ThemeMode;
  style: ThemeStyle;
  toggleMode: () => void;
  setStyle: (s: ThemeStyle) => void;
}

const ThemeCtx = createContext<ThemeCtxValue>(null as never);

export const THEME_STYLES = [
  { key: 'minimal', label: '简洁', swatches: ['#2563eb'] },
  { key: 'playful', label: '明快', swatches: ['#7c3aed'] },
  { key: 'anon-tokyo', label: 'anon tokyo', swatches: ['#ff8899', '#73d9be'] },
] as const;

const MODE_META: Record<ThemeStyle, Record<ThemeMode, string>> = {
  minimal: { light: '#f6f7f9', dark: '#111418' },
  playful: { light: '#faf7ff', dark: '#16121f' },
  'anon-tokyo': { light: '#fdfbfa', dark: '#141216' },
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() =>
    localStorage.getItem('anon-theme') === 'dark' ? 'dark' : 'light',
  );
  const [style, setStyleState] = useState<ThemeStyle>(() =>
    THEME_STYLES.find(({ key }) => key === localStorage.getItem('anon-style'))?.key ?? 'minimal',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    localStorage.setItem('anon-theme', mode);
    document.documentElement.dataset.style = style;
    localStorage.setItem('anon-style', style);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', MODE_META[style][mode]);
  }, [mode, style]);

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
    <Button variant="ghost" size="icon" onClick={toggleMode} aria-label={mode === 'dark' ? '切换到日间模式' : '切换到夜间模式'}>
      {mode === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}

export function StyleSwatch({ swatches }: { swatches: readonly string[] }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-1">
      {swatches.map((color) => (
        <span
          key={color}
          className="style-swatch size-2.5 rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.14)]"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
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
        {THEME_STYLES.map((s) => (
          <DropdownMenuItem key={s.key} onClick={() => setStyle(s.key)}>
            <StyleSwatch swatches={s.swatches} />
            <span className="flex-1">{s.label}</span>
            {style === s.key && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
