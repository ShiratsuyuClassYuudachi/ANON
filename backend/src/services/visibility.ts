import type { Types } from 'mongoose';

export interface VisibilityLike {
  userIds?: (Types.ObjectId | string)[];
  roleNames?: string[];
}

export interface Viewer {
  userId: string;
  roleName: string | null;
  isSuperAdmin: boolean;
}

/** 兼容别名：账号模块使用的命名 */
export type VisibilityContext = Viewer;

/** 空可见范围 = 不限制（走权限点） */
export function visibilityEmpty(v?: VisibilityLike | null): boolean {
  return !v || ((v.userIds?.length ?? 0) === 0 && (v.roleNames?.length ?? 0) === 0);
}

/**
 * 可见范围判定：按顺序取第一个非空的 visibility（资源的优先于类型的）；
 * 均空则不限制；非空时仅列出的用户/角色可见；超管不受限。
 */
export function canSee(viewer: Viewer, ...visibilities: (VisibilityLike | null | undefined)[]): boolean {
  const eff = visibilities.find((v) => !visibilityEmpty(v));
  if (!eff) return true;
  if (viewer.isSuperAdmin) return true;
  if ((eff.userIds ?? []).some((id) => id.toString() === viewer.userId)) return true;
  if (viewer.roleName && (eff.roleNames ?? []).includes(viewer.roleName)) return true;
  return false;
}

/** 单个 visibility 的判定（canSee 的单参形式） */
export function isVisible(visibility: VisibilityLike | null | undefined, ctx: VisibilityContext): boolean {
  return canSee(ctx, visibility);
}
