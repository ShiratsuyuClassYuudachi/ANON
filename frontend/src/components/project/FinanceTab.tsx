import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, downloadFile, getToken } from '../../api/client';
import { useAuth } from '../../auth';
import type { FinanceSummary, Member, ProjectDetail, TransactionItem } from '../../types';

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
      setErr('请选择付款人');
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
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const saveTicket = async () => {
    setErr('');
    try {
      await api(`/api/projects/${project.id}/finance/ticket`, {
        method: 'PATCH',
        body: { ticketPrice: ticketPrice || 0, ticketCount: Number(ticketCount || 0) },
      });
      await load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const exportCsv = async () => {
    setErr('');
    try {
      const q = canManage && exportUserId ? `?userId=${exportUserId}` : '';
      const res = await fetch(`/api/projects/${project.id}/finance/export${q}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('导出失败');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      const name = canManage && exportUserId
        ? (members.find((m) => m.userId === exportUserId)?.name ?? 'all')
        : (user?.name ?? 'me');
      a.href = url;
      a.download = `finance-${name}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  return (
    <div>
      {canManage && (
        <div className="card">
          <label className="field">门票设置</label>
          <div className="grid-2">
            <div>
              <label className="field">门票单价（元）</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={ticketPrice}
                onChange={(e) => setTicketPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="field">售票数量</label>
              <input
                type="number"
                min="0"
                value={ticketCount}
                onChange={(e) => setTicketCount(e.target.value)}
              />
            </div>
          </div>
          <button onClick={saveTicket}>保存门票设置</button>
          {summary && <p className="muted">门票收入：¥{yuan(summary.ticketIncomeCents)}（实时计入盈亏）</p>}
        </div>
      )}

      {canAdd && (
        <form className="card" onSubmit={create}>
          <label className="field">记一笔</label>
          <div className="grid-2">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'income' | 'expense' })}>
              <option value="expense">支出</option>
              <option value="income">收入</option>
            </select>
            <input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="金额（元）"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </div>
          <select value={form.payerUserId} onChange={(e) => setForm({ ...form, payerUserId: e.target.value })} required>
            <option value="">{form.type === 'expense' ? '付款人' : '收款人'}</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
          {form.type === 'expense' && (
            <div>
              <label className="field">参与平摊人（不选 = 全员）</label>
              <div className="row" style={{ marginBottom: 8 }}>
                {members.map((m) => (
                  <label key={m.userId} className="chip" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', margin: '0 4px 0 0' }}
                      checked={splitAmong.includes(m.userId)}
                      onChange={(e) =>
                        setSplitAmong(
                          e.target.checked ? [...splitAmong, m.userId] : splitAmong.filter((x) => x !== m.userId),
                        )
                      }
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <textarea placeholder="备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <input type="file" multiple onChange={(e) => setFiles(e.target.files)} />
          <button>保存账目</button>
        </form>
      )}

      {err && <p className="error">{err}</p>}

      {summary && (
        <div className="card">
          <label className="field">汇总</label>
          <div className="row">
            <span className="chip">门票收入 ¥{yuan(summary.ticketIncomeCents)}</span>
            <span className="chip">账目收入 ¥{yuan(summary.incomeCents)}</span>
            <span className="chip">账目支出 ¥{yuan(summary.expenseCents)}</span>
            <span className="chip">盈亏 {signed(summary.profitCents)}</span>
          </div>
          <label className="field">按人净额（实付 − 应摊，含盈亏均摊）</label>
          {summary.perUser.map((p) => (
            <div className="row" key={p.userId}>
              <span>{p.name}</span>
              <span className={p.netCents >= 0 ? '' : 'error'}>{signed(p.netCents)}</span>
            </div>
          ))}
          <label className="field">建议转账</label>
          {summary.settlement.length === 0 && <p className="muted">无需转账。</p>}
          {summary.settlement.map((s, i) => (
            <p key={i}>
              {s.from.name} → {s.to.name}：¥{yuan(s.amountCents)}
            </p>
          ))}
        </div>
      )}

      <div className="card">
        <label className="field">导出 CSV</label>
        <div className="row">
          {canManage && (
            <select value={exportUserId} onChange={(e) => setExportUserId(e.target.value)}>
              <option value="">我自己</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.name}</option>
              ))}
            </select>
          )}
          <button className="ghost" onClick={exportCsv}>{canManage ? '导出该成员账目' : '导出我的账目'}</button>
        </div>
      </div>

      {transactions.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <span className="chip">{t.type === 'income' ? '收入' : '支出'}</span>
            <strong>¥{yuan(t.amountCents)}</strong>
            <span className="muted">
              {t.type === 'income' ? '收款' : '付款'}：{t.payer.name}
            </span>
            {t.type === 'expense' && (
              <span className="muted">
                平摊：{t.splitAmong.length ? t.splitAmong.map((u) => u.name).join('、') : '全员'}
              </span>
            )}
          </div>
          {t.note && <p>{t.note}</p>}
          <div className="muted">
            添加人 {t.createdByName} ｜ {t.createdAt.slice(0, 16).replace('T', ' ')}
          </div>
          {t.attachments.length > 0 && (
            <div className="row">
              {t.attachments.map((a) => (
                <button key={a.id} className="ghost" onClick={() => downloadFile(a.id, a.filename)}>
                  {a.filename}
                </button>
              ))}
            </div>
          )}
          {(canManage || t.createdBy === user?.id) && (
            <button
              className="danger"
              onClick={async () => {
                if (!confirm('删除该账目？')) return;
                await api(`/api/projects/${project.id}/finance/${t.id}`, { method: 'DELETE' });
                await load();
              }}
            >
              删除
            </button>
          )}
        </div>
      ))}
      {!transactions.length && <p className="muted">暂无账目。</p>}
    </div>
  );
}
