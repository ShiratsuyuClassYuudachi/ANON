import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ModeToggle, THEME_STYLES, useTheme } from '@/theme';
import ApiKeysCard from '../components/ApiKeysCard';
import PushSettingsCard from '../components/PushSettingsCard';
import QqBindCard from '../components/QqBindCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Me() {
  const { user, refresh } = useAuth();
  const { style, setStyle } = useTheme();
  const [name, setName] = useState(user?.name ?? '');
  const [contacts, setContacts] = useState(user?.contacts ?? []);

  if (!user) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const cleaned = contacts.filter((c) => c.platform.trim() && c.value.trim());
      await api('/api/me', { method: 'PATCH', body: { name: name.trim(), contacts: cleaned } });
      setContacts(cleaned);
      await refresh();
      toast.success('资料已保存');
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[45rem] space-y-6">
      <h1 className="editorial-title">个人资料</h1>
      <section className="editorial-section">
        <h2 className="editorial-subheading">基本信息</h2>
          <form onSubmit={submit} className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="break-all">{user.email}</span>
              {user.isSuperAdmin && <Badge variant="secondary">超级管理员</Badge>}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="me-name">昵称</Label>
              <Input id="me-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>公开联系方式（对同活动成员可见）</Label>
              {contacts.map((c, i) => (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[112px_minmax(0,1fr)_44px]" key={i}>
                  <Input
                    className="col-span-2 w-full sm:col-span-1 sm:w-28"
                    aria-label="联系方式平台" placeholder="平台（如 QQ、手机）"
                    value={c.platform}
                    onChange={(e) =>
                      setContacts(contacts.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="min-w-0 w-full sm:col-start-2"
                    aria-label="联系方式号码或账号" placeholder="号码或账号"
                    value={c.value}
                    onChange={(e) =>
                      setContacts(contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:col-start-3"
                    aria-label="删除联系方式"
                    onClick={() => setContacts(contacts.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setContacts([...contacts, { platform: '', value: '' }])}
              >
                + 添加联系方式
              </Button>
            </div>
            <Button type="submit">保存资料</Button>
          </form>
      </section>

      <PushSettingsCard />

      <QqBindCard />

      <ApiKeysCard />

      <section className="editorial-section">
        <h2 className="editorial-subheading">界面偏好</h2>
          <div className="flex flex-wrap items-center gap-2">
            {THEME_STYLES.map(({ key, label }) => (
              <Button key={key} variant={style === key ? 'default' : 'outline'} aria-pressed={style === key} onClick={() => setStyle(key)}>
                {label}
              </Button>
            ))}
            <div className="ml-auto">
              <ModeToggle />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">界面风格与日夜模式仅保存在当前浏览器。</p>
      </section>
    </div>
  );
}
