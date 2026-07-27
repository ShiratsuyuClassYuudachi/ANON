import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../api/client';
import type { ProjectSummary } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { FormOverlay } from '@/components/FormOverlay';

export default function Projects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = () =>
    api<{ projects: ProjectSummary[] }>('/api/projects').then((d) => {
      setProjects(d.projects);
      setLoadFailed(false);
    });
  useEffect(() => {
    load().catch((e) => {
      setLoadFailed(true);
      toast.error((e as Error).message);
    });
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/projects', {
        body: {
          name,
          startDate: startDate ? new Date(startDate).toISOString() : undefined,
          endDate: endDate ? new Date(endDate).toISOString() : undefined,
        },
      });
      setName('');
      setStartDate('');
      setEndDate('');
      setCreateOpen(false);
      await load();
    } catch (e2) {
      toast.error((e2 as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">我的项目</h2>
        <Button data-tour="new-project" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> 新建项目
        </Button>
      </div>

      {loadFailed ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-destructive">加载项目列表失败</p>
          <Button
            onClick={() =>
              load().catch((e) => {
                setLoadFailed(true);
                toast.error((e as Error).message);
              })
            }
          >
            重试
          </Button>
        </Card>
      ) : projects === null ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <FolderPlus className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">还没有项目，创建第一个吧</p>
          <Button onClick={() => setCreateOpen(true)}>新建项目</Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={'/p/' + p.id}>
              <Card className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  {p.description && <CardDescription>{p.description}</CardDescription>}
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                  {p.myRole && <Badge variant="secondary">{p.myRole}</Badge>}
                  {(p.startDate || p.endDate) && (
                    <span>
                      {p.startDate?.slice(0, 10) ?? '…'} ~ {p.endDate?.slice(0, 10) ?? '…'}
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <FormOverlay open={createOpen} onOpenChange={setCreateOpen} title="新建项目">
        <form onSubmit={create} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pname">项目名称</Label>
            <Input id="pname" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pstart">开始日期</Label>
              <Input id="pstart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pend">结束日期</Label>
              <Input id="pend" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <Button type="submit" className="w-full">创建</Button>
        </form>
      </FormOverlay>
    </div>
  );
}
