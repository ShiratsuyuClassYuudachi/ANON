import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import type { LostFoundItem } from '../../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  base: string;
  item: LostFoundItem | null;
  onSaved: () => void;
}

/** 标记认领：认领备注（认领人/联系方式）仅项目内可见 */
export default function LostFoundClaimDialog({ open, onOpenChange, base, item, onSaved }: Props) {
  const [claimNote, setClaimNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setClaimNote(item?.claimNote ?? '');
  }, [open, item]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!item || submitting) return;
    setSubmitting(true);
    try {
      await api(`${base}/${item.id}/status`, { method: 'PATCH', body: { status: 'claimed', claimNote: claimNote.trim() } });
      toast.success('已标记为认领');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={`标记认领：${item?.name ?? ''}`}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="lf-claim-note">认领备注</Label>
          <Textarea
            id="lf-claim-note"
            rows={2}
            placeholder="认领人、联系方式等（仅项目内可见，公开页不展示）"
            value={claimNote}
            onChange={(e) => setClaimNote(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '提交中…' : '确认认领'}
          </Button>
        </div>
      </form>
    </FormOverlay>
  );
}
