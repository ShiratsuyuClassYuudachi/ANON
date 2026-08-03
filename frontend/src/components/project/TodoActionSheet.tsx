import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  noteLabel: string;
  requireContent: boolean;
  submitLabel: string;
  onSubmit: (note: string, files: File[]) => Promise<void>;
}

/** 完成/提交进度共用弹层：备注 + 附件（chips 可逐个删除）。 */
export function TodoActionSheet({ open, onOpenChange, title, noteLabel, requireContent, submitLabel, onSubmit }: Props) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNote('');
      setFiles([]);
    }
  }, [open]);

  const empty = !note.trim() && files.length === 0;
  const disabled = submitting || (requireContent && empty);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(note.trim(), files);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="action-note">{noteLabel}</Label>
          <Textarea
            id="action-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="action-files">附件</Label>
          <Input
            id="action-files"
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files?.length) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
              e.target.value = '';
            }}
          />
        </div>
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
        {requireContent && empty && (
          <p className="text-xs text-muted-foreground">填写进度内容或选择附件</p>
        )}
        <Button type="submit" className="w-full" disabled={disabled}>
          {submitLabel}
        </Button>
      </form>
    </FormOverlay>
  );
}
