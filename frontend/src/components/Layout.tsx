import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, Check, ChevronDown, FolderOpen, LayoutGrid, LogOut, Moon, Palette, ShieldCheck, Sparkles, Sun, UserRound } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api/client';
import type { ProjectSummary } from '../types';
import Logo from './Logo';
import DemoBanner from './DemoBanner';
import PushBanner from './PushBanner';
import TrialBanner from './TrialBanner';
import { OnboardingDialog } from './onboarding/OnboardingDialog';
import { startTour } from './onboarding/tour';
import { ModeToggle, StylePicker, THEME_STYLES, useTheme } from '../theme';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ActivityShellControls {
  brand: ReactNode;
  switcher: ReactNode;
  theme: ReactNode;
  profile: ReactNode;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const { mode, style, toggleMode, setStyle } = useTheme();
  const [replayOpen, setReplayOpen] = useState(false);
  const pathname = useLocation().pathname;
  const id = pathname.match(/^\/p\/([^/]+)\/?$/)?.[1];
  const isOnsite = /^\/p\/[^/]+\/onsite\/?$/.test(pathname);
  const activeStyle = THEME_STYLES.findIndex(({ key }) => key === style);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    if (!id) {
      setProjects(null);
      return;
    }
    let alive = true;
    api<{ projects: ProjectSummary[] }>('/api/projects')
      .then((d) => alive && setProjects(d.projects))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [id]);
  const current = projects?.find((p) => p.id === id);
  const brand = (iconOnly = false) => (
    <Link to="/projects" aria-label="我的活动" className="inline-flex min-h-11 min-w-11 shrink-0 items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Logo wordmarkClassName={iconOnly ? 'hidden' : undefined} />
    </Link>
  );
  const switcher = current && (
    <div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-md border">
      <button
        onClick={() => nav(`/p/${id}`)}
        aria-label={`返回「${current.name}」的看板`}
        title={`${current.name} — 点击回看板`}
        className="min-w-0 flex-1 wrap-anywhere px-2.5 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {current.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="切换活动" title="切换活动" className="flex size-11 shrink-0 items-center justify-center border-l bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ChevronDown className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-64">
          {projects?.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => nav(`/p/${p.id}`)}>
              {p.id === id ? <Check className="size-4" /> : <FolderOpen className="size-4" />}
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => nav('/projects')}>
            <LayoutGrid className="size-4" /> 查看全部活动
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  const theme = (
    <div className="flex shrink-0 items-center gap-1" data-tour="theme-controls">
      <StylePicker />
      <ModeToggle />
    </div>
  );
  const profile = (compact = false) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button data-tour="user-menu" aria-label="用户菜单" className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="size-8 shrink-0 ring-1 ring-border">
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">
              {(user?.name ?? '?').slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className={compact ? 'hidden' : 'hidden max-w-24 truncate text-sm font-medium md:block'}>{user?.name}</span>
          <ChevronDown className={compact ? 'hidden' : 'hidden size-3.5 text-muted-foreground md:block'} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="md:hidden" onClick={() => setStyle(THEME_STYLES[(activeStyle + 1) % THEME_STYLES.length].key)}>
          <Palette className="size-4" /> 界面风格：{THEME_STYLES[activeStyle].label}
        </DropdownMenuItem>
        <DropdownMenuItem className="md:hidden" onClick={toggleMode}>
          {mode === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {mode === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="md:hidden" />
        <DropdownMenuItem onClick={() => nav('/me')}>
          <UserRound className="size-4" /> 个人资料
        </DropdownMenuItem>
        <DropdownMenuItem data-tour="help-entry" onClick={() => nav('/help')}>
          <BookOpen className="size-4" /> 帮助中心
        </DropdownMenuItem>
        {user?.isSuperAdmin && (
          <DropdownMenuItem onClick={() => nav('/admin')}>
            <ShieldCheck className="size-4" /> 邀请码管理
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setReplayOpen(true)}>
          <Sparkles className="size-4" /> 重看新手导览
        </DropdownMenuItem>
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
  );

  const activityControls: ActivityShellControls | undefined = id
    ? { brand: brand(), switcher, theme, profile: profile(true) }
    : undefined;

  return (
    <div className={`editorial-shell min-h-dvh bg-background ${id ? 'editorial-workspace' : ''} ${pathname === '/help' ? '' : 'editorial'}`}>
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-2">跳到主要内容</a>
      {!isOnsite && (
        <header className={`sticky top-0 z-40 border-b bg-background ${id ? 'md:hidden' : ''}`}>
          <div className={`mx-auto flex w-full max-w-[67.5rem] items-center gap-2 px-4 py-1 ${id ? 'min-h-[3.25rem]' : 'min-h-14'}`}>
            {brand(Boolean(id))}
            {id && switcher}
            {!id && <span className="flex-1" />}
            {!id && <div className="hidden md:block">{theme}</div>}
            {profile(Boolean(id))}
          </div>
        </header>
      )}
      <main id="main-content" tabIndex={-1} className={id ? 'min-w-0 outline-none md:ml-[14.25rem]' : 'outline-none'}>
        <div className={id
          ? 'mx-auto w-full max-w-[60rem] px-4 py-5 md:px-8 md:py-8 lg:px-10'
          : isOnsite ? 'mx-auto w-full max-w-[40rem] px-4 py-4' : 'mx-auto w-full max-w-[67.5rem] px-4 py-6 md:px-8 md:py-8'}>
          <DemoBanner />
          <TrialBanner />
          <PushBanner />
          <Outlet context={activityControls} />
        </div>
      </main>
      <OnboardingDialog
        open={replayOpen}
        onSkip={() => setReplayOpen(false)}
        onStartTour={() => {
          setReplayOpen(false);
          void startTour({ nav, projectId: id });
        }}
      />
    </div>
  );
}
