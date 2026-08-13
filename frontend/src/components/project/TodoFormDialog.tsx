import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { daysBeforeLocal } from '../../lib/datetime';
import type { Member, TodoItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** 项目开展日期 ISO；为 null 时日期字段不显示「开展倒排」开关 */
  startDate: string | null;
  members: Member[];
  knownCategories: string[];
  /** 完整 TodoItem = 编辑模式；{ title } = 创建模式（可预填标题） */
  initial?: TodoItem | { title: string };
  onSaved: () => Promise<void>;
}

interface TodoDateFieldProps {
  id: string;
  label: string;
  /** datetime-local 值，仍由外层 useState 持有；倒排模式下换算结果直接写回同一 value */
  value: string;
  onChange: (v: string) => void;
  startDate: string | null;
}

/** 日期字段：默认绝对时间录入；startDate 非空时可切「开展倒排」（开展前 N 天 + 时刻），换算结果实时写回 value，
 *  保存后与普通绝对日期走同一提交链路。子状态随 Dialog 关闭卸载，无需显式 reset。 */
function TodoDateField({ id, label, value, onChange, startDate }: TodoDateFieldProps) {
  const [rel, setRel] = useState(false);
  const [days, setDays] = useState('1');
  const [time, setTime] = useState('12:00');

  /** days 允许输入中暂为空串，换算时按 0 处理 */
  const applyRel = (d: string, t: string) => {
    if (!startDate) return;
    onChange(daysBeforeLocal(startDate, parseInt(d) || 0, t));
  };

  const onToggle = (on: boolean) => {
    setRel(on);
    if (on) {
      const t = value ? value.slice(11, 16) : '12:00';
      setDays('1');
      setTime(t);
      if (startDate) onChange(daysBeforeLocal(startDate, 1, t));
    }
    // 关闭倒排：当前换算值保留在 datetime-local 中可继续手改
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {startDate && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            开展倒排
            <Switch checked={rel} onCheckedChange={onToggle} />
          </label>
        )}
      </div>
      {!rel ? (
        <Input
          id={id}
          type="datetime-local"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            开展前
            <Input
              id={id}
              type="number"
              min={0}
              max={3650}
              step={1}
              className="w-20"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                applyRel(e.target.value, time);
              }}
            />
            天
            <Input
              type="time"
              className="w-28"
              aria-label="时刻"
              value={time}
              onChange={(e) => {
                setTime(e.target.value);
                applyRel(days, e.target.value);
              }}
            />
          </div>
          {value && <p className="text-xs text-muted-foreground">= {value.replace('T', ' ')}</p>}
        </div>
      )}
    </div>
  );
}

function toIso(v: string): string | undefined {
  return v ? new Date(v).toISOString() : undefined;
}

/** ISO → datetime-local 输入值（本地时区） */
function toLocalInput(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isEdit(initial?: TodoItem | { title: string }): initial is TodoItem {
  return !!initial && 'id' in initial;
}

export function TodoFormDialog({ open, onOpenChange, projectId, startDate, members, knownCategories, initial, onSaved }: Props) {
  const editTarget = isEdit(initial) ? initial : null;
  const [title, setTitle] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [nodeAt, setNodeAt] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [note, setNote] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(editTarget?.title ?? initial?.title ?? '');
    setAssigneeIds(editTarget ? editTarget.assignees.map((a) => a.userId) : []);
    setCategory(editTarget?.category ?? '');
    setNodeAt(toLocalInput(editTarget?.nodeAt));
    setDueAt(toLocalInput(editTarget?.dueAt));
    setRemindAt(toLocalInput(editTarget?.remindAt));
    setNote(editTarget?.note ?? '');
    setMoreOpen(!!editTarget && (!!editTarget.category || !!editTarget.nodeAt || !!editTarget.remindAt || !!editTarget.note));
  }, [open, initial, editTarget]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = editTarget
        ? {
            title: title.trim(),
            assigneeIds,
            category: category.trim(),
            note: note.trim(),
            nodeAt: nodeAt ? new Date(nodeAt).toISOString() : '',
            dueAt: dueAt ? new Date(dueAt).toISOString() : '',
            remindAt: remindAt ? new Date(remindAt).toISOString() : '',
          }
        : {
            title: title.trim(),
            assigneeIds,
            category: category.trim() || undefined,
            note: note.trim() || undefined,
            nodeAt: toIso(nodeAt),
            dueAt: toIso(dueAt),
            remindAt: toIso(remindAt),
          };
      if (editTarget) {
        await api(`/api/projects/${projectId}/todos/${editTarget.id}`, { method: 'PATCH', body });
      } else {
        await api(`/api/projects/${projectId}/todos`, { body });
      }
      toast.success(editTarget ? '已保存' : '已创建');
      onOpenChange(false);
      await onSaved();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={editTarget ? '编辑待办' : '新建待办'}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="todo-form-title">标题</Label>
          <Input
            id="todo-form-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>指派人</Label>
          <div className="flex flex-wrap gap-1.5">
            {members.map((m) => (
              <label
                key={m.userId}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                  assigneeIds.includes(m.userId)
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'border-border text-muted-foreground'
                }`}
              >
                <Checkbox
                  checked={assigneeIds.includes(m.userId)}
                  onCheckedChange={(c) =>
                    setAssigneeIds(c ? [...assigneeIds, m.userId] : assigneeIds.filter((x) => x !== m.userId))
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
        </div>
        <TodoDateField id="todo-form-due" label="到期时间" value={dueAt} onChange={setDueAt} startDate={startDate} />

        <button
          type="button"
          className="flex w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <ChevronDown className={`size-4 transition-transform ${moreOpen ? '' : '-rotate-90'}`} />
          更多字段
        </button>
        {moreOpen && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="todo-form-category">类别</Label>
              <Input
                id="todo-form-category"
                placeholder="如 美工/宣发"
                list="todo-form-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="todo-form-categories">
                {knownCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <TodoDateField id="todo-form-node" label="节点时间" value={nodeAt} onChange={setNodeAt} startDate={startDate} />
            <TodoDateField id="todo-form-remind" label="提醒时间" value={remindAt} onChange={setRemindAt} startDate={startDate} />
            <div className="space-y-1.5">
              <Label htmlFor="todo-form-note">备注</Label>
              <Textarea
                id="todo-form-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        )}
        <Button type="submit" className="w-full" disabled={saving}>
          {editTarget ? '保存' : '创建'}
        </Button>
      </form>
    </FormOverlay>
  );
}
