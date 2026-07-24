# ANON 前端 UI 焕新实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Tailwind CSS v4 + shadcn/ui 组件体系重写 ANON 全部前端页面，提供「简洁/明快」双风格主题（各自支持日/夜模式），业务逻辑零改动。

**Architecture:** 设计文档见 `docs/superpowers/specs/2026-07-24-ui-refresh-design.md`。Tailwind v4（CSS-first 配置）+ shadcn/ui 模式（组件源码落 `frontend/src/components/ui/`，Radix 原语）；主题经 `<html>` 上 `.dark` 类 + `data-style` 属性切换 4 组 CSS 变量；逐页重写渲染层，状态/处理器/API 调用逐字保留。

**Tech Stack:** React 18.3、react-router-dom v6、Vite 5、TypeScript strict、Tailwind CSS v4（`@tailwindcss/vite`）、shadcn/ui（Radix UI）、lucide-react、sonner。

## Global Constraints

- 仓库根目录 `/home/yuu/projects/anon`，所有前端命令在 `frontend/` 下执行。
- **不改后端、不改 API 契约**：所有 `api()` 调用路径/方法/body/FormData 字段名逐字保留；下载继续用 `downloadFile(id, filename)` / `downloadUrl(url, filename)`；鉴权图片继续用 `AuthImg`（其内部逻辑不动，仅允许调整容器样式）。
- 不改路由（`App.tsx` 的 Routes 结构不变）；不改 `auth.tsx`、`crypto.ts`、`types.ts`、`api/client.ts`。
- 金额：显示用元 `（(cents/100).toFixed(2)）`，接口字段 `*Cents` 不动；负数着色用 `text-destructive`。
- 暗色模式只用 `.dark` 类（`@custom-variant`），不得引入 `next-themes`；图标只用 lucide-react。
- localStorage 键：`anon-theme`（light/dark，已有，直接兼容）、`anon-style`（minimal/playful，缺省 minimal）。
- 移动端优先：所有页面在 <768px 单列可用；弹层在移动端用底部 Sheet（经 `FormOverlay`），桌面端用 Dialog。
- `RolesTab` 的 `PERMISSIONS` 清单（10 项）必须与现文件完全一致。
- 删除类操作原用 `window.confirm`，统一改为 `AlertDialog`；错误/成功提示原用 `err/msg` 状态文案或 `alert`，统一改为 `toast`（sonner）。表单内联错误保留时须与 toast 并存说明。
- 中间任务期间旧 CSS 类失效、页面暂时「裸奔」属预期；每个任务的验收是 `npm run build`（含 `tsc --noEmit`）通过 + 该任务页面自检，最终由 Task 14 全量核对。
- 每个 Task 结束按步骤提交 git（若会话规则要求逐次确认，先问用户再提交）。

---

### Task 1: Tailwind v4 基础设施与双主题变量

**Files:**
- Modify: `frontend/package.json`（经 npm install）
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/tsconfig.json`
- Rewrite: `frontend/src/index.css`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `<html>` 上 `.dark` 类与 `data-style="minimal|playful"` 属性；CSS 变量全集（`--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --radius`）；Tailwind 语义工具类（`bg-background`、`text-muted-foreground`、`bg-card`、`border-border` 等）；`@` 路径别名指向 `frontend/src`。

- [ ] **Step 1: 安装 Tailwind v4**

```bash
cd frontend && npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: 配置 Vite（插件 + 别名）**

`frontend/vite.config.ts` 全量替换为：

```ts
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
```

- [ ] **Step 3: 配置 tsconfig 别名**

`frontend/tsconfig.json` 的 `compilerOptions` 内追加两项（其余不动）：

```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 4: 重写 index.css 为主题变量体系**

`frontend/src/index.css` 全量替换为（旧手写类全部删除）：

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #f6f7f9;
  --foreground: #1c1e21;
  --card: #ffffff;
  --card-foreground: #1c1e21;
  --popover: #ffffff;
  --popover-foreground: #1c1e21;
  --primary: #2563eb;
  --primary-foreground: #ffffff;
  --secondary: #eef1f5;
  --secondary-foreground: #1c1e21;
  --muted: #eef1f5;
  --muted-foreground: #6b7280;
  --accent: #e8eefc;
  --accent-foreground: #1d4ed8;
  --destructive: #dc2626;
  --destructive-foreground: #ffffff;
  --border: #e5e7eb;
  --input: #d1d5db;
  --ring: #2563eb;
  --radius: 0.5rem;
}

.dark {
  --background: #111418;
  --foreground: #e5e7eb;
  --card: #1b1f26;
  --card-foreground: #e5e7eb;
  --popover: #1b1f26;
  --popover-foreground: #e5e7eb;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --secondary: #262c36;
  --secondary-foreground: #e5e7eb;
  --muted: #262c36;
  --muted-foreground: #9ca3af;
  --accent: #1e3a5f;
  --accent-foreground: #93c5fd;
  --destructive: #f87171;
  --destructive-foreground: #111418;
  --border: #2d333d;
  --input: #374151;
  --ring: #3b82f6;
}

:root[data-style='playful'] {
  --background: #faf7ff;
  --foreground: #241b33;
  --card: #ffffff;
  --card-foreground: #241b33;
  --popover: #ffffff;
  --popover-foreground: #241b33;
  --primary: #7c3aed;
  --primary-foreground: #ffffff;
  --secondary: #f3e8ff;
  --secondary-foreground: #5b21b6;
  --muted: #f3effa;
  --muted-foreground: #7a6f8c;
  --accent: #fce7f3;
  --accent-foreground: #be185d;
  --destructive: #e11d48;
  --destructive-foreground: #ffffff;
  --border: #e9e2f5;
  --input: #d9cfec;
  --ring: #7c3aed;
  --radius: 1rem;
}

.dark[data-style='playful'] {
  --background: #16121f;
  --foreground: #e9e4f5;
  --card: #1f1930;
  --card-foreground: #e9e4f5;
  --popover: #1f1930;
  --popover-foreground: #e9e4f5;
  --primary: #a78bfa;
  --primary-foreground: #1e1033;
  --secondary: #2b2242;
  --secondary-foreground: #d8ccff;
  --muted: #2b2440;
  --muted-foreground: #a89ec2;
  --accent: #3d2350;
  --accent-foreground: #f0abfc;
  --destructive: #fb7185;
  --destructive-foreground: #16121f;
  --border: #322a4a;
  --input: #453a66;
  --ring: #a78bfa;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
}
```

- [ ] **Step 5: 更新 index.html 防闪烁脚本**

`frontend/index.html` 中现有内联 `<script>`（读取 `anon-theme` 的那段）替换为：

```html
<script>
  try {
    var mode = localStorage.getItem('anon-theme') || 'light';
    var style = localStorage.getItem('anon-style') || 'minimal';
    var el = document.documentElement;
    if (mode === 'dark') el.classList.add('dark');
    el.dataset.style = style;
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.content = mode === 'dark' ? '#111418' : '#f6f7f9';
  } catch (e) {}
</script>
```

同时把 `<meta name="theme-color" content="#ffffff" />` 的初值改为 `#f6f7f9`。

