import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { fmtLocal } from '../lib/datetime';
import { PERMISSIONS } from '../lib/permissions';
import type { ApiKeyInfo } from '../types';
import { FormOverlay } from './FormOverlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PERM_LABEL = new Map<string, string>(PERMISSIONS.map((p) => [p.key, p.label]));

interface CreatedKey {
  apiKey: string;
  key: ApiKeyInfo;
}

/** 「个人资料」页的 API 密钥管理卡片：自助生成（一次性展示原文）、查看、撤销 */
export default function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);

  // 创建弹层 state
  const [name, setName] = useState('');
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [lifetime, setLifetime] = useState<'30d' | 'permanent'>('30d');
  const [myPermissions, setMyPermissions] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadKeys = () =>
    api<{ keys: ApiKeyInfo[] }>('/api/open/keys')
      .then((r) => setKeys(r.keys))
      .catch((e) => toast.error((e as Error).message));

  useEffect(() => {
    loadKeys();
  }, []);

  // 创建弹层首次打开时拉项目列表
  useEffect(() => {
    if (!createOpen || projects !== null) return;
    api<{ projects: { id: string; name: string }[] }>('/api/projects')
      .then((r) => setProjects(r.projects.map((p) => ({ id: p.id, name: p.name }))))
      .catch((e) => toast.error((e as Error).message));
  }, [createOpen, projects]);

  // 选中项目后拉该项目下我实际持有的权限点
  useEffect(() => {
    if (!projectId) {
      setMyPermissions([]);
      setScopes([]);
      return;
    }
    api<{ myPermissions: string[] }>(`/api/projects/${projectId}`)
      .then((r) => {
        setMyPermissions(r.myPermissions);
        setScopes((prev) => prev.filter((s) => r.myPermissions.includes(s)));
      })
      .catch((e) => toast.error((e as Error).message));
  }, [projectId]);

  const resetCreate = () => {
    setName('');
    setProjectId('');
    setLifetime('30d');
    setMyPermissions([]);
    setScopes([]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('名称不能为空');
    if (!projectId) return toast.error('请选择项目');
    setBusy(true);
    try {
      const r = await api<CreatedKey>('/api/open/keys', {
        method: 'POST',
        body: { projectId, name: name.trim(), scopes, permanent: lifetime === 'permanent' },
      });
      setCreated(r);
      setCreateOpen(false);
      resetCreate();
      loadKeys();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKeyInfo) => {
    try {
      await api(`/api/open/keys/${k.id}`, { method: 'DELETE' });
      setKeys((prev) => (prev ? prev.filter((x) => x.id !== k.id) : prev));
      toast.success('已撤销');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const grantable = PERMISSIONS.filter((p) => myPermissions.includes(p.key));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">API 密钥</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> 生成密钥
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          供插件或自动化脚本以你的身份调用本系统接口；密钥仅在生成时展示一次，撤销后立即失效
        </p>
        {keys === null ? null : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无密钥</p>
        ) : (
          <ul className="space-y-3">
            {keys.map((k) => (
              <li key={k.id} className="flex items-start gap-3 rounded-md border p-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <Badge variant="secondary">{k.projectName}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {k.toolName ? `由工具「${k.toolName}」签发` : '手动生成'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.length === 0 ? (
                      <span className="text-xs text-muted-foreground">仅成员可读数据</span>
                    ) : (
                      k.scopes.map((s) => (
                        <Badge key={s} variant="outline">
                          {PERM_LABEL.get(s) ?? s}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {k.expiresAt ? (
                      <span>有效期至 {fmtLocal(k.expiresAt)}</span>
                    ) : (
                      <Badge variant="outline">永久有效</Badge>
                    )}
                    {k.lastUsedAt && <span>最近使用 {fmtLocal(k.lastUsedAt)}</span>}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => revoke(k)}>
                  撤销
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <FormOverlay
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreate();
        }}
        title="生成 API 密钥"
        description="密钥仅以你的身份、按勾选权限点访问所选项目"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ak-name">名称</Label>
            <Input
              id="ak-name"
              placeholder="签到脚本"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>项目</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>有效期</Label>
            <Select value={lifetime} onValueChange={(v) => setLifetime(v as '30d' | 'permanent')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30d">30 天</SelectItem>
                <SelectItem value="permanent">永久有效</SelectItem>
              </SelectContent>
            </Select>
            {lifetime === 'permanent' && (
              <p className="text-xs text-destructive">永久密钥泄露后长期有效，请确认脚本使用场景可信</p>
            )}
          </div>
          {projectId && (
            <div className="space-y-2">
              <Label>权限点</Label>
              {grantable.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  你在该项目没有可授予的权限点，密钥仅能读取成员可见数据
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {grantable.map((p) => (
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
              )}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? '生成中…' : '生成'}
          </Button>
        </form>
      </FormOverlay>

      <FormOverlay
        open={created !== null}
        onOpenChange={(o) => {
          if (!o) setCreated(null); // 关闭即清空内存中的原文
        }}
        title="密钥已生成"
      >
        {created && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={created.apiKey} onFocus={(e) => e.target.select()} />
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard.writeText(created.apiKey).then(() => toast.success('已复制'))
                }
              >
                <Copy className="size-4" /> 复制
              </Button>
            </div>
            <p className="text-xs text-destructive">
              请立即复制并妥善保管——关闭后无法再次查看，丢失只能撤销重建
            </p>
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">生效权限点</p>
              <div className="flex flex-wrap gap-1">
                {created.key.scopes.length === 0 ? (
                  <span className="text-xs text-muted-foreground">仅成员可读数据</span>
                ) : (
                  created.key.scopes.map((s) => (
                    <Badge key={s} variant="outline">
                      {PERM_LABEL.get(s) ?? s}
                    </Badge>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {created.key.expiresAt ? `有效期至 ${fmtLocal(created.key.expiresAt)}` : '永久有效'}
              </p>
            </div>
            <Button className="w-full" onClick={() => setCreated(null)}>
              完成
            </Button>
          </div>
        )}
      </FormOverlay>
    </Card>
  );
}
