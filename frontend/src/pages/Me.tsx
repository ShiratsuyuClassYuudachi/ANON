import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { ModeToggle, useTheme } from '@/theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      await api('/api/me', { method: 'PATCH', body: { name, contacts } });
      await refresh();
      toast.success('已保存');
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">个人资料</h2>
      <Card>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {user.email}
              {user.isSuperAdmin && <Badge variant="secondary">超级管理员</Badge>}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="me-name">昵称</Label>
              <Input id="me-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>联系方式（会展示给项目成员）</Label>
              {contacts.map((c, i) => (
                <div className="flex items-center gap-2" key={i}>
                  <Input
                    className="w-28"
                    placeholder="平台（如 QQ）"
                    value={c.platform}
                    onChange={(e) =>
                      setContacts(contacts.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))
                    }
                  />
                  <Input
                    className="flex-1"
                    placeholder="账号"
                    value={c.value}
                    onChange={(e) =>
                      setContacts(contacts.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
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
            <Button type="submit">保存</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">界面偏好</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant={style === 'minimal' ? 'default' : 'outline'} onClick={() => setStyle('minimal')}>
              简洁
            </Button>
            <Button variant={style === 'playful' ? 'default' : 'outline'} onClick={() => setStyle('playful')}>
              明快
            </Button>
            <div className="ml-auto">
              <ModeToggle />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">风格与日夜模式保存在本机</p>
        </CardContent>
      </Card>
    </div>
  );
}
