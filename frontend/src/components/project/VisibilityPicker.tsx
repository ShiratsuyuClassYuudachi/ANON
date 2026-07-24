import { Checkbox } from '@/components/ui/checkbox';
import type { Member, Visibility } from '@/types';

interface Props {
  members: Member[];
  roles: string[];
  value: Visibility;
  onChange: (v: Visibility) => void;
}

export function VisibilityPicker({ members, roles, value, onChange }: Props) {
  const toggleUser = (id: string, checked: boolean) =>
    onChange({ ...value, userIds: checked ? [...value.userIds, id] : value.userIds.filter((u) => u !== id) });
  const toggleRole = (name: string, checked: boolean) =>
    onChange({ ...value, roleNames: checked ? [...value.roleNames, name] : value.roleNames.filter((r) => r !== name) });

  const chip = (active: boolean) =>
    `flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
      active ? 'border-primary bg-accent text-accent-foreground' : 'border-border text-muted-foreground'
    }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => (
          <label key={m.userId} className={chip(value.userIds.includes(m.userId))}>
            <Checkbox
              checked={value.userIds.includes(m.userId)}
              onCheckedChange={(c) => toggleUser(m.userId, c === true)}
            />
            {m.name}
          </label>
        ))}
      </div>
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <label key={r} className={chip(value.roleNames.includes(r))}>
              <Checkbox
                checked={value.roleNames.includes(r)}
                onCheckedChange={(c) => toggleRole(r, c === true)}
              />
              角色:{r}
            </label>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">都不勾选 = 全体成员可见</p>
    </div>
  );
}
