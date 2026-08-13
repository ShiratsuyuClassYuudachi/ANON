import type { IncidentCategory, PhysicalItemStatus, ProjectStatus, TicketType, Visibility } from '../types';

// 演示站内存库：全部字段可 JSON 序列化（日期一律 ISO-8601 字符串），
// 整体持久化到 sessionStorage（key anon-demo-db），按标签页隔离。

export interface DbUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  contacts: { platform: string; value: string }[];
  onboardedAt: string | null;
}

export interface DbStage {
  id: string;
  name: string;
  order: number;
  completedAt: string | null;
  note: string;
}

export interface DbRole {
  name: string;
  permissions: string[];
}

export interface DbProject {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  location: string;
  timezone: string;
  stages: DbStage[];
  roles: DbRole[];
  createdBy: string;
  ticketTypes: TicketType[];
  ticketPriceCents: number;
  ticketCount: number;
}

export interface DbMembership {
  projectId: string;
  userId: string;
  roleName: string;
}

export interface DbTodoUpdate {
  note: string;
  createdBy: string;
  createdAt: string;
  attachments: string[];
}

export interface DbTodo {
  id: string;
  projectId: string;
  title: string;
  category: string;
  assigneeIds: string[];
  nodeAt: string | null;
  dueAt: string | null;
  remindAt: string | null;
  status: 'open' | 'done';
  note: string;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  completedBy: string | null;
  completionNote: string | null;
  attachments: string[];
  updates: DbTodoUpdate[];
}

export interface DbTransaction {
  id: string;
  projectId: string;
  type: 'income' | 'expense';
  amountCents: number;
  note: string;
  payerUserId: string;
  splitAmong: string[];
  createdBy: string;
  createdAt: string;
  attachments: string[];
}

export interface DbResourceType {
  id: string;
  projectId: string;
  name: string;
  visibility: Visibility;
  createdAt: string;
}

export interface DbResource {
  id: string;
  projectId: string;
  typeId: string;
  name: string;
  description: string;
  visibility: Visibility;
  createdAt: string;
}

export interface DbResourceVersion {
  id: string;
  resourceId: string;
  version: number;
  note: string;
  fileId: string;
  hasPreview: boolean;
  createdBy: string;
  createdAt: string;
}

/** asset = public/ 下的静态资产路径；dataUrl = 会话内上传转存的 base64 */
export interface DbFile {
  filename: string;
  mime: string;
  size: number;
  asset?: string;
  dataUrl?: string;
}

export interface DbAccount {
  id: string;
  projectId: string;
  platform: string;
  account: string;
  mode: 'full' | 'otp' | 'contact';
  cipherKeySource: 'user' | 'server' | null;
  /** user 模式存浏览器密文（ANONv2 格式）；server 模式 mock 直接存明文模拟服务端加解密 */
  passwordCipher: string | null;
  plainPassword: string | null;
  note: string;
  addedBy: string;
  visibility: Visibility;
  createdAt: string;
}

export interface DbWorkAssignee {
  userId: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
}

export interface DbWorkModule {
  id: string;
  projectId: string;
  name: string;
  description: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  requiredCount: number;
  assignees: DbWorkAssignee[];
  createdBy: string;
  createdAt: string;
}

export interface DbPhysicalCategory {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: string;
}

