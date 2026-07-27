import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ClipboardList,
  FolderOpen,
  KeyRound,
  ListTodo,
  MoreHorizontal,
  Settings,
  Shield,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '../api/client';
import AccountsTab from '../components/project/AccountsTab';
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
  { key: 'todos', label: '待办', icon: ListTodo },
  { key: 'finance', label: '财务', icon: Wallet },
  { key: 'materials', label: '物料', icon: FolderOpen },
  { key: 'accounts', label: '账号', icon: KeyRound },
  { key: 'work', label: '现场', icon: ClipboardList },
  { key: 'members', label: '成员', icon: Users },
  { key: 'roles', label: '角色', icon: Shield },
  { key: 'settings', label: '设置', icon: Settings },
] as const;

const MOBILE_MAIN = TABS.slice(0, 4); // 待办/财务/物料/账号
const MOBILE_MORE = TABS.slice(4); // 现场/成员/角色/设置

export default function ProjectHome() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('todos');
  const [err, setErr] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);

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

  return (
    <div className="pb-20 md:pb-0">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-xl font-semibold">{detail.project.name}</h2>
        <Badge variant="secondary">{detail.myRole}</Badge>
      </div>

      {/* 桌面端顶部标签 */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="hidden md:block">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Tab 内容 */}
      <div className="mt-3">
        {tab === 'todos' && (
          <TodosTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {tab === 'finance' && (
          <FinanceTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {tab === 'materials' && (
          <MaterialsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {tab === 'accounts' && (
          <AccountsTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {tab === 'work' && (
          <WorkTab project={detail.project} members={detail.members} myPermissions={detail.myPermissions} />
        )}
        {tab === 'members' && (
          <MembersTab
            project={detail.project}
            members={detail.members}
            myPermissions={detail.myPermissions}
            onChanged={load}
          />
        )}
        {tab === 'roles' && (
          <RolesTab project={detail.project} myPermissions={detail.myPermissions} onChanged={load} />
        )}
        {tab === 'settings' && (
          <SettingsTab project={detail.project} myPermissions={detail.myPermissions} onChanged={load} />
        )}
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
  );
}