- [ ] **Step 6: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功（页面样式暂时回退为无样式，属预期）

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig.json frontend/src/index.css frontend/index.html
git commit -m "feat(frontend): Tailwind v4 基础设施与双风格主题变量"
```

---

### Task 2: shadcn/ui 初始化与组件安装

**Files:**
- Create: `frontend/components.json`（CLI 生成）
- Create: `frontend/src/lib/utils.ts`（CLI 生成，`cn()`）
- Create: `frontend/src/components/ui/*.tsx`（CLI 生成，约 20 个组件）

**Interfaces:**
- Consumes: Task 1 的别名与变量体系
- Produces: `cn(...)` 工具；ui 组件全集：`Button Input Textarea Label Checkbox RadioGroup Select Switch Badge Card(含 Header/Title/Description/Content/Footer) Separator Skeleton Avatar Tooltip Dialog AlertDialog DropdownMenu Popover Sheet Tabs(含 TabsList/TabsTrigger)`（均为 shadcn 标准导出签名）；`sonner` 包的 `toast` 函数。

- [ ] **Step 1: 初始化 shadcn**

```bash
cd frontend && npx shadcn@latest init -y -d --base-color neutral --css-variables
```

预期生成 `components.json` 与 `src/lib/utils.ts`，并安装 `class-variance-authority clsx tailwind-merge` 与 Radix 依赖。若 CLI 检测主题失败提示覆盖 `index.css`，选择保留现有（变量已就绪）；若 init 交互卡住，回退方案：手工创建 `components.json`：

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

再重跑上述 init 命令。

- [ ] **Step 2: 安装全部所需组件**

```bash
cd frontend && npx shadcn@latest add -y -o button input textarea label checkbox radio-group select switch badge card separator skeleton avatar tooltip dialog alert-dialog dropdown-menu popover sheet tabs
```

- [ ] **Step 3: 安装图标与 toast**

```bash
cd frontend && npm install lucide-react sonner
```

注意：**不要** `shadcn add sonner`（其模板依赖 next-themes）。直接用 `sonner` 包的 `toast` 与 `Toaster`。

- [ ] **Step 4: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功；`src/components/ui/` 下存在 20 个组件文件

- [ ] **Step 5: Commit**

```bash
git add frontend/components.json frontend/src/lib frontend/src/components/ui frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): 引入 shadcn/ui 组件库与 lucide/sonner"
```

---

### Task 3: 主题运行时与共享组件

**Files:**
- Rewrite: `frontend/src/theme.tsx`
- Create: `frontend/src/hooks/useMediaQuery.ts`
- Create: `frontend/src/components/FormOverlay.tsx`
- Create: `frontend/src/components/Toaster.tsx`

**Interfaces:**
- Consumes: Task 2 的 `Button`、`DropdownMenu`、`Dialog`、`Sheet`；Task 1 的 `.dark`/`data-style` 机制
- Produces（后续任务依赖这些确切导出）:
  - `theme.tsx`: `ThemeProvider({children})`、`useTheme(): { mode: 'light'|'dark'; style: 'minimal'|'playful'; toggleMode(): void; setStyle(s: 'minimal'|'playful'): void }`、`ModeToggle()`（图标按钮）、`StylePicker()`（下拉切换两套风格）
  - `useMediaQuery(query: string): boolean`
  - `FormOverlay({ open, onOpenChange, title, description?, children })`：移动端渲染底部 `Sheet`，桌面端渲染 `Dialog`；表单页弹层统一入口
  - `Toaster()`：绑定当前明暗模式的 sonner Toaster

- [ ] **Step 1: 重写 theme.tsx**

`frontend/src/theme.tsx` 全量替换为：

```tsx
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
```

注意：`theme.tsx` 旧导出 `ThemeToggle` 被 `Login/Register/InviteAccept` 引用，后续任务会改为 `ModeToggle`；本任务构建报错属预期，在 Step 4 一并处理。

- [ ] **Step 2: useMediaQuery hook**

创建 `frontend/src/hooks/useMediaQuery.ts`：

```ts
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

- [ ] **Step 3: FormOverlay（移动端 Sheet / 桌面端 Dialog）**

创建 `frontend/src/components/FormOverlay.tsx`：

```tsx
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}

/** 移动端渲染底部 Sheet，桌面端渲染居中 Dialog。用于各「新建/编辑」表单弹层。 */
export function FormOverlay({ open, onOpenChange, title, description, children }: Props) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <div className="px-4 pb-6">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Toaster 组件 + 修正旧 ThemeToggle 引用**

创建 `frontend/src/components/Toaster.tsx`：

```tsx
import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/theme';

export function Toaster() {
  const { mode } = useTheme();
  return <SonnerToaster theme={mode} position="top-center" richColors closeButton />;
}
```

在 `Login.tsx`、`Register.tsx`、`InviteAccept.tsx` 中把 `import { ThemeToggle } from '../theme'` 与 `<ThemeToggle />` 暂改为 `ModeToggle`（完整重写见 Task 5，此处仅保证编译通过；三个文件的改法相同：导入 `ModeToggle`，用 `<div className="fixed right-3 top-3 z-50"><ModeToggle /></div>` 包裹替换原 `<ThemeToggle />`）。

- [ ] **Step 5: 验证构建**

Run: `cd frontend && npm run build`
Expected: 构建成功

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theme.tsx frontend/src/hooks frontend/src/components/FormOverlay.tsx frontend/src/components/Toaster.tsx frontend/src/pages
git commit -m "feat(frontend): 双主题运行时、FormOverlay 与 Toaster"
```

---

### Task 4: 全局布局与头部

**Files:**
- Rewrite: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/main.tsx`（挂载 Toaster）
- Modify: `frontend/src/App.tsx`（加载态换骨架屏）

**Interfaces:**
- Consumes: Task 3 的 `ModeToggle`、`StylePicker`、`Toaster`；`useAuth()`（`user`、`logout`）
- Produces: 所有受保护页面共用的头部；`<main>` 容器类 `mx-auto w-full max-w-3xl px-4 py-4 md:max-w-5xl`（页面自行追加底部留白）

- [ ] **Step 1: 重写 Layout.tsx**

`frontend/src/components/Layout.tsx` 全量替换为：

```tsx
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ModeToggle, StylePicker } from '../theme';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-4 md:max-w-5xl">
          <Link to="/projects" className="text-lg font-bold tracking-wide text-primary">
            ANON
          </Link>
          <span className="flex-1" />
          <StylePicker />
          <ModeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button aria-label="用户菜单" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8">
                  <AvatarFallback>{(user?.name ?? '?').slice(0, 1)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => nav('/me')}>
                <UserRound className="size-4" /> 个人资料
              </DropdownMenuItem>
              {user?.isSuperAdmin && (
                <DropdownMenuItem onClick={() => nav('/admin')}>
                  <ShieldCheck className="size-4" /> 管理
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  logout();
                  nav('/login');
                }}
              >
                <LogOut className="size-4" /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-4 md:max-w-5xl">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: 挂载 Toaster**

`frontend/src/main.tsx`：导入 `import { Toaster } from './components/Toaster';`，在 `<App />` 之后（`AuthProvider` 内）渲染 `<Toaster />`。

- [ ] **Step 3: App.tsx 加载态**

`frontend/src/App.tsx` 中 `RequireAuth` 的 `if (loading) return <div className="page">加载中…</div>;` 替换为：

```tsx
if (loading)
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6">
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
```

并在文件头部 `import { Skeleton } from './components/ui/skeleton';`。Routes 结构不变。

- [ ] **Step 4: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功。自检（`npm run dev`）：登录后头部吸顶毛玻璃；头像下拉含个人资料/退出；两套风格与日夜切换即时生效且刷新后保持。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Layout.tsx frontend/src/main.tsx frontend/src/App.tsx
git commit -m "feat(frontend): 新全局头部与用户菜单"
```

---

### Task 5: 认证页（Login / Register / InviteAccept）

**Files:**
- Rewrite: `frontend/src/pages/Login.tsx`
- Rewrite: `frontend/src/pages/Register.tsx`
- Rewrite: `frontend/src/pages/InviteAccept.tsx`

**Interfaces:**
- Consumes: `Card/Input/Label/Button/Badge`、`ModeToggle`、`toast`（sonner）；`useAuth().login`；`api()`
- Produces: 无新接口（页面级）

