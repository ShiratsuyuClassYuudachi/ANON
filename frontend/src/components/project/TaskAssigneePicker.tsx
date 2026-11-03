import type { ExternalMember, Member } from '../../types';
import { Checkbox } from '@/components/ui/checkbox';

interface Props {
  members: Member[];
  externalMembers: ExternalMember[];
  assigneeIds: string[];
  externalAssigneeIds: string[];
  keptExternalIds?: string[];
  onUsersChange: (ids: string[]) => void;
  onExternalChange: (ids: string[]) => void;
}

export function TaskAssigneePicker({ members, externalMembers, assigneeIds, externalAssigneeIds, keptExternalIds = [], onUsersChange, onExternalChange }: Props) {
  const toggle = (ids: string[], id: string, checked: boolean) => checked ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
  return <div className="flex flex-wrap gap-1.5">
    {members.map((m) => <label key={m.userId} className="flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
      <Checkbox checked={assigneeIds.includes(m.userId)} onCheckedChange={(c) => onUsersChange(toggle(assigneeIds, m.userId, c === true))} />
      {m.name}
    </label>)}
    {externalMembers.filter((m) => (!m.linkedUserId && !m.archivedAt) || keptExternalIds.includes(m.id)).map((m) =>
      <label key={m.id} className="flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
        <Checkbox checked={externalAssigneeIds.includes(m.id)} onCheckedChange={(c) => onExternalChange(toggle(externalAssigneeIds, m.id, c === true))} />
        <span className="min-w-0 break-words">{m.name}<span className="ml-1 text-xs text-muted-foreground">{m.archivedAt ? '已归档' : m.linkedUserId ? '关联账号已离项' : '未注册'}{m.duty && ` · ${m.duty}`}</span></span>
      </label>)}
  </div>;
}
