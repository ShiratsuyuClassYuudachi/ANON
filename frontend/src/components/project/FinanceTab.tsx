import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Download, MoreHorizontal, Paperclip, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api, downloadFile, getToken } from '../../api/client';
import { useAuth } from '../../auth';
import type { FinanceSummary, Member, ProjectDetail, TransactionItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  members: Member[];
  myPermissions: string[];
}

function yuan(cents: number): string {
  return (cents / 100).toFixed(2);
}
function signed(cents: number): string {
  return `${cents >= 0 ? '+' : '−'}${yuan(Math.abs(cents))}`;
}

export default function FinanceTab({ project, members, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('finance:manage');
  const canAdd = canManage || myPermissions.includes('finance:add');
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ type: 'expense' as 'income' | 'expense', amount: '', note: '', payerUserId: '' });
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [ticketPrice, setTicketPrice] = useState('');
  const [ticketCount, setTicketCount] = useState('');
  const [exportUserId, setExportUserId] = useState('');
  const [ticketOpen, setTicketOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ transactions: TransactionItem[]; summary: FinanceSummary | null }>(
      `/api/projects/${project.id}/finance`,
    );
    setTransactions(d.transactions);
    setSummary(d.summary);
    if (d.summary) {
      setTicketPrice(yuan(d.summary.ticketPriceCents));
      setTicketCount(String(d.summary.ticketCount));
    }
  }, [project.id]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!form.payerUserId) {
      toast.error('请选择付款人');
      return;
    }
    try {
      const fd = new FormData();
      fd.set('type', form.type);
      fd.set('amount', form.amount);
      fd.set('note', form.note);
      fd.set('payerUserId', form.payerUserId);
      fd.set('splitAmong', JSON.stringify(splitAmong));
      if (files) for (const f of Array.from(files)) fd.append('files', f);
      await api(`/api/projects/${project.id}/finance`, { formData: fd });
      setForm({ type: 'expense', amount: '', note: '', payerUserId: '' });
      setSplitAmong([]);
      setFiles(null);
      setEntryOpen(false);
      toast.success('已记账');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const saveTicket = async () => {
    setErr('');
    try {
      await api(`/api/projects/${project.id}/finance/ticket`, {
        method: 'PATCH',
        body: { ticketPrice: ticketPrice || 0, ticketCount: Number(ticketCount || 0) },
      });
      setTicketOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const exportCsv = async () => {
    setErr('');
    try {
      const q = exportUserId ? `?userId=${exportUserId}` : '';
      const res = await fetch(`/api/projects/${project.id}/finance/export${q}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('导出失败');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      const name = exportUserId
        ? (members.find((m) => m.userId === exportUserId)?.name ?? 'all')
        : (user?.name ?? 'me');
      a.href = url;
      a.download = `finance-${name}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  const remove = async (txId: string) => {
    try {
      await api(`/api/projects/${project.id}/finance/${txId}`, { method: 'DELETE' });
      toast.success('已删除');
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">财务</h3>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setTicketOpen(true)}>门票设置</Button>
          )}
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}><Download className="size-4" /> 导出 CSV</Button>
          )}
          {canAdd && (
            <Button size="sm" onClick={() => setEntryOpen(true)}><Plus className="size-4" /> 记一笔</Button>
          )}
        </div>
      </div>

      {err && <Card className="p-4 text-sm text-destructive">{err}</Card>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: '门票收入', value: yuan(summary.ticketIncomeCents), cls: '' },
              { label: '记账收入', value: yuan(summary.incomeCents), cls: '' },
              { label: '总支出', value: yuan(summary.expenseCents), cls: '' },
              { label: '盈亏', value: signed(summary.profitCents), cls: summary.profitCents < 0 ? 'text-destructive' : 'text-green-600 dark:text-green-400' },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`mt-1 text-lg font-semibold tabular-nums ${s.cls}`}>¥{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">按人净额</CardTitle></CardHeader>
            <CardContent className="divide-y">
              {summary.perUser.map((u) => (
                <div key={u.userId} className="flex items-center justify-between py-2 text-sm">
                  <span>{u.name}</span>
                  <span className={`tabular-nums ${u.netCents < 0 ? 'text-destructive' : ''}`}>{signed(u.netCents)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">建议转账</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {summary.settlement.length === 0 ? (
                <p className="text-sm text-muted-foreground">无需转账</p>
              ) : (
                summary.settlement.map((s, i) => (
                  <p key={i} className="text-sm">
                    {s.from.name} <ArrowRight className="inline size-3.5" /> {s.to.name}：
                    <span className="font-medium tabular-nums">¥{yuan(s.amountCents)}</span>
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}

      {transactions.map((t) => (
        <Card key={t.id}>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {t.type === 'income' ? (
                  <Badge variant="outline" className="border-green-500 text-green-600 dark:text-green-400">收入</Badge>
                ) : (
                  <Badge variant="destructive">支出</Badge>
                )}
                <span className="font-semibold tabular-nums">¥{yuan(t.amountCents)}</span>
              </div>
              {(canManage || t.createdBy === user?.id) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onClick={() => setDeletingId(t.id)}>删除</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              <p>{t.type === 'income' ? '收款' : '付款'}：{t.payer.name}</p>
              {t.type === 'expense' && (
                <p>平摊：{t.splitAmong.length ? t.splitAmong.map((u) => u.name).join('、') : '全员'}</p>
              )}
              <p>添加人 {t.createdByName} ｜ {t.createdAt.slice(0, 10)}</p>
            </div>
            {t.note && <p className="text-sm">{t.note}</p>}
            {t.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.attachments.map((a) => (
                  <Button key={a.id} variant="outline" size="sm" onClick={() => downloadFile(a.id, a.filename)}>
                    <Paperclip className="size-3.5" /> {a.filename}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
      {!transactions.length && (
        <Card className="p-8 text-center text-sm text-muted-foreground">暂无账目。</Card>
      )}

      <FormOverlay open={ticketOpen} onOpenChange={setTicketOpen} title="门票设置">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-price">门票单价（元）</Label>
              <Input
                id="ticket-price"
                type="number"
                step="0.01"
                min="0"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-count">售票数量</Label>
              <Input
                id="ticket-count"
                type="number"
                min="0"
                value={ticketCount}
                onChange={(e) => setTicketCount(e.target.value)}
              />
            </div>
          </div>
          {summary && <p className="text-sm text-muted-foreground">门票收入：¥{yuan(summary.ticketIncomeCents)}（实时计入盈亏）</p>}
          <Button className="w-full" onClick={saveTicket}>保存门票设置</Button>
        </div>
      </FormOverlay>

      <FormOverlay open={exportOpen} onOpenChange={setExportOpen} title="导出 CSV">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>成员</Label>
            <Select value={exportUserId || 'me'} onValueChange={(v) => setExportUserId(v === 'me' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="me">我自己</SelectItem>
                {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={exportCsv}>导出该成员账目</Button>
        </div>
      </FormOverlay>

      <FormOverlay open={entryOpen} onOpenChange={setEntryOpen} title="记一笔">
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as 'income' | 'expense' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">支出</SelectItem>
                  <SelectItem value="income">收入</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-amount">金额（元）</Label>
              <Input
                id="entry-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="金额（元）"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{form.type === 'expense' ? '付款人' : '收款人'}</Label>
            <Select value={form.payerUserId} onValueChange={(v) => setForm({ ...form, payerUserId: v })}>
              <SelectTrigger><SelectValue placeholder={form.type === 'expense' ? '付款人' : '收款人'} /></SelectTrigger>
              <SelectContent>
                {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {form.type === 'expense' && (
            <div className="space-y-1.5">
              <Label>参与平摊人（不选 = 全员）</Label>
              <div className="flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <label
                    key={m.userId}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                      splitAmong.includes(m.userId)
                        ? 'border-primary bg-accent text-accent-foreground'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    <Checkbox
                      checked={splitAmong.includes(m.userId)}
                      onCheckedChange={(c) =>
                        setSplitAmong(c ? [...splitAmong, m.userId] : splitAmong.filter((x) => x !== m.userId))
                      }
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="entry-note">备注</Label>
            <Textarea
              id="entry-note"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entry-files">凭证</Label>
            {/* shadcn Input 不转发 ref（React 18），文件选择用原生 input 加 Input 同款类名 */}
            <input
              id="entry-files"
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground dark:bg-input/30"
            />
          </div>
          <Button type="submit" className="w-full">保存账目</Button>
        </form>
      </FormOverlay>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除账目？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingId) void remove(deletingId);
                setDeletingId(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
