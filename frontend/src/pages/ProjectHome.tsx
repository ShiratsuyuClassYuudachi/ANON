import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
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
import type { ExternalMember, Member, ProjectDetail } from '../types';
import type { ActivityShellControls } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

interface Detail {
  project: ProjectDetail;
  members: Member[];
  externalMembers?: ExternalMember[];
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

type SectionKey = (typeof TABS)[number]['key'];

const MOBILE_MAIN_KEYS: readonly SectionKey[] = ['dashboard', 'todos', 'finance', 'materials'];
const GROUPS: { label: string; keys: readonly SectionKey[] }[] = [
  { label: '总览与排期', keys: ['dashboard', 'todos'] },
  { label: '经费与物料', keys: ['finance', 'materials', 'accounts'] },
  { label: '现场与工具', keys: ['work', 'tools'] },
  { label: '团队与设置', keys: ['members', 'roles', 'settings'] },
];

function hasAny(p: string[], keys: string[]) {
  return keys.some((k) => p.includes(k));
}

export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const controls = useOutletContext<ActivityShellControls>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const setTab = useCallback(
    (key: (typeof TABS)[number]['key']) => setSearchParams({ tab: key }),
    [setSearchParams],
  );
  const [err, setErr] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
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
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-sm text-destructive">{err}</p>
        <Button variant="outline" onClick={() => nav('/projects')}>返回我的活动</Button>
      </div>
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
  const mainTabs = visibleTabs.filter((t) => MOBILE_MAIN_KEYS.includes(t.key));
  const moreTabs = visibleTabs.filter((t) => !MOBILE_MAIN_KEYS.includes(t.key));
  const activeTab = visibleTabs.some((t) => t.key === tabParam)
    ? (tabParam as (typeof TABS)[number]['key'])
    : (visibleTabs[0]?.key ?? 'todos');

  return (
    <div className="pb-[calc(5rem+env(safe-area-inset-bottom))] md:flex md:gap-6 md:pb-0">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[14.25rem] flex-col border-r bg-card md:flex">
        <div className="shrink-0 space-y-2 px-4 pt-3 pb-4">
          {controls.brand}
          {controls.switcher}
        </div>
        <nav aria-label="活动目录" data-tour="tab-nav" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
          {GROUPS.map(({ label, keys }) => {
            const items = visibleTabs.filter((tab) => keys.includes(tab.key));
            if (!items.length) return null;
            return (
              <div key={label}>
                <p className="px-2.5 pb-1 text-[0.6875rem] font-medium text-muted-foreground">{label}</p>
                {items.map((tab) => (
                  <Link
                    key={tab.key}
                    to={`?tab=${tab.key}`}
                    aria-current={activeTab === tab.key ? 'page' : undefined}
                    className={`flex min-h-8 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activeTab === tab.key ? 'bg-accent font-semibold text-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
                  >
                    <tab.icon className="size-4 shrink-0" aria-hidden="true" />
                    {tab.label}
                    {activeTab === tab.key && <span aria-hidden="true" className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" />}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="shrink-0 space-y-2 border-t px-3 py-3">
          <Button asChild variant="secondary" className="w-full justify-start">
            <Link to={`/p/${id}/onsite`}><Smartphone aria-hidden="true" /> 现场模式</Link>
          </Button>
          <div className="flex items-center justify-between gap-1">
            {controls.theme}
            {controls.profile}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {activeTab === 'dashboard' && (
          <DashboardTab
            project={detail.project}
            members={detail.members}
            myRole={detail.myRole}
            myPermissions={detail.myPermissions}
            onNavigate={handleNavigate}
          />
        )}
        {activeTab === 'todos' && (
          <TodosTab project={detail.project} externalMembers={detail.externalMembers ?? []} members={detail.members} myPermissions={detail.myPermissions} />
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
          <WorkTab project={detail.project} externalMembers={detail.externalMembers ?? []} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'tools' && (
          <ToolsTab project={detail.project} myPermissions={detail.myPermissions} />
        )}
        {activeTab === 'members' && (
          <MembersTab
            externalMembers={detail.externalMembers ?? []}
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
      <nav aria-label="活动快捷导航" data-tour="mobile-tab-nav" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${mainTabs.length + (moreTabs.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}
        >
          {mainTabs.map((t) => (
            <button
              key={t.key}
              aria-current={activeTab === t.key ? 'page' : undefined}
              onClick={() => setTab(t.key)}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${activeTab === t.key ? 'font-semibold text-accent-foreground' : 'text-muted-foreground'}`}
            >
              <span className={`rounded-lg px-2 py-1 ${activeTab === t.key ? 'bg-accent' : ''}`}><t.icon className="size-5" aria-hidden="true" /></span>
              {t.label}
            </button>
          ))}
          {moreTabs.length > 0 && (
            <button
              ref={moreButtonRef}
              aria-haspopup="dialog"
              aria-label="更多板块"
              aria-expanded={moreOpen}
              aria-current={moreTabs.some((t) => t.key === activeTab) ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
              className={`flex min-h-16 flex-col items-center justify-center gap-0.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${moreTabs.some((t) => t.key === activeTab) ? 'font-semibold text-accent-foreground' : 'text-muted-foreground'}`}
            >
              <span className={`rounded-lg px-2 py-1 ${moreTabs.some((t) => t.key === activeTab) ? 'bg-accent' : ''}`}><MoreHorizontal className="size-5" aria-hidden="true" /></span>
              更多
            </button>
          )}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); if (!installGuideOpen) moreButtonRef.current?.focus(); }}>
          <SheetHeader className="shrink-0">
            <SheetTitle>更多板块</SheetTitle>
          </SheetHeader>
          <div className="grid min-h-0 gap-2 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button
              variant="secondary"
              className="justify-start"
              onClick={() => {
                setMoreOpen(false);
                nav(`/p/${id}/onsite`);
              }}
            >
              <Smartphone className="size-4" /> 进入现场模式
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
                <Download className="size-4" /> 安装到主屏幕
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
