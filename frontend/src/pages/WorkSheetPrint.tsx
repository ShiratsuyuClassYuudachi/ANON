import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ExternalMember, Member, WorkModuleItem, WorkSheetData } from '../types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { fmtLocal } from '@/lib/datetime';

const fmt = (iso: string | null) => (iso ? fmtLocal(iso, true) : '');

interface Detail {
  project: { id: string; name: string };
  members: Member[];
  externalMembers?: ExternalMember[];
  myPermissions: string[];
}

export default function WorkSheetPrint() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const userParam = sp.get('user') ?? 'me';

  const [sheets, setSheets] = useState<WorkSheetData[] | null>(null);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      if (userParam === 'all') {
        const [mods, detail] = await Promise.all([
          api<{ modules: WorkModuleItem[] }>(`/api/projects/${id}/work-modules`),
          api<Detail>(`/api/projects/${id}`),
        ]);
        // 批量打印入口需 work:manage（project:manage 等价放行）
        if (!detail.myPermissions.includes('project:manage') && !detail.myPermissions.includes('work:manage')) {
          setErr('需要现场排班管理权限才能批量打印全员排班单');
          return;
        }
        const generatedAt = new Date().toISOString();
        const grouped = new Map<string, WorkModuleItem[]>();
        for (const m of mods.modules) {
          for (const a of m.externalAssignees ?? []) {
            const key = `external:${a.externalMemberId}`;
            grouped.set(key, [...(grouped.get(key) ?? []), m]);
          }
          for (const a of m.assignees) {
            grouped.set(a.userId, [...(grouped.get(a.userId) ?? []), m]);
          }
        }
        setSheets(
          [...detail.members, ...(detail.externalMembers ?? []).filter((m) => !m.linkedUserId || !detail.members.some((u) => u.userId === m.linkedUserId)).map((m) => ({ userId: `external:${m.id}`, name: m.name, externalMemberId: m.id }))]
            .filter((mb) => grouped.has(mb.userId))
            .map((mb) => ({
              project: detail.project,
              user: { id: mb.userId, name: mb.name, ...('externalMemberId' in mb ? { externalMemberId: String(mb.externalMemberId) } : {}) },
              generatedAt,
              items: grouped.get(mb.userId)!,
            })),
        );
        setUnassigned([...detail.members.filter((mb) => !grouped.has(mb.userId)).map((mb) => mb.name), ...(detail.externalMembers ?? []).filter((m) => !m.archivedAt && !m.linkedUserId && !grouped.has(`external:${m.id}`)).map((m) => `${m.name}（未注册）`)]);
      } else {
        const path =
          userParam === 'me'
            ? `/api/projects/${id}/work-sheet`
            : userParam.startsWith('external:') ? `/api/projects/${id}/work-sheet/external/${userParam.slice(9)}` : `/api/projects/${id}/work-sheet/${userParam}`;
        const d = await api<WorkSheetData>(path);
        setSheets([d]);
      }
    })().catch((e) => setErr((e as Error).message));
  }, [id, userParam]);

  if (err) return <p className="p-6 text-sm text-destructive">{err}</p>;
  if (!sheets)
    return (
      <div className="mx-auto max-w-[210mm] space-y-3 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  return (
    <div className="editorial min-h-dvh bg-background print:bg-white print:text-black">
      <div className="mx-auto max-w-[210mm] p-4 md:p-6 print:p-0">
        {/* 工具栏：打印时隐藏 */}
        <div className="mb-4 flex items-center gap-2 print:hidden">
          <Button variant="ghost" size="sm" onClick={() => nav(-1)}>
            <ArrowLeft className="size-4" /> 返回
          </Button>
          <span className="flex-1" />
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="size-4" /> 打印 / 导出 PDF
          </Button>
        </div>

        {sheets.length === 0 && <p className="text-sm text-muted-foreground">当前没有可打印的排班记录</p>}

        {sheets.map((s) => (
          <section key={s.user.id} className="sheet-page mb-6 rounded-lg border bg-card p-6 print:mb-0 print:rounded-none print:border-0 print:p-0">
            <header className="mb-4 border-b pb-3">
              <h1 className="text-xl font-bold">{s.project.name} · 现场排班单</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                姓名：<span className="font-medium text-foreground">{s.user.name}</span>
                <span className="mx-2">｜</span>生成时间：{fmt(s.generatedAt)}
              </p>
            </header>
            <table className="w-full table-fixed border-collapse text-sm wrap-anywhere">
              <colgroup>
                <col className="w-[17%]" />
                <col className="w-[23%]" />
                <col className="w-[15%]" />
                <col className="w-[29%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr>
                  {['岗位', '时间', '地点', '工作内容', '确认状态'].map((h) => (
                    <th key={h} className="border px-2 py-1.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.items.length === 0 && (
                  <tr><td colSpan={5} className="border px-2 py-4 text-center text-muted-foreground">暂无排班</td></tr>
                )}
                {s.items.map((m) => (
                  <tr key={m.id}>
                    <td className="border px-2 py-1.5 font-medium">{m.name}</td>
                    <td className="border px-2 py-1.5">
                      {m.startAt || m.endAt ? `${fmt(m.startAt) || '…'} ~ ${fmt(m.endAt) || '…'}` : '—'}
                    </td>
                    <td className="border px-2 py-1.5">{m.location || '—'}</td>
                    <td className="border px-2 py-1.5">{m.description || '—'}</td>
                    <td className="border px-2 py-1.5">
                      {(s.user.externalMemberId ? m.externalAssignees?.find((a) => a.externalMemberId === s.user.externalMemberId) : m.assignees.find((a) => a.userId === s.user.id))?.confirmedAt
                        ? `已确认 ${fmt((s.user.externalMemberId ? m.externalAssignees?.find((a) => a.externalMemberId === s.user.externalMemberId) : m.assignees.find((a) => a.userId === s.user.id))!.confirmedAt)}`
                        : '待确认'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <footer className="mt-6 flex flex-wrap gap-x-12 gap-y-3 text-sm">
              <p>本人签字：＿＿＿＿＿＿＿＿</p>
              <p>日期：＿＿＿＿＿＿＿＿</p>
            </footer>
          </section>
        ))}

        {userParam === 'all' && unassigned.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground print:hidden">
            尚未安排岗位成员：{unassigned.join('、')}
          </p>
        )}
      </div>

      {/* 打印版式：每张任务单分页 */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .sheet-page { page-break-after: always; }
          .sheet-page:last-of-type { page-break-after: auto; }
          .sheet-page, .sheet-page * { color: #000; background: #fff; border-color: #666; }
          .sheet-page tr { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
