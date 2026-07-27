import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
  onChanged: () => Promise<void>;
}

function toDateInput(v: string | null): string {
  return v ? v.slice(0, 10) : '';
}

export default function SettingsTab({ project, myPermissions, onChanged }: Props) {
  const canManage = myPermissions.includes('project:manage');
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    startDate: toDateInput(project.startDate),
    endDate: toDateInput(project.endDate),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: {
          name: form.name,
          description: form.description,
          startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
          endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        },
      });
      await onChanged();
      toast.success('已保存');
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="settings-name">项目名称</Label>
            <Input
              id="settings-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-desc">描述</Label>
            <Textarea
              id="settings-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="settings-start">开始日期</Label>
              <Input
                id="settings-start"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-end">结束日期</Label>
              <Input
                id="settings-end"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
          </div>
          {canManage && <Button type="submit">保存</Button>}
        </form>
      </CardContent>
    </Card>
  );
}
