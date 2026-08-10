import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { useAuth } from '../../../auth';
import type { StageSignupItem } from '../../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 形如 /api/projects/:pid/stage-signups/:sid */
  base: string;
  item: StageSignupItem | null;
  onSaved: () => void;
}

/** 投票表单：赞成/反对 + 文字意见；已有本人投票时预填并可撤回 */
export default function SignupReviewDialog({ open, onOpenChange, base, item, onSaved }: Props) {
  const { user } = useAuth();
  const myReview = item?.reviews.find((r) => r.userId === user?.id) ?? null;
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDecision(myReview?.decision ?? 'approve');
    setComment(myReview?.comment ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id]);

  if (!item) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api(`${base}/items/${item.id}/review`, { method: 'PUT', body: { decision, comment: comment.trim() } });
      toast.success('投票已提交');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api(`${base}/items/${item.id}/review`, { method: 'DELETE' });
      toast.success('投票已撤回');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={`投票：${item.name}`}>
      <form className="space-y-4" onSubmit={submit}>
        <RadioGroup value={decision} onValueChange={(v) => setDecision(v as 'approve' | 'reject')}>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="review-approve" value="approve" />
            <Label htmlFor="review-approve">赞成通过</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="review-reject" value="reject" />
            <Label htmlFor="review-reject">不通过</Label>
          </div>
        </RadioGroup>
        <div className="space-y-1.5">
          <Label htmlFor="review-comment">意见</Label>
          <Textarea
            id="review-comment"
            placeholder="可选，如：档期没问题 / 与已有节目撞名"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {myReview && (
            <Button type="button" variant="outline" disabled={submitting} onClick={withdraw}>
              撤回投票
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={submitting}>
            {submitting ? '提交中…' : myReview ? '更新投票' : '提交投票'}
          </Button>
        </div>
      </form>
    </FormOverlay>
  );
}