**保留逻辑（逐字保留，仅改渲染）：**
- Login：state `email/password/err/busy`；`submit(e)` 调 `api('/api/auth/login', { body: { email, password } })` → `login(token, user)` → `nav('/projects')`。
- Register：state `form{inviteCode,email,name,password}/err/busy` 与 `set(k)` 柯里化更新器；`submit(e)` 调 `api('/api/auth/register', { body: { ...form, inviteCode: form.inviteCode || undefined } })`。
- InviteAccept：`token` 路由参数；挂载拉 `api('/api/invites/' + token)`；`accept()` 调 `api('/api/invites/' + token + '/accept', { body: {} })` → `nav('/p/' + projectId)`。

**交互变更：** catch 到的错误除保留 `err` 内联展示外不再新增 toast（登录失败属于表单内反馈）；三页布局统一为「居中卡片 + 右上角 ModeToggle」。

- [ ] **Step 1: Login.tsx**

结构（完整替换渲染部分，逻辑保留）：

```tsx
<div className="flex min-h-screen items-center justify-center bg-background px-4">
  <div className="fixed right-3 top-3 z-50">
    <ModeToggle />
  </div>
  <Card className="w-full max-w-sm">
    <CardHeader>
      <CardTitle className="text-2xl text-primary">ANON</CardTitle>
      <CardDescription>登录你的账号</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">邮箱</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">密码</Label>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-muted-foreground">
        没有账号？<Link to="/register" className="text-primary hover:underline">使用邀请码注册</Link>
      </p>
    </CardContent>
  </Card>
</div>
```

- [ ] **Step 2: Register.tsx**

同 Login 布局骨架，`CardDescription` 为「凭邀请码注册新账号」；四个字段依次为邀请码（`placeholder="邀请码（可留空）"`，无 required）、邮箱（required）、昵称（required）、密码（required，`minLength={8}`），均用 `Label + Input`，受控逻辑 `set(k)` 不变；底部链接 `已有账号？<Link to="/login">直接登录</Link>`；提交按钮 `disabled={busy}`，文案 `注册`。

- [ ] **Step 3: InviteAccept.tsx**

同布局骨架：标题「项目邀请」；`err` 用 `text-destructive`；`info` 存在时渲染 `CardContent`：项目名 `<p className="text-lg font-semibold">{info.projectName}</p>`，角色用 `<Badge variant="secondary">{info.roleName}</Badge>`，有效期 `<p className="text-sm text-muted-foreground">有效期至 {info.expiresAt.slice(0, 10)}</p>`，底部 `<Button className="w-full" onClick={accept}>接受邀请</Button>`；`info` 未到时渲染 `<Skeleton className="h-40 w-full" />`。

