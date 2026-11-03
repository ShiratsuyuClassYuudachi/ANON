import { useState, type FormEvent } from 'react';
import { Link2, Pencil, Plus, Archive, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ExternalMember, Member } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  projectId: string; members: Member[]; externalMembers: ExternalMember[];
  canManage: boolean; onChanged: () => Promise<void>;
}

export default function ExternalMembersPanel({ projectId, members, externalMembers, canManage, onChanged }: Props) {
  const [editing, setEditing] = useState<ExternalMember | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', duty: '', contacts: [] as { platform: string; value: string }[] });
  const [linking, setLinking] = useState<ExternalMember | null>(null);
  const [targetUserId, setTargetUserId] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const open = (m: ExternalMember | 'new') => {
    setEditing(m);
    setForm(m === 'new' ? { name: '', duty: '', contacts: [] } : { name: m.name, duty: m.duty, contacts: m.contacts.map((c) => ({ ...c })) });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/external-members${editing === 'new' ? '' : `/${(editing as ExternalMember).id}`}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: form });
      setEditing(null);
      await onChanged();
      toast.success('成员档案已保存');
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  const archive = async (m: ExternalMember) => {
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/external-members/${m.id}`, { method: 'PATCH', body: { archived: !m.archivedAt } });
      await onChanged();
      toast.success(m.archivedAt ? '已恢复成员' : '已归档，历史任务继续保留');
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  const link = async (event: FormEvent) => {
    event.preventDefault();
    if (!targetUserId || !linking) return;
    setSaving(true);
    try {
      await api(`/api/projects/${projectId}/external-members/${linking.id}/link`, { body: { userId: targetUserId } });
      setLinking(null);
      await onChanged();
      toast.success('已关联，原有任务已由该账号接续');
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  const list = externalMembers.filter((m) => showHistory || (!m.archivedAt && !m.linkedUserId));
  return <>
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">未注册成员</CardTitle>
        {canManage && <Button size="sm" onClick={() => open('new')}><Plus className="size-4" />录入成员</Button>}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">无需账号即可录入岗位、联系方式并分配任务，由管理人员代更新进度。</p>
        <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>{showHistory ? '隐藏已归档和已关联档案' : '查看已归档和已关联档案'}</Button>
        {list.length === 0 && <p className="text-sm text-muted-foreground">暂无未注册成员</p>}
        {list.map((m) => <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3">
          <div className="min-w-0 flex-1 break-words">
            <p className="font-medium">{m.name} <Badge variant="outline">{m.linkedUserId ? '已关联账号' : '未注册'}</Badge>{m.archivedAt && <Badge variant="secondary" className="ml-1">已归档</Badge>}</p>
            {m.duty && <p className="mt-1 text-sm">岗位：{m.duty}</p>}
            {m.contacts.map((c, i) => <p key={i} className="text-sm text-muted-foreground">{c.platform}：{c.value}</p>)}
          </div>
          {canManage && <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="icon" aria-label={`编辑${m.name}`} onClick={() => open(m)}><Pencil className="size-4" /></Button>
            {!m.linkedUserId && <Button variant="ghost" size="icon" aria-label={`关联${m.name}的账号`} onClick={() => { setLinking(m); setTargetUserId(''); }}><Link2 className="size-4" /></Button>}
            <Button variant="ghost" size="icon" disabled={saving} aria-label={`${m.archivedAt ? '恢复' : '归档'}${m.name}`} onClick={() => archive(m)}>{m.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}</Button>
          </div>}
        </div>)}
      </CardContent>
    </Card>
    <FormOverlay open={!!editing} onOpenChange={(o) => !saving && !o && setEditing(null)} title={editing === 'new' ? '录入未注册成员' : '编辑成员档案'}>
      <form onSubmit={save} className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="external-name">姓名</Label><Input id="external-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="external-duty">岗位 / 分工</Label><Textarea id="external-duty" placeholder="如：检票、舞台协助（可后补）" value={form.duty} onChange={(e) => setForm({ ...form, duty: e.target.value })} /></div>
        <div className="space-y-2">
          <Label>联系方式（可后补）</Label>
          {form.contacts.map((c, i) => <div key={i} className="flex gap-2">
            <Input aria-label={`联系方式${i + 1}平台`} className="w-24 shrink-0" required list="external-contact-platforms" value={c.platform} onChange={(e) => setForm({ ...form, contacts: form.contacts.map((x, index) => index === i ? { ...x, platform: e.target.value } : x) })} />
            <Input aria-label={`联系方式${i + 1}内容`} className="min-w-0" required value={c.value} onChange={(e) => setForm({ ...form, contacts: form.contacts.map((x, index) => index === i ? { ...x, value: e.target.value } : x) })} />
            <Button type="button" variant="ghost" size="icon" aria-label="移除联系方式" onClick={() => setForm({ ...form, contacts: form.contacts.filter((_, index) => i !== index) })}><X className="size-4" /></Button>
          </div>)}
          <datalist id="external-contact-platforms">{['QQ', '微信', '电话', '邮箱'].map((x) => <option key={x} value={x} />)}</datalist>
          <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, contacts: [...form.contacts, { platform: 'QQ', value: '' }] })}><Plus className="size-4" />添加联系方式</Button>
        </div>
        <Button disabled={saving || !form.name.trim()} type="submit" className="w-full">{saving ? '保存中…' : '保存'}</Button>
      </form>
    </FormOverlay>
    <FormOverlay open={!!linking} onOpenChange={(o) => !saving && !o && setLinking(null)} title={`关联「${linking?.name ?? ''}」的账号`}>
      <form onSubmit={link} className="space-y-3">
        <p className="text-sm text-muted-foreground">选择对方已加入本项目的账号。原任务和现场状态会由该账号接续，岗位与联系方式保留在项目中。关联后不能改绑其他账号。</p>
        <Select value={targetUserId} onValueChange={setTargetUserId}><SelectTrigger><SelectValue placeholder="选择本项目账号" /></SelectTrigger><SelectContent>{members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}（{m.email}）</SelectItem>)}</SelectContent></Select>
        <Button type="submit" className="w-full" disabled={saving || !targetUserId}>{saving ? '关联中…' : '确认关联'}</Button>
      </form>
    </FormOverlay>
  </>;
}
