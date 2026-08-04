import { useEffect, useState } from 'react';
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
import { ModeToggle, StylePicker, useTheme } from '../theme';
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
  const { mode, style, toggleMode, setStyle } = useTheme();
  const [replayOpen, setReplayOpen] = useState(false);
  const id = useLocation().pathname.match(/^\/p\/([^/]+)/)?.[1];
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
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-4 md:max-w-5xl">
          <Link to="/projects" aria-label="返回项目列表" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          {current && (
            <>
              <button
                onClick={() => nav(`/p/${id}`)}
                aria-label="返回看板"
                title={current.name}
                className="min-w-0 max-w-40 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-muted md:max-w-56"
              >
                <span className="block truncate">{current.name}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="切换项目" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
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
                    <LayoutGrid className="size-4" /> 全部项目
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <span className="flex-1" />
          <div className="hidden items-center gap-2 md:flex" data-tour="theme-controls">
            <StylePicker />
            <ModeToggle />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button data-tour="user-menu" aria-label="用户菜单" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="size-8 ring-1 ring-border">
                  <AvatarFallback className="bg-primary/10 font-semibold text-primary">
                    {(user?.name ?? '?').slice(0, 1)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="md:hidden" onClick={() => setStyle(style === 'minimal' ? 'playful' : 'minimal')}>
                <Palette className="size-4" /> 界面风格：{style === 'minimal' ? '简洁' : '明快'}
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
                <BookOpen className="size-4" /> 帮助文档
              </DropdownMenuItem>
              {user?.isSuperAdmin && (
                <DropdownMenuItem onClick={() => nav('/admin')}>
                  <ShieldCheck className="size-4" /> 管理
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setReplayOpen(true)}>
                <Sparkles className="size-4" /> 重看引导
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
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-4 md:max-w-5xl">
        <DemoBanner />
        <TrialBanner />
        <PushBanner />
        <Outlet />
      </main>
      <OnboardingDialog
        open={replayOpen}
        onSkip={() => setReplayOpen(false)}
        onStartTour={() => {
          setReplayOpen(false);
          startTour(() => {});
        }}
      />
    </div>
  );
}