- [ ] **Step 4: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检登录/注册页在移动端居中、表单可用、日夜切换正常。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Login.tsx frontend/src/pages/Register.tsx frontend/src/pages/InviteAccept.tsx
git commit -m "feat(frontend): 认证页焕新（登录/注册/邀请接受）"
```

---

### Task 6: 项目列表页（Projects）

**Files:**
- Rewrite: `frontend/src/pages/Projects.tsx`

**Interfaces:**
- Consumes: `Card/Button/Input/Label/Badge/Skeleton`、`FormOverlay`、`toast`
- Produces: 无新接口

**保留逻辑（逐字保留）：** state `projects/name/startDate/endDate/err`；`load()`（GET `/api/projects`，挂载调用）；`create(e)`（POST body `{ name, startDate: startDate ? new Date(startDate).toISOString() : undefined, endDate: endDate ? new Date(endDate).toISOString() : undefined }`，成功后清空表单并 `load()`）。

**交互变更：** 创建表单从常驻卡片改为右上角「新建项目」按钮 + `FormOverlay`；创建失败用 `toast.error(e.message)`（移除 `err` 内联位，state 可删）；列表加载中加骨架屏，空列表渲染空状态。

- [ ] **Step 1: 重写 Projects.tsx**

组件骨架（逻辑保留，渲染按下述结构）：

```tsx
const [createOpen, setCreateOpen] = useState(false);
// load/create 逻辑保留；create 成功后 setCreateOpen(false)，catch 改 toast.error((e as Error).message)
```

页头与列表：

```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <h2 className="text-xl font-semibold">我的项目</h2>
    <Button onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" /> 新建项目
    </Button>
  </div>

  {loading /* 新 state 或 projects===null 判断 */ ? (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  ) : projects.length === 0 ? (
    <Card className="flex flex-col items-center gap-3 py-12 text-center">
      <FolderPlus className="size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">还没有项目，创建第一个吧</p>
      <Button onClick={() => setCreateOpen(true)}>新建项目</Button>
    </Card>
  ) : (
    <div className="grid gap-3 md:grid-cols-2">
      {projects.map((p) => (
        <Link key={p.id} to={'/p/' + p.id}>
          <Card className="h-full transition-colors hover:border-primary/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{p.name}</CardTitle>
              {p.description && <CardDescription>{p.description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              {p.myRole && <Badge variant="secondary">{p.myRole}</Badge>}
              {(p.startDate || p.endDate) && (
                <span>
                  {p.startDate?.slice(0, 10) ?? '…'} ~ {p.endDate?.slice(0, 10) ?? '…'}
                </span>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )}

  <FormOverlay open={createOpen} onOpenChange={setCreateOpen} title="新建项目">
    <form onSubmit={create} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="pname">项目名称</Label>
        <Input id="pname" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pstart">开始日期</Label>
          <Input id="pstart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pend">结束日期</Label>
          <Input id="pend" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-full">创建</Button>
    </form>
  </FormOverlay>
</div>
```

`Plus`、`FolderPlus` 来自 lucide-react。加载态实现方式：`projects` 初值改为 `null`（`useState<ProjectSummary[] | null>(null)`），`null` 视为加载中。

- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：新建走弹层、空态/骨架屏正常、卡片点击进项目。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Projects.tsx
git commit -m "feat(frontend): 项目列表页焕新"
```

---

### Task 7: 项目工作台导航（ProjectHome）

**Files:**
- Rewrite: `frontend/src/pages/ProjectHome.tsx`

**Interfaces:**
- Consumes: `Tabs/TabsList/TabsTrigger`、`Sheet`、`Badge`、lucide 图标；7 个 Tab 组件的既有 props 契约（`TodosTab/FinanceTab/MaterialsTab/AccountsTab: { project, members, myPermissions }`；`MembersTab: { project, members, onChanged }`；`RolesTab/SettingsTab: { project, onChanged }`）
- Produces: 无（Tab 组件 props 契约不变）

**保留逻辑（逐字保留）：** `Detail` 接口、`load()`（useCallback 依赖 `[id]`）、挂载 `useEffect`、7 个 Tab 的条件渲染与 props 传递、`tab` state（键集合 `todos|finance|materials|accounts|members|roles|settings` 不变）。

**布局：** 项目名 + myRole Badge 页头；桌面端（≥768px）用 shadcn `Tabs` 做顶部标签；移动端（<768px）隐藏顶部标签，改底部固定导航（待办/财务/物料/账号 + 更多 Sheet 内含成员/角色/设置）。

- [ ] **Step 1: 重写 ProjectHome.tsx**

在保留逻辑基础上，渲染结构替换为：

```tsx
const TABS = [
  { key: 'todos', label: '待办', icon: ListTodo },
  { key: 'finance', label: '财务', icon: Wallet },
  { key: 'materials', label: '物料', icon: FolderOpen },
  { key: 'accounts', label: '账号', icon: KeyRound },
  { key: 'members', label: '成员', icon: Users },
  { key: 'roles', label: '角色', icon: Shield },
  { key: 'settings', label: '设置', icon: Settings },
] as const;

const MOBILE_MAIN = TABS.slice(0, 4); // 待办/财务/物料/账号
const MOBILE_MORE = TABS.slice(4); // 成员/角色/设置

// 组件内新增：const [moreOpen, setMoreOpen] = useState(false);
// err 时：<p className="text-destructive">{err}</p>
// 无 detail 时：骨架屏（页头 Skeleton h-8 w-1/2 + 列表 Skeleton h-40）
```

正常态渲染：

```tsx
<div className="pb-20 md:pb-0">
  <div className="mb-3 flex items-center gap-2">
    <h2 className="text-xl font-semibold">{detail.project.name}</h2>
    <Badge variant="secondary">{detail.myRole}</Badge>
  </div>

  {/* 桌面端顶部标签 */}
  <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="hidden md:block">
    <TabsList>
      {TABS.map((t) => (
        <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
      ))}
    </TabsList>
  </Tabs>

  {/* Tab 内容：保留现有 7 个条件渲染块，原样不动 */}
  <div className="mt-3">
    {tab === 'todos' && <TodosTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />}
    {tab === 'finance' && <FinanceTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />}
    {tab === 'materials' && <MaterialsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />}
    {tab === 'accounts' && <AccountsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />}
    {tab === 'members' && <MembersTab project={detail.project} members={detail.members} onChanged={load} />}
    {tab === 'roles' && <RolesTab project={detail.project} onChanged={load} />}
    {tab === 'settings' && <SettingsTab project={detail.project} onChanged={load} />}
  </div>

  {/* 移动端底部导航 */}
  <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
    <div className="grid grid-cols-5">
      {MOBILE_MAIN.map((t) => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={`flex flex-col items-center gap-0.5 py-2 text-xs ${tab === t.key ? 'text-primary' : 'text-muted-foreground'}`}
        >
          <t.icon className="size-5" />
          {t.label}
        </button>
      ))}
      <button
        onClick={() => setMoreOpen(true)}
        className={`flex flex-col items-center gap-0.5 py-2 text-xs ${MOBILE_MORE.some((t) => t.key === tab) ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <MoreHorizontal className="size-5" />
        更多
      </button>
    </div>
  </nav>

  <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
    <SheetContent side="bottom" className="rounded-t-2xl">
      <SheetHeader>
        <SheetTitle>更多</SheetTitle>
      </SheetHeader>
      <div className="grid gap-2 p-4">
        {MOBILE_MORE.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'secondary' : 'ghost'}
            className="justify-start"
            onClick={() => {
              setTab(t.key);
              setMoreOpen(false);
            }}
          >
            <t.icon className="size-4" /> {t.label}
          </Button>
        ))}
      </div>
    </SheetContent>
  </Sheet>
</div>
```

图标 import：`ListTodo, Wallet, FolderOpen, KeyRound, Users, Shield, Settings, MoreHorizontal` 均来自 lucide-react。

- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：移动端底部导航切换 4 个主 Tab，「更多」Sheet 切换成员/角色/设置且高亮保持；桌面端顶部标签正常；底部导航不遮挡内容（`pb-20`）。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ProjectHome.tsx
git commit -m "feat(frontend): 工作台导航（移动底部栏 + 桌面标签页）"
```

---

### Task 8: 待办 Tab（TodosTab）

**Files:**
- Rewrite: `frontend/src/components/project/TodosTab.tsx`

**Interfaces:**
- Consumes: 全部表单/卡片/弹层 ui 组件、`FormOverlay`、`AlertDialog`、`toast`；props `{ project: ProjectDetail; members: Member[]; myPermissions: string[] }` 不变
- Produces: 无（props 契约不变）

**保留逻辑（逐字保留）：**
- state 全集：`todos/err/filters{category,assignee,status,sort,order}/form{title,category,note,nodeAt,dueAt,remindAt}/assigneeIds/completingId/completionNote/completionFiles/importFile(ref)/importAnchor/importDate`
- `canManage = myPermissions.includes('project:manage') || myPermissions.includes('todo:manage')`
- `load`（filters 拼 URLSearchParams → GET `todos?query`，useCallback + 自动重载）、`create`、`complete(todoId)`（FormData 字段 `completionNote` + 多个 `files`）、删除（DELETE）、`exportTemplate`（Blob 下载 `todo-template.json`）、`importTemplate`（解析 JSON → POST `{ template, anchor, date }`）
- 时间工具 `toIso()` / `fmt()` 原样

**交互变更：**
- 新建待办：常驻表单 → 「新建待办」按钮 + `FormOverlay`（成功后关闭并 `toast.success('已创建')`）
- 完成待办：卡片内联面板 → `FormOverlay`（标题「完成待办」，备注 textarea + `<input type="file" multiple>`，`completionFiles` 逻辑不变；成功后 `toast.success('已完成')`）
- 删除：`window.confirm` → `AlertDialog`（在卡片「更多」DropdownMenu 内触发，确认后执行原删除逻辑并 `toast.success('已删除')`）
- 模板导出/导入：底部常驻卡 → 页头「模板」DropdownMenu（菜单项点击后打开对应 `FormOverlay`：导出直接执行；导入含 anchor `Select`、date `Input type="date"`、file input）
- 错误：`err` 内联保留（列表加载失败时卡片位展示），操作类错误一律 `toast.error`

- [ ] **Step 1: 重写 TodosTab.tsx 渲染结构**

页头与筛选栏：

```tsx
<div className="space-y-3">
  <div className="flex items-center justify-between gap-2">
    <h3 className="text-lg font-semibold">待办</h3>
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><FileJson className="size-4" /> 模板</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={exportTemplate}>导出为模板</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setImportOpen(true)}>导入模板…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> 新建待办</Button>
    </div>
  </div>

  <Card>
    <CardContent className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
      <Input placeholder="按类别筛选" value={filters.category} onChange={/* 保留 */} />
      <Select value={filters.assignee || 'all'} onValueChange={(v) => setFilters({ ...filters, assignee: v === 'all' ? '' : v })}>
        <SelectTrigger><SelectValue placeholder="指派人" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部指派人</SelectItem>
          {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={filters.status || 'all'} onValueChange={(v) => setFilters({ ...filters, status: v === 'all' ? '' : v })}>
        <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          <SelectItem value="open">进行中</SelectItem>
          <SelectItem value="done">已完成</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={`${filters.sort}:${filters.order}`}
        onValueChange={(v) => { const [sort, order] = v.split(':'); setFilters({ ...filters, sort, order }); }}
      >
        <SelectTrigger><SelectValue placeholder="排序" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="createdAt:desc">最新创建</SelectItem>
          <SelectItem value="dueAt:asc">到期时间↑</SelectItem>
          <SelectItem value="nodeAt:asc">节点时间↑</SelectItem>
        </SelectContent>
      </Select>
    </CardContent>
  </Card>
  {/* 待办卡片列表、弹层… */}
</div>
```

注意：原排序 select 的值形式 `createdAt:desc` split 逻辑保留，与上面对齐。shadcn `Select` 不允许空字符串 value，故用 `'all'` 哨兵值转换（新建/完成等其它 Select 同理）。

待办卡片（列表项，字段渲染逻辑保留）：

```tsx
<Card key={t.id}>
  <CardContent className="space-y-2 p-4">
    <div className="flex items-start justify-between gap-2">
      <div className="space-y-1">
        <p className={`font-medium ${t.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
        <div className="flex flex-wrap gap-1.5">
          {t.category && <Badge variant="secondary">{t.category}</Badge>}
          {t.status === 'done' ? (
            <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">已完成</Badge>
          ) : isOverdue(t) ? (
            <Badge variant="destructive">已逾期</Badge>
          ) : (
            <Badge variant="outline">进行中</Badge>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {t.status === 'open' /* 与现行行为一致：客户端不预检完成权限，由服务端校验 */ && (
            <DropdownMenuItem onClick={() => { setCompletingId(t.id); setCompletionNote(''); }}>完成</DropdownMenuItem>
          )}
          {canManage && <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(t.id)}>删除</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div className="text-sm text-muted-foreground">
      {t.assignees.length > 0 && <p>指派：{t.assignees.map((a) => a.name).join('、')}</p>}
      {t.nodeAt && <p>节点：{fmt(t.nodeAt)}</p>}
      {t.dueAt && <p>到期：{fmt(t.dueAt)}</p>}
    </div>
    {t.note && <p className="text-sm">{t.note}</p>}
    {t.completionNote && <p className="text-sm text-muted-foreground">完成备注:{t.completionNote}</p>}
    {t.attachments.length > 0 && (
      <div className="flex flex-wrap gap-1.5">
        {t.attachments.map((a) => (
          <Button key={a.id} variant="outline" size="sm" onClick={() => downloadFile(a.id, a.filename)}>
            <Paperclip className="size-3.5" /> {a.filename}
          </Button>
        ))}
      </div>
    )}
  </CardContent>
</Card>
```

新增小组件与工具（放本文件内）：

```ts
function isOverdue(t: TodoItem) {
  return t.status !== 'done' && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
}
```

完成/新建/导入三个 `FormOverlay` 与删除 `AlertDialog` 的表单字段与现有内联表单字段一一对应（标题、类别、节点时间、到期时间、提醒时间用 `Input type="datetime-local"`，指派人勾选组用下方「勾选徽章组」，备注用 `Textarea`）。「勾选徽章组」模式（指派人/平摊人/可见范围通用）：

```tsx
<label
  key={m.userId}
  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
    assigneeIds.includes(m.userId) ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'
  }`}
>
  <Checkbox checked={assigneeIds.includes(m.userId)} onCheckedChange={(c) => /* 保留原 toggle 逻辑 */} />
  {m.name}
</label>
```

`AlertDialog` 删除确认（`deletingId` 新 state 替代 `confirm`）：

```tsx
<AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>删除待办？</AlertDialogTitle>
      <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction onClick={() => { /* 保留原删除逻辑，目标 = deletingId */ setDeletingId(null); }}>删除</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

空列表渲染：`<Card className="p-8 text-center text-sm text-muted-foreground">没有符合条件的待办</Card>`；加载中渲染两个 `Skeleton h-28`。

- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：新建/筛选/排序/完成（带附件）/删除确认/模板导出导入全流程可用。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project/TodosTab.tsx
git commit -m "feat(frontend): 待办 Tab 焕新"
```

---

### Task 9: 财务 Tab（FinanceTab）

**Files:**
- Rewrite: `frontend/src/components/project/FinanceTab.tsx`

**Interfaces:**
- Consumes: ui 组件全集、`FormOverlay`、`AlertDialog`、`toast`、`useAuth()`；props `{ project, members, myPermissions }` 不变
- Produces: 无（props 契约不变）

**保留逻辑（逐字保留）：**
- state 全集：`transactions/summary/err/form{type,amount,note,payerUserId}/splitAmong/files/ticketPrice/ticketCount/exportUserId`
- 权限派生：`canManage = project:manage || finance:manage`；`canAdd = canManage || finance:add`
- `load`（GET `/finance` 并回填门票表单）、`create(e)`（FormData 字段 `type, amount, note, payerUserId, splitAmong(JSON), files*`）、`saveTicket`（PATCH `/finance/ticket`）、`exportCsv`（手写 fetch + Bearer + blob，文件名 `finance-<name>.csv`）、删除（DELETE，权限 `canManage || t.createdBy === user.id`）
- 金额工具 `yuan(cents)`、`signed(cents)`（U+2212 前缀）原样

**交互变更：**
- 「记一笔」：常驻表单 → 「记一笔」按钮 + `FormOverlay`（成功后关闭 + `toast.success('已记账')`）
- 删除：`confirm` → `AlertDialog`（同 Task 8 模式，`deletingId` state）
- 汇总：4 个统计卡（网格 2×2，移动端）+ 按人净额卡 + 建议转账卡；数字加 `tabular-nums`
- 错误：操作类 `toast.error`；列表加载失败保留内联 `err`

- [ ] **Step 1: 重写 FinanceTab.tsx 渲染结构**

统计卡网格（`summary` 存在时）：

```tsx
<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
  {[
    { label: '门票收入', value: yuan(summary.ticketIncomeCents), cls: '' },
    { label: '记账收入', value: yuan(summary.incomeCents), cls: '' },
    { label: '总支出', value: yuan(summary.expenseCents), cls: '' },
    { label: '盈亏', value: signed(summary.profitCents), cls: summary.profitCents < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400' },
  ].map((s) => (
    <Card key={s.label}>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{s.label}</p>
        <p className={`mt-1 text-lg font-semibold tabular-nums ${s.cls}`}>¥{s.value}</p>
      </CardContent>
    </Card>
  ))}
</div>
```

按人净额卡（负数 `text-destructive`，正数默认色，前缀符号保留 `signed()`）：

```tsx
<Card>
  <CardHeader className="pb-2"><CardTitle className="text-base">按人净额</CardTitle></CardHeader>
  <CardContent className="divide-y">
    {summary.perUser.map((u) => (
      <div key={u.userId} className="flex items-center justify-between py-2 text-sm">
        <span>{u.name}</span>
        <span className={`tabular-nums ${u.netCents < 0 ? 'text-destructive' : ''}`}>{signed(u.netCents)}</span>
      </div>
    ))}
  </CardContent>
</Card>
```

建议转账卡：

```tsx
<Card>
  <CardHeader className="pb-2"><CardTitle className="text-base">建议转账</CardTitle></CardHeader>
  <CardContent className="space-y-1.5">
    {summary.settlement.length === 0 ? (
      <p className="text-sm text-muted-foreground">无需转账</p>
    ) : (
      summary.settlement.map((s, i) => (
        <p key={i} className="text-sm">
          {s.from.name} <ArrowRight className="inline size-3.5" /> {s.to.name}：
          <span className="font-medium tabular-nums">¥{yuan(s.amountCents)}</span>
        </p>
      ))
    )}
  </CardContent>
</Card>
```

账目卡片（字段与现有卡片一致）：左上是 `Badge`（支出 `variant="destructive"` / 收入 `variant="outline"` 绿色描边）+ 金额 `<span className="font-semibold tabular-nums">¥{yuan(t.amountCents)}</span>`；muted 行：付款人/收款人（label 随 `t.type`）、平摊名单（空 = 全员）、添加人与时间 `t.createdAt.slice(0, 10)`；附件按钮同 Task 8 的 `downloadFile` 模式；删除走 DropdownMenu + AlertDialog。

页头：

```tsx
<div className="flex items-center justify-between gap-2">
  <h3 className="text-lg font-semibold">财务</h3>
  <div className="flex gap-2">
    {canManage && (
      <Button variant="outline" size="sm" onClick={() => setTicketOpen(true)}>门票设置</Button>
    )}
    {canManage && (
      <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="size-4" /> 导出 CSV</Button>
    )}
    {canAdd && (
      <Button size="sm" onClick={() => setEntryOpen(true)}><Plus className="size-4" /> 记一笔</Button>
    )}
  </div>
</div>
```

门票设置、导出 CSV、记一笔分别用三个 `FormOverlay`（字段与现有表单一一对应：门票 = 单价 `Input type="number" step="0.01"` + 数量 `Input type="number"` + muted 提示门票收入；导出 = 成员 `Select`（含「我自己」空值哨兵 `'me'`）+ 导出按钮；记一笔 = 类型 `Select`、金额、付款人 `Select`（label 随 type 变）、expense 时平摊人勾选徽章组（同 Task 8 模式）、备注 `Textarea`、凭证 `<input type="file" multiple>`）。

`Select` 空值处理同 Task 8（哨兵值 `'me'`/`'all'` 转换，`exportUserId` 内部仍存 `''` 表示自己）。

- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：记账（含平摊人、凭证）、门票设置实时更新统计、CSV 导出下载、删除确认；两种身份（`finance:manage` 与仅 `finance:add`）下区块显隐正确。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project/FinanceTab.tsx
git commit -m "feat(frontend): 财务 Tab 焕新"
```

---

### Task 10: 物料 Tab（MaterialsTab）+ 共享 VisibilityPicker

**Files:**
- Create: `frontend/src/components/project/VisibilityPicker.tsx`
- Rewrite: `frontend/src/components/project/MaterialsTab.tsx`

**Interfaces:**
- Consumes: ui 组件、`FormOverlay`、`AlertDialog`、`Dialog`（图片放大）、`AuthImg`（不改）、`downloadUrl`
- Produces: **`VisibilityPicker`（AccountsTab 复用）**：

```tsx
export function VisibilityPicker({
  members,
  roles,
  value,
  onChange,
}: {
  members: Member[];
  roles: string[];
  value: Visibility;          // { userIds: string[]; roleNames: string[] }
  onChange: (v: Visibility) => void;
}): JSX.Element;
```

行为：两行勾选徽章组（成员行 + 角色行，角色 label 前缀 `角色:`），受控；**全不勾 = 不限制（全体可见）**，底部渲染一行 `text-xs text-muted-foreground` 说明此语义。

**保留逻辑（逐字保留）：**
- 主组件 state：`types/resources/filterType/err/newTypeName/resForm{name,typeId,description}/typeVisFor`；`load`（Promise.all 并行 GET types + resources）、`createType`、`createResource`（typeId 缺省取 `types[0]?.id`）、类型删除、前端过滤 `filterType ? resources.filter(...) : resources`
- `ResourceCard` 子组件 state 与逻辑：`versions/selected/zoom/showVis/note/file`；`base` URL 构造；GET versions、POST versions（FormData `note` + `file`）、PATCH visibility、DELETE 资源；版本选择失效回退最新版；预览 URL `${base}/preview`（AuthImg）；下载 `downloadUrl('${base}/versions/${selected}/download', file.filename)`
- 权限派生 `canManage = project:manage || materials:manage`；`roles = project.roles.map(r => r.name)`

**交互变更：**
- 原自管 state 的 `VisibilityEditor` → 统一受控 `VisibilityPicker`；类型与资源的可见范围编辑都改为「展开内联编辑 + 保存/取消按钮」，保存时把 Picker 的 value 提交给原 PATCH 逻辑
- 新建类型/新建资源：保留为两张常驻卡（字段少），但改用 ui 组件；类型筛选改为一排可切换 `Badge`（选中态 `variant="default"`，未选 `variant="outline"`，`cursor-pointer`）
- 上传新版本：内联行 → `FormOverlay`（file input + 备注 `Input`）
- 图片放大：原内联 fixed 遮罩 → `Dialog`（`DialogContent className="max-w-3xl p-2"`，内放 AuthImg 原图，点击关闭）
- 删除（类型/资源）：`confirm` → `AlertDialog`
- 错误：操作类 `toast.error`，ResourceCard 的 `onError(msg)` 回调改调 `toast.error`

- [ ] **Step 1: 创建 VisibilityPicker.tsx**

```tsx
import { Checkbox } from '@/components/ui/checkbox';
import type { Member, Visibility } from '@/types';

interface Props {
  members: Member[];
  roles: string[];
  value: Visibility;
  onChange: (v: Visibility) => void;
}

export function VisibilityPicker({ members, roles, value, onChange }: Props) {
  const toggleUser = (id: string, checked: boolean) =>
    onChange({ ...value, userIds: checked ? [...value.userIds, id] : value.userIds.filter((u) => u !== id) });
  const toggleRole = (name: string, checked: boolean) =>
    onChange({ ...value, roleNames: checked ? [...value.roleNames, name] : value.roleNames.filter((r) => r !== name) });

  const chip = (active: boolean) =>
    `flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
      active ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'
    }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => (
          <label key={m.userId} className={chip(value.userIds.includes(m.userId))}>
            <Checkbox
              checked={value.userIds.includes(m.userId)}
              onCheckedChange={(c) => toggleUser(m.userId, c === true)}
            />
            {m.name}
          </label>
        ))}
      </div>
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <label key={r} className={chip(value.roleNames.includes(r))}>
              <Checkbox
                checked={value.roleNames.includes(r)}
                onCheckedChange={(c) => toggleRole(r, c === true)}
              />
              角色:{r}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">都不勾选 = 全体成员可见</p>
    </div>
  );
}
```

- [ ] **Step 2: 重写 MaterialsTab.tsx 渲染结构**

区块顺序：页头（标题「物料」）→ canManage 时「类型管理」卡（新建 input+按钮一行；类型列表每项：名称 `Badge`、「可见范围」`Button variant="ghost" size="sm"`、「删除」ghost 图标按钮（`Trash2`）触发 AlertDialog；展开可见范围时内联渲染 `VisibilityPicker` + 保存/取消）→ canManage 且 types 非空时「新建资源」卡（名称 `Input`、类型 `Select`、描述 `Textarea`、创建按钮）→ 筛选 Badge 行（「全部」+ 各类型）→ 资源卡片网格 `grid gap-3 md:grid-cols-2`。

ResourceCard 渲染：

```tsx
<Card>
  <CardContent className="space-y-2 p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="font-medium">{resource.name}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{typeName}</Badge>
          <Badge variant="outline">v{resource.latestVersion || '—'}</Badge>
        </div>
      </div>
      {/* canManage 时：DropdownMenu（上传新版本 / 可见范围 / 删除） */}
    </div>
    {resource.description && <p className="text-sm text-muted-foreground">{resource.description}</p>}
    {resource.hasPreview && (
      <button onClick={() => setZoom(true)} className="block w-full overflow-hidden rounded-lg border">
        <AuthImg src={`${base}/preview`} alt={resource.name} style={{ width: '100%', display: 'block' }} />
      </button>
    )}
    <div className="flex items-center gap-2">
      <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
        <SelectContent>
          {versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={!selectedVersion?.file} onClick={/* 保留下载逻辑 */}>
        <Download className="size-4" /> 下载该版本
      </Button>
    </div>
    {/* 可见范围内联编辑（showVis 时）：VisibilityPicker + 保存/取消 */}
  </CardContent>
</Card>
```

放大 Dialog：

```tsx
<Dialog open={zoom} onOpenChange={setZoom}>
  <DialogContent className="max-w-3xl p-2">
    <AuthImg src={`${base}/versions/${selected}/download`} alt={resource.name} style={{ width: '100%' }} />
  </DialogContent>
</Dialog>
```

上传 FormOverlay：标题「上传新版本」，file input（`onChange` 保留）、备注 `Input`、「上传」按钮提交原逻辑。

- [ ] **Step 3: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：类型/资源增删、预览图加载、点击放大、版本切换与下载、可见范围保存后即时生效。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/project/VisibilityPicker.tsx frontend/src/components/project/MaterialsTab.tsx
git commit -m "feat(frontend): 物料 Tab 焕新与共享 VisibilityPicker"
```

---

### Task 11: 账号 Tab（AccountsTab）

**Files:**
- Rewrite: `frontend/src/components/project/AccountsTab.tsx`

**Interfaces:**
- Consumes: Task 10 的 `VisibilityPicker`；ui 组件、`FormOverlay`、`AlertDialog`、`Dialog`、`toast`；`encryptWithPassphrase`/`decryptWithPassphrase`（`../crypto`，不改）；props 契约不变
- Produces: 无

**保留逻辑（逐字保留）：**
- state 全集：`accounts/err/platformFilter/form{platform,account,mode,password,passphrase,keySource,note}/vis/revealingId/revealPass/revealed/editingVisId/visDraft`
- 常量 `PLATFORMS`、`MODE_LABELS`
- `load`（`?platform=` 服务端筛选）、`create(e)`（full + user 分支调 `encryptWithPassphrase`，full 前端校验密码/口令非空）、`reveal(a)`（server 直接显示 / user 经 `decryptWithPassphrase(cipher, revealPass)`，成功清 `revealingId/revealPass`）、`saveVisibility(id)`（PATCH）、删除、`visText(a)`

**交互变更：**
- 新建账号：常驻表单 → 「新建账号」按钮 + `FormOverlay`；原受控 VisibilityEditor 直接换成 `VisibilityPicker`（`vis`/`setVis` 对接）
- 查看密码：卡片内联展开 → 卡片上「查看密码」按钮点击后，user 加密弹 `Dialog`（口令 `Input type="password"` + 确认/取消），server 加密直接执行；已显示的明文用 `<code className="rounded bg-muted px-2 py-1">` 呈现在卡片上，附「隐藏」ghost 按钮（新增小交互：点击从 `revealed` 中删除该 id）
- 删除：`confirm` → `AlertDialog`
- 可见范围编辑：内联展开 `VisibilityPicker` + 保存/取消（`editingVisId/visDraft` 逻辑保留）
- 错误：操作类 `toast.error`；`err` 内联保留给列表加载失败

- [ ] **Step 1: 重写 AccountsTab.tsx 渲染结构**

新建表单（FormOverlay 内）：平台 `Select`（PLATFORMS）、账号 `Input`、记录模式 `RadioGroup`（三项：`full 完整账号` / `otp 二步验证` / `contact 仅联系人`，每项配一行 muted 说明）、`mode==='full'` 时显示密码 `Input type="password"` + 加密方式 `RadioGroup`（`user 浏览器端加密（推荐）` / `server 服务端密钥加密`）+ `keySource==='user'` 时保险库口令 `Input type="password"`、备注 `Textarea`、`VisibilityPicker`。提交逻辑不变。

筛选行：

```tsx
<Select value={platformFilter || 'all'} onValueChange={(v) => setPlatformFilter(v === 'all' ? '' : v)}>
  <SelectTrigger className="w-36"><SelectValue placeholder="平台" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">全部平台</SelectItem>
    {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
  </SelectContent>
</Select>
```

账号卡片：

```tsx
<Card>
  <CardContent className="space-y-2 p-4">
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="font-medium">{a.account}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{a.platform}</Badge>
          <Badge variant="outline">{MODE_LABELS[a.mode]}</Badge>
          {a.hasPassword && (
            <Badge variant="outline">{a.cipherKeySource === 'user' ? '浏览器加密' : '服务端加密'}</Badge>
          )}
        </div>
      </div>
      {/* canManage：DropdownMenu（可见范围 / 删除） */}
    </div>
    <p className="text-sm text-muted-foreground">
      {a.addedBy ? `添加人：${a.addedBy.name}` : ''} 可见范围：{visText(a)}
    </p>
    {a.mode === 'otp' && a.addedBy?.contacts?.length > 0 && (
      <p className="text-sm">
        索取验证码请联系：{a.addedBy.contacts.map((c) => `${c.platform} ${c.value}`).join('、')}
      </p>
    )}
    {a.note && <p className="text-sm">{a.note}</p>}
    {a.hasPassword && (
      revealed[a.id] ? (
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 text-sm">{revealed[a.id]}</code>
          <Button variant="ghost" size="sm" onClick={() => setRevealed((r) => { const n = { ...r }; delete n[a.id]; return n; })}>隐藏</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => /* user 加密弹口令 Dialog；server 直接 reveal(a) */}>
          <KeyRound className="size-4" /> 查看密码
        </Button>
      )
    )}
    {/* editingVisId === a.id 时：VisibilityPicker + 保存/取消 */}
  </CardContent>
</Card>
```

口令 Dialog（`revealingId` 对应 user 加密账号）：

```tsx
<Dialog open={!!revealingId} onOpenChange={(o) => { if (!o) { setRevealingId(null); setRevealPass(''); } }}>
  <DialogContent className="sm:max-w-sm">
    <DialogHeader>
      <DialogTitle>输入保险库口令</DialogTitle>
      <DialogDescription>密码在你的浏览器内解密，口令不会上传。</DialogDescription>
    </DialogHeader>
    <form onSubmit={(e) => { e.preventDefault(); /* 保留 reveal 的 user 分支 */ }} className="space-y-3">
      <Input type="password" autoFocus value={revealPass} onChange={(e) => setRevealPass(e.target.value)} />
      <Button type="submit" className="w-full">解密查看</Button>
    </form>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：三模式新建（含浏览器加密分支）、平台筛选、查看密码（user/server 两分支）、OTP 联系人展示、可见范围编辑、删除确认。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project/AccountsTab.tsx
git commit -m "feat(frontend): 账号 Tab 焕新"
```

---

### Task 12: 成员 Tab + 角色 Tab

**Files:**
- Rewrite: `frontend/src/components/project/MembersTab.tsx`
- Rewrite: `frontend/src/components/project/RolesTab.tsx`

**Interfaces:**
- Consumes: ui 组件、`Dialog`、`AlertDialog`、`toast`、`useAuth()`；props 契约不变（MembersTab `{ project, members, onChanged }`；RolesTab `{ project, onChanged }`）
- Produces: 无

**MembersTab 保留逻辑（逐字保留）：** state `roleName/targetUserId/inviteUrl/err`；`run(fn)` 包装器；`createInvite`（POST `/invites`，拼 `` `${location.origin}${d.url}` ``）；改角色（PATCH `/members/:userId` onChange 直接保存）；移除（DELETE，`user.id` 自己不显示按钮）。

**MembersTab 交互变更：** 邀请链接生成后不再内联展示，改为弹 `Dialog` 展示完整链接（只读 `Input` + 「复制」按钮，`navigator.clipboard.writeText` 后 `toast.success('已复制')`）；移除成员 `confirm` → `AlertDialog`（`removingId` state）；错误 toast 化。

**MembersTab 渲染结构：**

```tsx
<Card>
  <CardHeader className="pb-2"><CardTitle className="text-base">邀请成员</CardTitle></CardHeader>
  <CardContent className="flex flex-col gap-2 sm:flex-row">
    <Select value={roleName} onValueChange={setRoleName}>
      <SelectTrigger className="sm:w-40"><SelectValue placeholder="角色" /></SelectTrigger>
      <SelectContent>
        {project.roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
      </SelectContent>
    </Select>
    <Input placeholder="指定用户 ID（可留空）" value={targetUserId} onChange={/* 保留 */} />
    <Button onClick={createInvite}><Link2 className="size-4" /> 生成链接</Button>
  </CardContent>
</Card>
```

成员卡片列表（每项）：`Avatar`（首字）+ 名称/邮箱 + 角色 `Select`（value `m.roleName`，onChange 触发原 PATCH）+ 非本人时「移除」ghost 图标按钮。

邀请链接 Dialog（`inviteUrl` 非空即 open，关闭时 `setInviteUrl('')`）：

```tsx
<Dialog open={!!inviteUrl} onOpenChange={(o) => !o && setInviteUrl('')}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>邀请链接已生成</DialogTitle>
      <DialogDescription>把链接发给对方，登录后打开即可加入项目。</DialogDescription>
    </DialogHeader>
    <div className="flex gap-2">
      <Input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
      <Button onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success('已复制'); }}>复制</Button>
    </div>
  </DialogContent>
</Dialog>
```

**RolesTab 保留逻辑（逐字保留）：** `PERMISSIONS` 常量（10 项 key/label，与现文件完全一致，不得增删改）；state `newName/newPerms/editPerms/err`；`permsOf(name, fallback)`；创建（POST `/roles`）、保存（PATCH `/roles/${encodeURIComponent(name)}`）、删除（同 URL）。`PermissionChecks` 子组件的勾选逻辑。

**RolesTab 交互变更：** `PermissionChecks` 用「勾选徽章组」（同 Task 8 模式）或紧凑 `Checkbox` 网格 `grid grid-cols-2 gap-2`；删除 `confirm` → `AlertDialog`；错误 toast 化；保存成功 `toast.success('已保存')`。

**RolesTab 渲染结构：** 新建卡（角色名 `Input` + 权限勾选网格 + 创建按钮）；角色卡列表（每卡：`CardHeader` 角色名 + 「保存」`Button size="sm"` + 「删除」ghost 图标按钮（`Trash2`）；`CardContent` 权限勾选网格，受控 `permsOf(r.name, r.permissions)`）。

- [ ] **Step 1: 重写 MembersTab.tsx**（按上述结构与保留逻辑）
- [ ] **Step 2: 重写 RolesTab.tsx**（按上述结构与保留逻辑）
- [ ] **Step 3: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：生成邀请链接弹窗可复制、改角色即时生效、移除成员有确认；角色新建/勾选草稿/保存/删除正常。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/project/MembersTab.tsx frontend/src/components/project/RolesTab.tsx
git commit -m "feat(frontend): 成员与角色 Tab 焕新"
```

---

### Task 13: 设置 Tab + 个人资料 + 邀请码管理

**Files:**
- Rewrite: `frontend/src/components/project/SettingsTab.tsx`
- Rewrite: `frontend/src/pages/Me.tsx`
- Rewrite: `frontend/src/pages/Admin.tsx`

**Interfaces:**
- Consumes: ui 组件、`toast`、`useTheme()`（Me 页「界面偏好」卡用）；props/逻辑契约不变
- Produces: 无

**SettingsTab 保留逻辑：** state `form{name,description,startDate,endDate}/msg`；`toDateInput()`；PATCH `/api/projects/:id`（空串 → null）→ `onChanged()` + `setMsg('已保存')`。
**渲染：** 单张 `Card` 表单：名称 `Input`、描述 `Textarea`、开始/结束日期 `grid grid-cols-2 gap-3` 两个 `Input type="date"`、保存 `Button`；`msg` 改为 `toast.success('已保存')` / `toast.error`。

**Me 保留逻辑：** state `name/contacts/msg`；`if (!user) return null`；PATCH `/api/me`（body `{ name, contacts }`）→ `refresh()`；联系方式行内编辑/删除/添加逻辑。
**渲染：** 标题「个人资料」；`Card` 表单：`muted` 行显示邮箱 + 超管时 `Badge`「超级管理员」；昵称 `Label + Input`；联系方式区（每行：平台 `Input className="w-28"` + 账号 `Input className="flex-1"` + 删除 ghost 图标按钮 `Trash2`），「+ 添加联系方式」`Button variant="outline" size="sm"`；保存按钮；`msg` 改 toast。资料卡下方增加「界面偏好」卡：风格主题两个并排 `Button`（简洁/明快，`variant` 按当前 `style` 切换 `default`/`outline`，点击调 `setStyle`）+ 右侧 `ModeToggle`，一行 muted 说明「风格与日夜模式保存在本机」。

**Admin 保留逻辑：** state `codes/custom/err`；`InviteCode` 局部接口；超管门 `if (!user?.isSuperAdmin) return <p>需要超级管理员权限</p>`（注意保持在 hooks 之后）；`load`（GET `/api/admin/invite-codes`）；`create`（POST，custom 空传 `{}`）。
**渲染：** 标题「邀请码管理」；创建卡（`Input` + 「创建」`Button` 一行）；列表卡每项：`<code className="rounded bg-muted px-2 py-0.5">{c.code}</code>` + 状态 `Badge`（已用 `variant="secondary"` / 可用 `variant="outline"` 绿色描边）+ muted 创建日期；`err` 改 toast。

- [ ] **Step 1: 重写三个文件**（按上述结构与保留逻辑）
- [ ] **Step 2: 验证构建 + 自检**

Run: `cd frontend && npm run build`
Expected: 构建成功；自检：项目设置保存、个人资料与联系方式维护、邀请码创建/列表均正常。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/project/SettingsTab.tsx frontend/src/pages/Me.tsx frontend/src/pages/Admin.tsx
git commit -m "feat(frontend): 设置/个人资料/邀请码管理焕新"
```

---

### Task 14: 清理、全量验证与文档更新

**Files:**
- Modify: `frontend/src/**/*.tsx`（清理残留旧类名）
- Modify: `docs/progress.md`、`docs/readme.md`、`docs/design.md`（按仓库约定记录变更）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 无

- [ ] **Step 1: 清理旧 CSS 类残留**

Run: `cd frontend && grep -rn -E 'className="[^"]*\b(page|card|row|chip|muted|error|field|grid-2|tabs|active|ghost|danger|theme-toggle|app-header|spacer)\b' src/ --include='*.tsx' | grep -v 'components/ui/'`

逐一人工核对匹配项：若是新组件类名组合中的合理词（极少）则保留，否则改为对应 Tailwind 类。确认 `src/` 下不再引用任何 Task 1 删除的旧类。

同时全局搜索 `alert(`、`confirm(`：`grep -rn -E '\b(alert|confirm)\(' src/` —— 应为 0 处（全部已替换为 toast/AlertDialog）。

- [ ] **Step 2: 全量构建**

Run: `cd frontend && npm run build`
Expected: `tsc --noEmit` 与 `vite build` 均通过

- [ ] **Step 3: 人工核对清单**

启动 `npm run dev`（后端同步运行），按清单核对：

- 主题：4 种组合（简洁/明快 × 日/夜）切换即时生效、刷新后保持、无首屏闪烁；`anon-theme` 旧值（dark）用户升级后仍为暗色
- 页面 × 视口（<768px 与 ≥768px）：登录/注册/邀请接受、项目列表、工作台 7 Tab、个人资料、管理页
- 主流程冒烟：登录 → 建项目 → 待办（新建/筛选/完成带附件/删除/模板导出导入）→ 财务（记账/门票/汇总/转账建议/导出 CSV/删除）→ 物料（建类型/建资源/上传版本/预览放大/版本下载/可见范围）→ 账号（三模式新建/查看密码两分支/可见范围）→ 成员（邀请链接复制/改角色/移除）→ 角色（建/存/删）→ 设置保存 → 个人资料保存 → 邀请码管理
- 移动端专项：底部导航不遮挡内容、Sheet 弹层可滚动、表单 16px 字号不触发 iOS 缩放

发现的问题当场修复后再继续。

- [ ] **Step 4: 更新文档**

- `docs/progress.md`：追加本次 UI 焕新条目（范围、技术选型、任务列表、验证结果）
- `docs/design.md`「实现与变更记录」节：追加 2026-07-24 前端 UI 焕新摘要（Tailwind v4 + shadcn/ui、双风格主题、移动底部导航）
- `docs/readme.md`：如新依赖/命令有变化（`npm install` 即可，无新命令），核对前端说明是否仍准确，必要时更新「前端技术栈」描述

- [ ] **Step 5: Commit**

```bash
git add frontend/src docs/progress.md docs/readme.md docs/design.md
git commit -m "docs+chore: UI 焕新收尾清理与文档更新"
```

---

## 附：任务依赖关系

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14（严格顺序执行；10 产出的 `VisibilityPicker` 被 11 依赖；3 产出的 `FormOverlay`/主题组件被 4–13 依赖）
