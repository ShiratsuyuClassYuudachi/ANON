import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { PackageSearch, Search } from 'lucide-react';
import { api } from '../api/client';
import { fmtLocal } from '../lib/datetime';
import { ModeToggle } from '../theme';
import type { PublicLostFoundItem, PublicLostFoundResponse } from '../types';
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
    <div className="min-h-screen bg-background">
      <div className="fixed right-3 top-3 z-50">
        <ModeToggle />
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
        {err ? (
          <Card className="mt-16">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <PackageSearch className="size-10 text-muted-foreground" />
              <p className="text-lg font-medium">链接不存在或已关闭</p>
              <p className="text-sm text-muted-foreground">{err}</p>
            </CardContent>
          </Card>
        ) : !data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-1 text-center">
              <p className="text-sm text-muted-foreground">{data.projectName}</p>
              <h1 className="text-2xl font-semibold">失物招领</h1>
              <p className="text-sm text-muted-foreground">发现疑似自己的物品？请联系现场工作人员核对认领</p>
            </div>

            <form className="flex flex-wrap items-center justify-center gap-2" onSubmit={search}>
              <Input
                className="w-full sm:w-64"
                placeholder="搜索名称 / 特征 / 捡到地点"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Button type="submit" variant="outline" size="sm">
                <Search className="size-4" /> 搜索
              </Button>
              <div className="flex gap-1">
                {STATUS_FILTERS.map((f) => (
                  <Button
                    key={f.key}
                    type="button"
                    size="sm"
                    variant={statusFilter === f.key ? 'default' : 'outline'}
                    onClick={() => pickStatus(f.key)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
            </form>

            {data.items.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                  <PackageSearch className="size-8" />
                  {q || statusFilter ? '没有匹配的物品' : '暂无失物登记'}
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.items.map((it: PublicLostFoundItem) => (
                  <Card key={it.id} className="overflow-hidden">
                    {it.hasPhoto && (
                      <img
                        src={`/api/public/lostfound/${token}/items/${it.id}/photo`}
                        alt={it.name}
                        className="h-40 w-full object-cover"
                      />
                    )}
                    <CardContent className="space-y-1 p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{it.name}</span>
                        {it.status === 'pending' ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">待认领</Badge>
                        ) : (
                          <Badge className="bg-green-600 text-white hover:bg-green-600">已认领</Badge>
                        )}
                      </div>
                      {it.note && <p className="text-sm text-muted-foreground">{it.note}</p>}
                      <p className="text-xs text-muted-foreground">
                        {fmtLocal(it.foundAt, true)} 捡到{it.foundLocation ? ` · ${it.foundLocation}` : ''}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
