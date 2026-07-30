import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ClipboardList,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  MoreHorizontal,
  Settings,
  Shield,
  Users,
  Wallet,
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
import WorkTab from '../components/project/WorkTab';
import type { Member, ProjectDetail } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  { key: 'members', label: '成员', icon: Users, visible: () => true },
  { key: 'roles', label: '角色', icon: Shield, visible: (p: string[]) => hasAny(p, ['project:manage', 'role:manage']) },
  { key: 'settings', label: '设置', icon: Settings, visible: (p: string[]) => p.includes('project:manage') },
] as const;

function hasAny(p: string[], keys: string[]) {
  return keys.some((k) => p.includes(k));
}

export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('dashboard');
  const [err, setErr] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

  const handleNavigate = useCallback((targetTab: string) => {
    setTab(targetTab as (typeof TABS)[number]['key']);
  }, []);

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
  const mainTabs = visibleTabs.slice(0, 4);
  const moreTabs = visibleTabs.slice(4);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key ?? 'todos');

  return (
    <div className="pb-20 md:pb-0">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl font-semibold">{detail.project.name}</h2>
        <Badge variant="secondary">{detail.myRole}</Badge>
      </div>

      {/* 桌面端顶部标签 */}
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as typeof tab)} className="hidden md:block">
        <TabsList>
          {visibleTabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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

      {/* 移动端底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
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