export interface DbPhysicalItem {
  id: string;
  projectId: string;
  categoryId: string;
  name: string;
  spec: string;
  unit: string;
  plannedQty: number;
  onHandQty: number;
  usedQty: number;
  lostQty: number;
  status: PhysicalItemStatus;
  responsibleId: string | null;
  location: string;
  tags: string[];
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbPhysicalLog {
  id: string;
  projectId: string;
  itemId: string;
  type: string;
  qty: number;
  status: PhysicalItemStatus | null;
  note: string;
  operatorId: string;
  createdAt: string;
}

export interface DbAnnouncement {
  id: string;
  projectId: string;
  title: string;
  content: string;
  type: 'normal' | 'important' | 'emergency';
  isPinned: boolean;
  requireConfirmation: boolean;
  visibility: Visibility;
  publishedBy: string;
  publishedAt: string;
  expiresAt: string | null;
  /** 已确认用户 id 列表（demo 不暴露确认名单端点，只维护 confirmedByMe） */
  confirmedBy: string[];
}

export interface DbRisk {
  id: string;
  projectId: string;
  ruleCode: string;
  level: 'info' | 'warning' | 'critical';
  sourceType: string;
  sourceId: string | null;
  title: string;
  description: string;
  status: 'active' | 'ignored' | 'resolved';
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  ignoredBy: string | null;
  ignoredUntil: string | null;
  ignoreReason: string | null;
}

export interface DbActivity {
  id: string;
  projectId: string;
  actorId: string;
  type: string;
  message: string;
  sourceType: string;
  sourceId: string | null;
  permissionGate: string | null;
  createdAt: string;
}

export interface DbMilestone {
  id: string;
  projectId: string;
  title: string;
  date: string;
  description: string;
  stageId: string | null;
  completedAt: string | null;
  createdBy: string;
}

export interface DbIncident {
  id: string;
  projectId: string;
  moduleId: string | null;
  category: IncidentCategory;
  note: string;
  reporterId: string;
  status: 'open' | 'resolved';
  createdAt: string;
}

export interface DbDashboardPreference {
  userId: string;
  projectId: string;
  defaultView: 'personal' | 'project';
  collapsedCards: string[];
  hiddenCards: string[];
  scheduleRange: 7 | 30;
  cardOrder: string[];
}

export interface DbStageRundownItem {
  id: string;
  name: string;
  durationMin: number;
  participants: { cn: string; contact: string }[];
  attachmentIds: string[];
  note: string;
}

export interface DbStageRundown {
  id: string;
  projectId: string;
  name: string;
  startAt: string;
  note: string;
  items: DbStageRundownItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbStageSignupReview {
  userId: string;
  decision: 'approve' | 'reject';
  comment: string;
  updatedAt: string;
}

export interface DbStageSignupItem {
  id: string;
  name: string;
  durationMin: number;
  participants: { cn: string; contact: string }[];
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  reviews: DbStageSignupReview[];
}

export interface DbStageSignup {
  id: string;
  projectId: string;
  name: string;
  startAt: string;
  endAt: string;
  note: string;
  items: DbStageSignupItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbInviteCode {
  id: string;
  code: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string;
}

export interface DbProjectInvite {
  token: string;
  projectId: string;
  roleName: string;
  targetUserId: string | null;
  expiresAt: string;
}

export interface DbLostFoundItem {
  id: string;
  projectId: string;
  name: string;
  note: string;
  /** demo 不持久化照片，恒为 false */
  hasPhoto: boolean;
  foundAt: string;
  foundLocation: string;
  status: 'pending' | 'claimed';
  claimedAt: string | null;
  claimNote: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbLostFoundShare {
  projectId: string;
  token: string;
  enabled: boolean;
}

export interface Db {
  version: number;
  currentUserId: string;
  users: DbUser[];
  projects: DbProject[];
  memberships: DbMembership[];
  todos: DbTodo[];
  transactions: DbTransaction[];
  resourceTypes: DbResourceType[];
  resources: DbResource[];
  versions: DbResourceVersion[];
  accounts: DbAccount[];
  workModules: DbWorkModule[];
  physicalCategories: DbPhysicalCategory[];
  physicalItems: DbPhysicalItem[];
  physicalLogs: DbPhysicalLog[];
  announcements: DbAnnouncement[];
  risks: DbRisk[];
  activities: DbActivity[];
  milestones: DbMilestone[];
  incidents: DbIncident[];
  stageRundowns: DbStageRundown[];
  stageSignups: DbStageSignup[];
  lostFoundItems: DbLostFoundItem[];
  lostFoundShares: DbLostFoundShare[];
  dashboardPreferences: DbDashboardPreference[];
  inviteCodes: DbInviteCode[];
  invites: DbProjectInvite[];
  files: Record<string, DbFile>;
}

export interface Ctx {
  db: Db;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  origFetch: (input: string) => Promise<Response>;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
