import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { KeyRound, MoreHorizontal, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { decryptWithPassphrase, encryptWithPassphrase } from '../../crypto';
import type { Member, PlatformAccountItem, ProjectDetail, Visibility } from '../../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FormOverlay } from '@/components/FormOverlay';
import { VisibilityPicker } from './VisibilityPicker';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

const PLATFORMS = ['QQ', '小红书', 'B站', '微博', '其他'];
const MODE_LABELS: Record<PlatformAccountItem['mode'], string> = {
  full: '完整账号',
  otp: '二步验证',
  contact: '联系人',
};

export default function AccountsTab({ project, members, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('accounts:manage');
  const roles = project.roles.map((r) => r.name);
  const [accounts, setAccounts] = useState<PlatformAccountItem[]>([]);
  const [err, setErr] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [form, setForm] = useState({ platform: 'QQ', account: '', mode: 'full' as PlatformAccountItem['mode'], password: '', passphrase: '', keySource: 'user' as 'user' | 'server', note: '' });
  const [vis, setVis] = useState<Visibility>({ userIds: [], roleNames: [] });
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealPass, setRevealPass] = useState('');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [editingVisId, setEditingVisId] = useState<string | null>(null);
  const [visDraft, setVisDraft] = useState<Visibility>({ userIds: [], roleNames: [] });
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformAccountItem | null>(null);

  const load = useCallback(async () => {
    const q = platformFilter ? `?platform=${encodeURIComponent(platformFilter)}` : '';
    const d = await api<{ accounts: PlatformAccountItem[] }>(`/api/projects/${project.id}/accounts${q}`);
    setAccounts(d.accounts);
  }, [project.id, platformFilter]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body: Record<string, unknown> = {
        platform: form.platform,
        account: form.account,
        mode: form.mode,
        note: form.note || undefined,
        visibility: vis,
      };
      if (form.mode === 'full') {
        if (!form.password) throw new Error('请填写密码');
        if (form.keySource === 'server') {
          body.cipherKeySource = 'server';
          body.password = form.password;
        } else {
          if (!form.passphrase) throw new Error('请设置保险库口令');
          body.passwordCipher = await encryptWithPassphrase(form.password, form.passphrase);
        }
      }
      await api(`/api/projects/${project.id}/accounts`, { body });
      setForm({ ...form, account: '', password: '', passphrase: '', note: '' });
      setVis({ userIds: [], roleNames: [] });
      setCreateOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const reveal = async (a: PlatformAccountItem) => {
    try {
      const d = await api<{ password?: string; cipher?: string }>(
        `/api/projects/${project.id}/accounts/${a.id}/reveal`,
        { method: 'POST', body: {} },
      );
      if (a.cipherKeySource === 'server') {
        setRevealed({ ...revealed, [a.id]: d.password! });
      } else {
        if (!revealPass) throw new Error('请输入保险库口令');
        setRevealed({ ...revealed, [a.id]: await decryptWithPassphrase(d.cipher!, revealPass) });
      }
      setRevealingId(null);
      setRevealPass('');
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const saveVisibility = async (id: string) => {
    try {
      await api(`/api/projects/${project.id}/accounts/${id}`, { method: 'PATCH', body: { visibility: visDraft } });
      setEditingVisId(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/projects/${project.id}/accounts/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const visText = (a: PlatformAccountItem) => {
    const { userIds, roleNames } = a.visibility;
    if (!userIds.length && !roleNames.length) return '全体成员';
    const names = userIds.map((id) => members.find((m) => m.userId === id)?.name ?? id);
    return [...names, ...roleNames.map((r) => `角色:${r}`)].join('、');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Select value={platformFilter || 'all'} onValueChange={(v) => setPlatformFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="平台" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部平台</SelectItem>
            {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 新建账号
          </Button>
        )}
      </div>

      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {accounts.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{a.account}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{a.platform}</Badge>
                  <Badge variant="outline">{MODE_LABELS[a.mode]}</Badge>
                  {a.hasPassword && (
                    <Badge variant="outline">{a.cipherKeySource === 'user' ? '浏览器加密' : '服务端加密'}</Badge>
                  )}
                </div>
              </div>
              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="更多操作"><MoreHorizontal className="size-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingVisId(a.id);
                        setVisDraft({ userIds: [...a.visibility.userIds], roleNames: [...a.visibility.roleNames] });
                      }}
                    >
                      可见范围
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(a)}>删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {a.addedBy ? `添加人：${a.addedBy.name}` : ''} 可见范围：{visText(a)}
            </p>
            {a.mode === 'otp' && a.addedBy && a.addedBy.contacts.length > 0 && (
              <p className="text-sm">
                索取验证码请联系：{a.addedBy.contacts.map((c) => `${c.platform} ${c.value}`).join('、')}
              </p>
            )}
            {a.note && <p className="text-sm">{a.note}</p>}
            {a.hasPassword && (
              revealed[a.id] !== undefined ? (
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-sm">{revealed[a.id]}</code>
                  <Button variant="ghost" size="sm" onClick={() => setRevealed((r) => { const n = { ...r }; delete n[a.id]; return n; })}>隐藏</Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (a.cipherKeySource === 'server' ? void reveal(a) : setRevealingId(a.id))}
                >
                  <KeyRound className="size-4" /> 查看密码
                </Button>
              )
            )}
            {canManage && editingVisId === a.id && (
              <div className="space-y-2 rounded-lg border p-3">
                <VisibilityPicker members={members} roles={roles} value={visDraft} onChange={setVisDraft} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveVisibility(a.id)}>保存</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingVisId(null)}>取消</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {!accounts.length && <p className="text-sm text-muted-foreground">暂无账号。</p>}

      <FormOverlay open={createOpen} onOpenChange={setCreateOpen} title="新建账号">
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label>平台</Label>
            <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="account-account">账号 / 联系方式</Label>
            <Input
              id="account-account"
              required
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>记录模式</Label>
            <RadioGroup
              value={form.mode}
              onValueChange={(v) => setForm({ ...form, mode: v as PlatformAccountItem['mode'] })}
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="full" id="mode-full" className="mt-0.5" />
                <div>
                  <Label htmlFor="mode-full" className="font-normal">完整账号</Label>
                  <p className="text-xs text-muted-foreground">账号 + 密码</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="otp" id="mode-otp" className="mt-0.5" />
                <div>
                  <Label htmlFor="mode-otp" className="font-normal">二步验证</Label>
                  <p className="text-xs text-muted-foreground">仅账号 + 添加人，便于索取验证码</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="contact" id="mode-contact" className="mt-0.5" />
                <div>
                  <Label htmlFor="mode-contact" className="font-normal">仅联系人</Label>
                  <p className="text-xs text-muted-foreground">仅记录联系方式</p>
                </div>
              </div>
            </RadioGroup>
          </div>
          {form.mode === 'full' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="account-password">密码</Label>
                <Input
                  id="account-password"
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>加密方式</Label>
                <RadioGroup
                  value={form.keySource}
                  onValueChange={(v) => setForm({ ...form, keySource: v as 'user' | 'server' })}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="user" id="ks-user" />
                    <Label htmlFor="ks-user" className="font-normal">浏览器端加密（推荐）</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="server" id="ks-server" />
                    <Label htmlFor="ks-server" className="font-normal">服务端密钥加密</Label>
                  </div>
                </RadioGroup>
              </div>
              {form.keySource === 'user' && (
                <div className="space-y-1.5">
                  <Label htmlFor="account-passphrase">保险库口令</Label>
                  <Input
                    id="account-passphrase"
                    type="password"
                    required
                    placeholder="服务端不存储，遗忘无法找回"
                    value={form.passphrase}
                    onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
                  />
                </div>
              )}
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="account-note">备注</Label>
            <Textarea
              id="account-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>可见范围</Label>
            <VisibilityPicker members={members} roles={roles} value={vis} onChange={setVis} />
          </div>
          <Button type="submit" className="w-full">创建</Button>
        </form>
      </FormOverlay>

      <Dialog open={!!revealingId} onOpenChange={(o) => { if (!o) { setRevealingId(null); setRevealPass(''); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>输入保险库口令</DialogTitle>
            <DialogDescription>密码在你的浏览器内解密，口令不会上传。</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const target = accounts.find((x) => x.id === revealingId);
              if (target) void reveal(target);
            }}
            className="space-y-3"
          >
            <Input type="password" autoFocus value={revealPass} onChange={(e) => setRevealPass(e.target.value)} />
            <Button type="submit" className="w-full">解密查看</Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账号「{deleteTarget?.account}」？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
