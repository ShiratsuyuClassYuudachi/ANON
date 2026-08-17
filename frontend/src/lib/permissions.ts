/** 权限点清单（与后端 services/permissions.ts ALL_PERMISSIONS 对齐）；RolesTab / 工具 scopes / API 密钥勾选共用 */
export const PERMISSIONS = [
  { key: 'project:manage', label: '项目管理' },
  { key: 'member:manage', label: '成员管理' },
  { key: 'role:manage', label: '角色管理' },
  { key: 'todo:create', label: '创建待办' },
  { key: 'todo:manage', label: '待办管理' },
  { key: 'todo:complete', label: '完成待办' },
  { key: 'file:upload', label: '上传文件' },
  { key: 'finance:manage', label: '财务管理' },
  { key: 'finance:add', label: '记账' },
  { key: 'materials:manage', label: '物料管理' },
  { key: 'accounts:manage', label: '账号管理' },
  { key: 'work:manage', label: '现场分工管理' },
  { key: 'announcement:manage', label: '公告管理' },
  { key: 'tools:manage', label: '工具管理' },
  { key: 'lostfound:manage', label: '失物招领管理' },
] as const;
