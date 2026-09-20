import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ProjectDetail } from '../../types';
import { StageManager } from './StageManager';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListRow } from '@/components/ui/list-row';
import { Textarea } from '@/components/ui/textarea';

const QQ_GROUP_TYPE_OPTIONS = [
  { value: 'milestone:approaching', label: '里程碑临近' },
  { value: 'todo:remind', label: '待办节点提醒' },
  { value: 'todo:due', label: '待办到期提醒' },
  { value: 'announcement:published', label: '重要/紧急公告' },
  { value: 'risk:new', label: '新风险' },
  { value: 'incident:reported', label: '现场异常' },
  { value: 'weekly:report', label: '每周周报' },
] as const;

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
  onChanged: () => Promise<void>;
}

function toDateInput(v: string | null): string {
  return v ? v.slice(0, 10) : '';
}

/** 「QQ 群通知」卡：项目管理者生成绑定码 → 群里 @机器人 发送「绑定 XXXXXX」完成关联；多群各自勾选接收的消息类型 */
function QqGroupCard({ project, canManage, onChanged }: { project: ProjectDetail; canManage: boolean; onChanged: () => Promise<void> }) {
  const [bindCode, setBindCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const d = await api<{ code: string; expiresAt: string }>(`/api/projects/${project.id}/qq-bind-code`, { method: 'POST' });
      setBindCode(d);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unbind = async (groupOpenId: string) => {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}/qq-binding/${encodeURIComponent(groupOpenId)}`, { method: 'DELETE' });
      toast.success('已解绑 QQ 群');
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleType = async (groupOpenId: string, types: string[], value: string, checked: boolean) => {
    const next = checked ? [...types, value] : types.filter((t) => t !== value);
    try {
      await api(`/api/projects/${project.id}/qq-binding/${encodeURIComponent(groupOpenId)}`, {
        method: 'PATCH',
        body: { types: next },
      });
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
      await onChanged();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">QQ 群通知</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!project.qqEnabled ? (
          <p className="text-sm text-muted-foreground">部署未启用 QQ 通知（未配置机器人凭证），其他提醒渠道不受影响</p>
        ) : (
          <>
            {project.qqGroups.length > 0 && (
              <div className="space-y-2">
                {project.qqGroups.map((g) => (
                  <ListRow key={g.groupOpenId} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{g.groupOpenId.slice(0, 8)}…</span>
                      {canManage && (
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => unbind(g.groupOpenId)}>
                          解绑
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {QQ_GROUP_TYPE_OPTIONS.map((opt) => (
                        <label key={opt.value} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={g.types.includes(opt.value)}
                            disabled={!canManage}
                            onCheckedChange={(c) => toggleType(g.groupOpenId, g.types, opt.value, c === true)}
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </ListRow>
                ))}
              </div>
            )}
            {canManage && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={generate}>
                  {bindCode ? '重新生成' : '生成绑定码'}
                </Button>
                {bindCode && (
                  <span className="font-mono text-2xl font-semibold tracking-[0.3em]" aria-label="绑定码">
                    {bindCode.code}
                  </span>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              {bindCode
                ? `10 分钟内，把机器人拉进 QQ 群并 @机器人 发送：绑定 ${bindCode.code}`
                : '每个群可勾选接收的消息类型；在群里 @机器人 创建的待办，其提醒只回到来源群。项目管理者生成绑定码后，把机器人拉进 QQ 群，@机器人 发送「绑定 XXXXXX」完成关联（可绑定多个群）'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
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
    <div className="space-y-3">
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
      <QqGroupCard project={project} canManage={canManage} onChanged={onChanged} />
      <StageManager project={project} myPermissions={myPermissions} onChanged={onChanged} />
    </div>
  );
}
