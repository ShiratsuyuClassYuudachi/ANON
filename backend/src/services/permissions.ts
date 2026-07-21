export const ALL_PERMISSIONS = [
  'project:manage',
  'member:manage',
  'role:manage',
  'todo:manage',
  'todo:complete',
  'file:upload',
  'finance:manage',
  'materials:manage',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PRESET_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: '主办', permissions: [...ALL_PERMISSIONS] },
  { name: '美工', permissions: ['file:upload', 'todo:complete'] },
  { name: '宣发', permissions: ['file:upload', 'todo:complete'] },
  { name: '一般staff', permissions: ['todo:complete'] },
];
