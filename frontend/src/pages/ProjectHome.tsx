import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  MoreHorizontal,
  Settings,
  Shield,
  Smartphone,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { api } from '../api/client';
import AccountsTab from '../components/project/AccountsTab';
import DashboardTab from '../components/project/DashboardTab';
import FinanceTab from '../components/project/FinanceTab';
import MaterialsTab from '../components/project/MaterialsTab';
import MembersTab from '../components/project/MembersTab';
import RolesTab from '../components/project/RolesTab';
import SettingsTab from '../components/project/SettingsTab';
import TodosTab from '../components/project/TodosTab';
import ToolsTab from '../components/project/ToolsTab';
import WorkTab from '../components/project/WorkTab';
import type { Member, ProjectDetail } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

interface Detail {
  project: ProjectDetail;
  members: Member[];
  myRole: string;
  myPermissions: string[];
}

const TABS = [
  { key: 'dashboard', label: '看板', icon: LayoutDashboard, visible: () => true },
  { key: 'todos', label: '待办', icon: ListTodo, visible: () => true },
  { key: 'finance', label: '财务', icon: Wallet, visible: (p: string[]) => hasAny(p, ['project:manage', 'finance:manage', 'finance:add']) },
  { key: 'materials', label: '物料', icon: FolderOpen, visible: () => true },
  { key: 'accounts', label: '账号', icon: KeyRound, visible: () => true },
  { key: 'work', label: '现场', icon: ClipboardList, visible: () => true },
  { key: 'tools', label: '工具', icon: Wrench, visible: () => true },
  { key: 'members', label: '成员', icon: Users, visible: () => true },
  { key: 'roles', label: '角色', icon: Shield, visible: (p: string[]) => hasAny(p, ['project:manage', 'role:manage']) },
  { key: 'settings', label: '设置', icon: Settings, visible: (p: string[]) => p.includes('project:manage') },
] as const;

const MOBILE_MAIN_KEYS = ['todos', 'finance', 'materials'] as const;

function hasAny(p: string[], keys: string[]) {
  return keys.some((k) => p.includes(k));
}

export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const setTab = useCallback(
    (key: (typeof TABS)[number]['key']) => setSearchParams({ tab: key }),
    [setSearchParams],
  );
  const [err, setErr] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const handleNavigate = useCallback(
    (targetTab: string) => {
      setTab(targetTab as (typeof TABS)[number]['key']);
    },
    [setTab],
  );

  const load = useCallback(async () => {
    const d = await api<Detail>(`/api/projects/${id}`);
    setDetail(d);
  }, [id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  if (err)
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">{err}</p>
        <Button variant="outline" onClick={() => nav('/projects')}>返回项目列表</Button>
      </Card>
    );
  if (!detail)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  // 按权限过滤可见 tab；当前 tab 不可见时渲染期回退到第一个可见 tab（免 useEffect）
  const visibleTabs = TABS.filter((t) => t.visible(detail.myPermissions));
  const mainTabs = visibleTabs.filter((t) => (MOBILE_MAIN_KEYS as readonly string[]).includes(t.key));
  const moreTabs = visibleTabs.filter((t) => !(MOBILE_MAIN_KEYS as readonly string[]).includes(t.key));
  const activeTab = visibleTabs.some((t) => t.key === tabParam)
    ? (tabParam as (typeof TABS)[number]['key'])
    : (visibleTabs[0]?.key ?? 'todos');

  return (
    <div className="pb-20 md:flex md:gap-6 md:pb-0">
      <aside className="hidden md:block md:w-44 md:shrink-0">
        <div className="sticky top-18 space-y-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm ${activeTab === t.key ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <t.icon className="size-4" />
              {t.label}
            </button>
          ))}
          <Button variant="outline" className="mt-3 w-full justify-start" onClick={() => nav(`/p/${id}/onsite`)}>
            <Smartphone className="size-4" /> 现场模式
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl font-semibold">{detail.project.name}</h2>
        <Badge variant="secondary">{detail.myRole}</Badge>
      </div>

      {/* Tab 内容 */}
      <div className="mt-3">
        {activeTab === 'dashboard' && (
          <DashboardTab
            project={detail.project}
            members={detail.members}
            myPermissions={detail.myPermissions}
            onNavigate={handleNavigate}
          />
        )}
        {activeTab === 'todos' && (
          <TodosTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'finance' && (
          <FinanceTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'materials' && (
          <MaterialsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'accounts' && (
          <AccountsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'work' && (
          <WorkTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'tools' && (
          <ToolsTab project={detail.project} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'members' && (
          <MembersTab
            project={detail.project}
            members={detail.members}
            myPermissions={detail.myPermissions}
            onChanged={load}
          />
        )}
        {activeTab === 'roles' && (
          <RolesTab project={detail.project} myPermissions={detail.myPermissions} onChanged={load} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab project={detail.project} myPermissions={detail.myPermissions} onChanged={load} />
        )}
      </div>
      </div>

      {/* 移动端底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${mainTabs.length + (moreTabs.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {mainTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs ${activeTab === t.key ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <t.icon className="size-5" />
              {t.label}
            </button>
          ))}
          {moreTabs.length > 0 && (
            <button
              onClick={() => setMoreOpen(true)}
              className={`flex flex-col items-center gap-0.5 py-2 text-xs ${moreTabs.some((t) => t.key === activeTab) ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <MoreHorizontal className="size-5" />
              更多
            </button>
          )}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>更多</SheetTitle>
          </SheetHeader>
          <div className="grid gap-2 p-4">
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => {
                setMoreOpen(false);
                nav(`/p/${id}/onsite`);
              }}
            >
              <Smartphone className="size-4" /> 现场模式
            </Button>
            {moreTabs.map((t) => (
              <Button
                key={t.key}
                variant={activeTab === t.key ? 'secondary' : 'ghost'}
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
  );
}
