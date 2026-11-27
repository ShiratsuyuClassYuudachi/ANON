import { useState } from 'react';
import { toast } from 'sonner';
import { Link2, UserMinus } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../auth';
import ExternalMembersPanel from './ExternalMembersPanel';
import type { ExternalMember, Member, ProjectDetail } from '../../types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormOverlay } from '@/components/FormOverlay';
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
  externalMembers: ExternalMember[];
  myPermissions: string[];
  onChanged: () => Promise<void>;
}

export default function MembersTab({ project, members, externalMembers, myPermissions, onChanged }: Props) {
  const { user } = useAuth();
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('member:manage');
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
    <div data-tour="tab-members" className="space-y-3">
      <h1 className="editorial-heading">成员</h1>
      {canManage && (
        <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={roleName} onValueChange={setRoleName}>
              <SelectTrigger className="sm:w-40"><SelectValue placeholder="角色" /></SelectTrigger>
              <SelectContent>
                {project.roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="指定用户 ID（留空则为通用邀请链接）"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            />
            <Button onClick={createInvite}><Link2 className="size-4" /> 生成邀请链接</Button>
        </div>
      )}

      <div className="editorial-list">
      {members.map((m) => (
        <article key={m.userId} className="editorial-row flex flex-wrap items-center gap-2">
            <Avatar>
              <AvatarFallback>{m.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="wrap-anywhere font-medium">{m.name}</p>
              <p className="wrap-anywhere text-sm text-muted-foreground">{m.email}</p>
              {m.externalProfiles?.map((profile) => <div key={profile.id} className="break-words text-sm text-muted-foreground">
                {profile.duty && <p>岗位：{profile.duty}</p>}
                {profile.contacts.map((c, i) => <p key={i}>{c.platform}：{c.value}</p>)}
              </div>)}
            </div>
            <Select
              disabled={!canManage}
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
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {project.roles.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManage && m.userId !== user?.id && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="移除成员"
                onClick={() => setRemovingId(m.userId)}
              >
                <UserMinus className="size-4" />
              </Button>
            )}
        </article>
      ))}
      </div>
      <ExternalMembersPanel projectId={project.id} members={members} externalMembers={externalMembers} canManage={canManage} onChanged={onChanged} />

      <FormOverlay
        open={!!inviteUrl}
        onOpenChange={(open) => !open && setInviteUrl('')}
        title="邀请链接已生成"
        description="将链接发给团队伙伴，对方登录账号后打开即可加入本场活动。"
      >
          <div className="flex gap-2">
            <Input aria-label="邀请链接" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl).then(
                  () => toast.success('已复制'),
                  () => toast.error('复制失败'),
                );
              }}
            >
              复制链接
            </Button>
          </div>
      </FormOverlay>

      <AlertDialog open={!!removingId} onOpenChange={(o) => !o && setRemovingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除成员「{removingMember?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>移除后对方将不再拥有本场活动的访问权限。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removingMember)
                  run(async () => {
                    await api(`/api/projects/${project.id}/members/${removingMember.userId}`, {
                      method: 'DELETE',
                    });
                    await onChanged();
                  });
                setRemovingId(null);
              }}
            >
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
