import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../api/client';
import { fmtLocal } from '../lib/datetime';
import { ModeToggle } from '../theme';
import type { PublicLostFoundItem, PublicLostFoundResponse } from '../types';
import Logo from '../components/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

type StatusFilter = '' | 'pending' | 'claimed';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待认领' },
  { key: 'claimed', label: '已认领' },
];

/** 免登录失物招领公开查找页（/lf/:token，链接由项目内开启生成） */
export default function PublicLostFound() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicLostFoundResponse | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  const load = useCallback(
    async (kw: string, status: StatusFilter) => {
      try {
        const params = new URLSearchParams();
        if (kw) params.set('q', kw);
        if (status) params.set('status', status);
        const qs = params.toString();
        setData(await api<PublicLostFoundResponse>(`/api/public/lostfound/${token}${qs ? `?${qs}` : ''}`));
        setErr('');
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [token],
  );

  useEffect(() => {
    void load('', '');
  }, [load]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    void load(q.trim(), statusFilter);
  };

  const pickStatus = (s: StatusFilter) => {
    setStatusFilter(s);
    void load(q.trim(), s);
  };

  return (
    <main className="editorial min-h-dvh bg-background">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <div className="mx-auto w-full max-w-[60rem] space-y-6 px-4 py-12">
        {err ? (
          <div role="alert" className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-lg font-medium">该公示链接不存在或已关闭</p>
              <p className="text-sm text-muted-foreground">{err}</p>
          </div>
        ) : !data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-1 text-center">
              <div className="flex justify-center pb-2"><Logo /></div>
              <p className="text-sm text-muted-foreground">{data.projectName}</p>
              <h1 className="editorial-title">失物招领公示</h1>
              <p className="text-sm text-muted-foreground">如发现疑似本人遗失的物品，请前往现场服务台或联系工作人员核对认领。</p>
            </div>

            <form className="flex flex-wrap items-center justify-center gap-2" onSubmit={search}>
              <Input
                className="w-full sm:w-64"
                aria-label="搜索物品" placeholder="搜索物品名称、特征或拾获地点"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                <Search className="size-4" /> 搜索
              </Button>
              <div className="flex flex-wrap gap-1">
                {STATUS_FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    type="button"
                    size="sm"
                    variant={statusFilter === f.key ? 'default' : 'outline'}
                    aria-pressed={statusFilter === f.key}
                    className="rounded-full"
                    onClick={() => pickStatus(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </form>

            {data.items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                  {q || statusFilter ? '没有找到匹配的物品' : '目前暂无失物登记记录'}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.items.map((it: PublicLostFoundItem) => (
                  <Card key={it.id} className="editorial-card gap-0 overflow-hidden py-0">
                    {it.hasPhoto && (
                      <img
                        src={`/api/public/lostfound/${token}/items/${it.id}/photo`}
                        alt={it.name}
                        className="aspect-square w-full object-cover" loading="lazy"
                      />
                    )}
                    <CardContent className="space-y-1 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{it.name}</span>
                        {it.status === 'pending' ? (
                          <Badge variant="warning-soft">待认领</Badge>
                        ) : (
                          <Badge variant="success">已认领</Badge>
                        )}
                      </div>
                      {it.note && <p className="text-sm text-muted-foreground">{it.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        {fmtLocal(it.foundAt, true)}{it.foundLocation ? ` · ${it.foundLocation}` : ''}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
