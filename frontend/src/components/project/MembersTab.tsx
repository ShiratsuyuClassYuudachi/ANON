import { useState } from 'react';
import { toast } from 'sonner';
import { Link2, UserMinus } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import type { Member, ProjectDetail } from '../../types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  project: ProjectDetail;
  members: Member[];
  onChanged: () => Promise<void>;
}

export default function MembersTab({ project, members, onChanged }: Props) {
  const { user } = useAuth();
  const [roleName, setRoleName] = useState(
    project.roles.find((r) => r.name === '一般staff')?.name ??
      project.roles[project.roles.length - 1]?.name ??
      '',
  );
  const [targetUserId, setTargetUserId] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => fn().catch((e) => toast.error(e.message));

  const createInvite = () =>
    run(async () => {
      const d = await api<{ url: string }>(`/api/projects/${project.id}/invites`, {
        body: { roleName, targetUserId: targetUserId || undefined },
      });
      setInviteUrl(`${location.origin}${d.url}`);
    });

  const removingMember = members.find((m) => m.userId === removingId);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">邀请成员</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Select value={roleName} onValueChange={setRoleName}>
            <SelectTrigger className="sm:w-40"><SelectValue placeholder="角色" /></SelectTrigger>
            <SelectContent>
              {project.roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder="指定用户 ID（可留空）"
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
          />
          <Button onClick={createInvite}><Link2 className="size-4" /> 生成链接</Button>
        </CardContent>
      </Card>

      {members.map((m) => (
        <Card key={m.userId}>
          <CardContent className="flex items-center gap-3">
            <Avatar>
              <AvatarFallback>{m.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-sm text-muted-foreground">{m.email}</p>
            </div>
            <Select
              value={m.roleName}
              onValueChange={(v) =>
                run(async () => {
                  await api(`/api/projects/${project.id}/members/${m.userId}`, {
                    method: 'PATCH',
                    body: { roleName: v },
                  });
                  await onChanged();
                })
              }
            >
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {project.roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {m.userId !== user?.id && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="移除成员"
                onClick={() => setRemovingId(m.userId)}
              >
                <UserMinus className="size-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!inviteUrl} onOpenChange={(o) => !o && setInviteUrl('')}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>邀请链接已生成</DialogTitle>
            <DialogDescription>把链接发给对方，登录后打开即可加入项目。</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl).then(
                  () => toast.success('已复制'),
                  () => toast.error('复制失败'),
                );
              }}
            >
              复制
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removingId} onOpenChange={(o) => !o && setRemovingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除成员「{removingMember?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>对方将失去该项目的访问权限。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                removingMember &&
                run(async () => {
                  await api(`/api/projects/${project.id}/members/${removingMember.userId}`, {
                    method: 'DELETE',
                  });
                  await onChanged();
                })
              }
            >
              移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
