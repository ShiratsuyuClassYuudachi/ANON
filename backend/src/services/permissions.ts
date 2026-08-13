import { Project } from '../models/Project';

export const ALL_PERMISSIONS = [
  'project:manage',
  'member:manage',
  'role:manage',
  'todo:create',
  'todo:manage',
  'todo:complete',
  'file:upload',
  'finance:manage',
  'finance:add',
  'materials:manage',
  'accounts:manage',
  'work:manage',
  'announcement:manage',
  'tools:manage',
  'lostfound:manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PRESET_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: '主办', permissions: [...ALL_PERMISSIONS] },
  { name: '美工', permissions: ['file:upload', 'todo:create', 'todo:complete', 'finance:add', 'lostfound:manage'] },
  { name: '宣发', permissions: ['file:upload', 'todo:create', 'todo:complete', 'finance:add', 'lostfound:manage'] },
  { name: '一般staff', permissions: ['todo:create', 'todo:complete', 'finance:add', 'lostfound:manage'] },
];

/** 新权限点默认授予所有角色：既有项目全部角色启动时幂等补授（find/save 循环，避开 FerretDB 定位符兼容风险） */
export async function grantPermissionToAllRoles(perm: Permission): Promise<void> {
  const projects = await Project.find({ 'roles.permissions': { $ne: perm } });
  for (const p of projects) {
    for (const r of p.roles) {
      if (!r.permissions.includes(perm)) r.permissions.push(perm);
    }
    await p.save();
  }
}
