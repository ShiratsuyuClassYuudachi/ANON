import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import type { StageRundownItem } from '../../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 形如 /api/projects/:pid/stage-rundowns/:rid */
  base: string;
  /** 传入则为编辑，否则为新建 */
  item?: StageRundownItem | null;
  onSaved: () => void;
}

interface ParticipantRow {
  cn: string;
  contact: string;
}

/** 节目新建/编辑表单（multipart：字段 + 素材文件） */
export default function ProgramFormDialog({ open, onOpenChange, base, item, onSaved }: Props) {
  const [name, setName] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [note, setNote] = useState('');
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setDurationMin(item ? String(item.durationMin) : '');
    setNote(item?.note ?? '');
    setParticipants(item?.participants.map((p) => ({ cn: p.cn, contact: p.contact })) ?? []);
    setFiles([]);
    setRemoveIds([]);
  }, [open, item]);

  const keptAttachments = (item?.attachments ?? []).filter((a) => !removeIds.includes(a.id));

  const setParticipant = (i: number, patch: Partial<ParticipantRow>) =>
    setParticipants((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('durationMin', durationMin);
      fd.append(
        'participants',
        JSON.stringify(participants.map((p) => ({ cn: p.cn.trim(), contact: p.contact.trim() })).filter((p) => p.cn)),
      );
      fd.append('note', note.trim());
      for (const f of files) fd.append('files', f);
      if (item) fd.append('removeAttachmentIds', JSON.stringify(removeIds));
      await api(item ? `${base}/items/${item.id}` : `${base}/items`, { method: item ? 'PATCH' : 'POST', formData: fd });
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
          <Label htmlFor="program-name">节目名称</Label>
          <Input id="program-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="program-duration">时长（分钟）</Label>
          <Input
            id="program-duration"
            type="number"
            min={1}
            max={1440}
            required
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="program-note">备注</Label>
          <Input id="program-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label>参与者</Label>
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
            <Plus className="size-4" /> 添加参与者
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="program-files">素材文件</Label>
          {keptAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {keptAttachments.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs">
                  {a.filename}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setRemoveIds((prev) => [...prev, a.id])}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Input
            id="program-files"
            type="file"
            multiple
            onChange={(e) => {
              // FileList 在重置 input 前同步取出，避免 updater 延迟执行时读到空列表
              const picked = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (picked.length) setFiles((prev) => [...prev, ...picked]);
            }}
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs">
                  {f.name}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? '提交中…' : item ? '保存' : '添加'}
        </Button>
      </form>
    </FormOverlay>
  );
}
