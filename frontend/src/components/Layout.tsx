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
