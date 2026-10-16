import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  Download,
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
import { toast } from 'sonner';
import { api } from '../api/client';
import { usePwaInstall } from '../lib/pwaInstall';
import PwaInstallGuide from '../components/PwaInstallGuide';
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
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const pwa = usePwaInstall();

  /** 「更多」里的安装入口：可弹原生框直接弹（Android/桌面 Chromium）；否则关 Sheet 开手动指引 */
  const installApp = async () => {
    setMoreOpen(false);
    if (pwa.canPrompt) {
      const outcome = await pwa.promptInstall();
      if (outcome === 'accepted') toast.success('已安装，可从主屏幕/应用列表直接打开 ANON');
      // dismissed：入口保留在「更多」，再点出手动指引
    } else {
      setInstallGuideOpen(true);
    }
  };

  const handleNavigate = useCallback(
    (targetTab: string) => {
      setTab(targetTab as (typeof TABS)[number]['key']);
    },
    [setTab],
  );

  const load = useCallback(async () => {
    const d = await api<Detail>(`/api/projects/${id}`);
    setDetail((current) => current?.project.id === id ? d : current);
  }, [id]);

  useEffect(() => {
    let alive = true;
    setErr('');
    setDetail(null);
    api<Detail>(`/api/projects/${id}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [id]);

  if (err)
    return (
      <Card className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">{err}</p>
        <Button variant="outline" onClick={() => nav('/projects')}>返回项目列表</Button>
      </Card>
    );
  if (!detail || detail.project.id !== id)
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
        <nav aria-label="项目功能" data-tour="tab-nav" className="sticky top-18 space-y-1 rounded-xl border bg-card p-2 shadow-sm">
          <p className="px-3 py-2 text-xs font-medium text-muted-foreground">工作空间</p>
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              aria-current={activeTab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${activeTab === t.key ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <t.icon className="size-4" aria-hidden="true" />
              {t.label}
              {activeTab === t.key && <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-primary" />}
            </button>
          ))}
          <Button variant="outline" className="mt-3 min-h-11 w-full justify-start" onClick={() => nav(`/p/${id}/onsite`)}>
            <Smartphone className="size-4" /> 现场模式
          </Button>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
      <div className="mb-5 space-y-2 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
        <p className="text-xs text-muted-foreground">项目空间 <span aria-hidden="true" className="px-1">/</span> {visibleTabs.find((t) => t.key === activeTab)?.label}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">{detail.project.name}</h1>
          <Badge variant="secondary" className="shrink-0">{detail.myRole}</Badge>
        </div>
        {detail.project.description && <p className="line-clamp-2 break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{detail.project.description}</p>}
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
      <nav aria-label="项目导航" data-tour="mobile-tab-nav" className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-sm backdrop-blur md:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${mainTabs.length + (moreTabs.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {mainTabs.map((t) => (
            <button
              key={t.key}
              aria-current={activeTab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activeTab === t.key ? 'font-medium text-primary' : 'text-muted-foreground'}`}
            >
              <span className={`rounded-lg px-4 py-1 ${activeTab === t.key ? 'bg-primary/10' : ''}`}><t.icon className="size-5" aria-hidden="true" /></span>
              {t.label}
            </button>
          ))}
          {moreTabs.length > 0 && (
            <button
              aria-label="更多项目功能"
              aria-expanded={moreOpen}
              aria-current={moreTabs.some((t) => t.key === activeTab) ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${moreTabs.some((t) => t.key === activeTab) ? 'font-medium text-primary' : 'text-muted-foreground'}`}
            >
              <span className={`rounded-lg px-4 py-1 ${moreTabs.some((t) => t.key === activeTab) ? 'bg-primary/10' : ''}`}><MoreHorizontal className="size-5" aria-hidden="true" /></span>
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
            {pwa.available && (
              <Button variant="outline" className="justify-start" onClick={() => void installApp()}>
                <Download className="size-4" /> 安装应用
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {/* 安装指引弹层挂 Sheet 外：Sheet 关闭即卸载子树，弹层须由本层持有 */}
      <PwaInstallGuide open={installGuideOpen} onOpenChange={setInstallGuideOpen} />
    </div>
  );
}
