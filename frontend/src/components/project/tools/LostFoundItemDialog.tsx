import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { toLocalInput } from '../../../lib/datetime';
import type { LostFoundItem } from '../../../types';
import AuthImg from '../../AuthImg';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 形如 /api/projects/:pid/lostfound */
  base: string;
  /** 传入则为编辑，否则为登记 */
  item?: LostFoundItem | null;
  onSaved: () => void;
}

/** 失物登记/编辑表单（multipart：字段 + 单张照片） */
export default function LostFoundItemDialog({ open, onOpenChange, base, item, onSaved }: Props) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [foundAt, setFoundAt] = useState('');
  const [foundLocation, setFoundLocation] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setNote(item?.note ?? '');
    setFoundAt(item ? toLocalInput(item.foundAt) : toLocalInput(new Date().toISOString()));
    setFoundLocation(item?.foundLocation ?? '');
    setPhoto(null);
    setRemovePhoto(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, item]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('note', note.trim());
      if (foundAt) fd.append('foundAt', new Date(foundAt).toISOString());
      fd.append('foundLocation', foundLocation.trim());
      if (photo) fd.append('photo', photo);
      if (item && removePhoto) fd.append('removePhoto', '1');
      await api(item ? `${base}/${item.id}` : base, { method: item ? 'PATCH' : 'POST', formData: fd });
      toast.success(item ? '物品已更新' : '物品已登记');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormOverlay open={open} onOpenChange={onOpenChange} title={item ? '编辑物品' : '登记物品'}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="lf-name">物品名称</Label>
          <Input id="lf-name" required placeholder="如 黑色折叠伞" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-note">特征描述</Label>
          <Textarea
            id="lf-note"
            rows={2}
            placeholder="颜色、品牌、标识物等，便于失主核对"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-found-at">捡到时间</Label>
          <Input id="lf-found-at" type="datetime-local" required value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-location">捡到地点</Label>
          <Input id="lf-location" placeholder="如 A 馆入口服务台" value={foundLocation} onChange={(e) => setFoundLocation(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lf-photo">照片</Label>
          {item?.hasPhoto && !removePhoto && (
            <div className="flex items-center gap-3">
              <AuthImg src={`${base}/${item.id}/photo`} alt={item.name} style={{ height: 64, borderRadius: 6 }} />
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={removePhoto} onCheckedChange={(c) => setRemovePhoto(!!c)} />
                移除照片
              </label>
            </div>
          )}
          <Input
            id="lf-photo"
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">仅图片，≤20MB；列表与公开页展示自动生成的缩略图</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '提交中…' : item ? '保存' : '登记'}
          </Button>
        </div>
      </form>
    </FormOverlay>
  );
}
