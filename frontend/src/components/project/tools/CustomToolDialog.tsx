import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { PERMISSIONS } from '../../../lib/permissions';
import type { CustomTool, CustomToolMode } from '../../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  tool: CustomTool | null;
  onSaved: () => void;
}

/** 自定义工具新建/编辑弹层（含输入框，必须 FormOverlay 居中 Dialog） */
export default function CustomToolDialog({ open, onOpenChange, projectId, tool, onSaved }: Props) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<CustomToolMode>('embed');
  const [passToken, setPassToken] = useState(false);
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(tool?.name ?? '');
    setUrl(tool?.url ?? '');
    setDescription(tool?.description ?? '');
    setMode(tool?.mode ?? 'embed');
    setPassToken(tool?.passToken ?? false);
    setScopes(tool?.scopes ?? []);
  }, [open, tool]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('名称不能为空');
    if (!url.trim()) return toast.error('链接不能为空');
    try {
      new URL(url.trim());
    } catch {
      return toast.error('链接格式不正确');
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), url: url.trim(), description: description.trim(), mode, passToken, scopes };
      if (tool) {
        await api(`/api/projects/${projectId}/custom-tools/${tool.id}`, { method: 'PATCH', body });
        toast.success('已保存');
      } else {
        await api(`/api/projects/${projectId}/custom-tools`, { method: 'POST', body });
        toast.success('已添加');
      }
      onSaved();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormOverlay
      open={open}
      onOpenChange={onOpenChange}
      title={tool ? '编辑自定义工具' : '添加自定义工具'}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ct-name">工具名称</Label>
          <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ct-url">访问链接</Label>
          <Input
            id="ct-url"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ct-desc">工具说明（可选）</Label>
          <Textarea id="ct-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} />
        </div>
        <div className="space-y-2">
          <Label>打开方式</Label>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as CustomToolMode)} className="gap-2">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="embed" id="ct-mode-embed" />
              <Label htmlFor="ct-mode-embed" className="font-normal">嵌入当前页面内打开</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="link" id="ct-mode-link" />
              <Label htmlFor="ct-mode-link" className="font-normal">在新标签页中打开</Label>
            </div>
          </RadioGroup>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch id="ct-pass-token" checked={passToken} onCheckedChange={setPassToken} />
            <Label htmlFor="ct-pass-token">向组件安全传递成员身份</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            开启后将在打开工具时投递 5 分钟一次性启动令牌，供组件换取受限访问凭证。
          </p>
        </div>
        {passToken && (
          <div className="space-y-2">
            <Label>允许组件使用的权限范围</Label>
            <div className="grid grid-cols-2 gap-2">
              {PERMISSIONS.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(p.key)}
                    onCheckedChange={(c) =>
                      setScopes(c ? [...scopes, p.key] : scopes.filter((x) => x !== p.key))
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              不勾选任何权限时，组件仅能核验成员身份并读取基础公开数据。
            </p>
          </div>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? '提交中…' : tool ? '保存修改' : '添加工具'}
        </Button>
      </form>
    </FormOverlay>
  );
}
