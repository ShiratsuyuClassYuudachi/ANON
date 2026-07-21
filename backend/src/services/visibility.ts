import type { IVisibility } from '../models/PlatformAccount';

export interface VisibilityContext {
  userId: string;
  roleName: string | null;
  isSuperAdmin: boolean;
}

// 可见范围：空 = 不限制（走权限点）；非空时仅列出的用户或角色可见，优先于权限点；超管不受限
export function isVisible(visibility: IVisibility | undefined | null, ctx: VisibilityContext): boolean {
  if (ctx.isSuperAdmin) return true;
  if (!visibility) return true;
  const userIds = visibility.userIds ?? [];
  const roleNames = visibility.roleNames ?? [];
  if (userIds.length === 0 && roleNames.length === 0) return true;
  if (userIds.some((id) => id.toString() === ctx.userId)) return true;
  if (ctx.roleName && roleNames.includes(ctx.roleName)) return true;
  return false;
}
