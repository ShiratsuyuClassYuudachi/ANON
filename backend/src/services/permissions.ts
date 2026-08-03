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
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PRESET_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: '主办', permissions: [...ALL_PERMISSIONS] },
  { name: '美工', permissions: ['file:upload', 'todo:create', 'todo:complete', 'finance:add'] },
  { name: '宣发', permissions: ['file:upload', 'todo:create', 'todo:complete', 'finance:add'] },
  { name: '一般staff', permissions: ['todo:create', 'todo:complete', 'finance:add'] },
];
