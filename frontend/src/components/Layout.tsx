import { useState } from 'react';
import { BookOpen, LogOut, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Logo from './Logo';
import DemoBanner from './DemoBanner';
import PushBanner from './PushBanner';
import TrialBanner from './TrialBanner';
import { OnboardingDialog } from './onboarding/OnboardingDialog';
import { startTour } from './onboarding/tour';
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
  const [replayOpen, setReplayOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-4 md:max-w-5xl">
          <Link to="/projects" aria-label="返回项目列表" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo />
          </Link>
          <span className="flex-1" />
          <div className="flex items-center gap-2" data-tour="theme-controls">
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
