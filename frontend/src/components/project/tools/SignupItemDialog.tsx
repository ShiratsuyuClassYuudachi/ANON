import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import type { StageSignupItem } from '../../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 形如 /api/projects/:pid/stage-signups/:sid */
  base: string;
  /** 传入则为编辑，否则为新建 */
  item?: StageSignupItem | null;
  onSaved: () => void;
}

interface ParticipantRow {
  cn: string;
  contact: string;
}

/** 报名节目新建/编辑表单（纯 JSON，无附件） */
export default function SignupItemDialog({ open, onOpenChange, base, item, onSaved }: Props) {
  const [name, setName] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [note, setNote] = useState('');
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setDurationMin(item ? String(item.durationMin) : '');
    setNote(item?.note ?? '');
    setParticipants(item?.participants.map((p) => ({ cn: p.cn, contact: p.contact })) ?? []);
  }, [open, item]);

  const setParticipant = (i: number, patch: Partial<ParticipantRow>) =>
    setParticipants((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        durationMin: Number(durationMin),
        participants: participants.map((p) => ({ cn: p.cn.trim(), contact: p.contact.trim() })).filter((p) => p.cn),
        note: note.trim(),
      };
      await api(item ? `${base}/items/${item.id}` : `${base}/items`, { method: item ? 'PATCH' : 'POST', body });
      toast.success(item ? '节目已更新' : '节目已添加');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={item ? '编辑节目' : '添加节目'}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="signup-item-name">节目名称</Label>
          <Input id="signup-item-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="signup-item-duration">时长（分钟）</Label>
          <Input
            id="signup-item-duration"
            type="number"
            min={1}
            max={1440}
            required
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>报名人</Label>
          {participants.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                placeholder="CN"
                value={p.cn}
                onChange={(e) => setParticipant(i, { cn: e.target.value })}
              />
              <Input
                placeholder="QQ / 微信 / 电话"
                value={p.contact}
                onChange={(e) => setParticipant(i, { contact: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setParticipants((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setParticipants((prev) => [...prev, { cn: '', contact: '' }])}
          >
            <Plus className="size-4" /> 添加报名人
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-item-note">备注</Label>
          <Textarea id="signup-item-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? '提交中…' : item ? '保存' : '添加'}
        </Button>
      </form>
    </FormOverlay>
  );
}
