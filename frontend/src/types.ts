export interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  contacts: { platform: string; value: string }[];
  onboardedAt: string | null;
}
export type ProjectStatus = 'draft' | 'preparing' | 'active' | 'settling' | 'completed' | 'archived' | 'cancelled';
export interface StageItem {
  id: string; name: string; order: number; completedAt: string | null; note: string;
}
export interface MilestoneItem {
  id: string; title: string; date: string; description: string;
  stageId: string | null; stageName: string | null;
  completedAt: string | null; createdBy: { userId: string; name: string };
}
export interface ProjectSummary {
  id: string; name: string; description: string; status: ProjectStatus;
  startDate: string | null; endDate: string | null; myRole: string | null;
  currentStage: string; stageProgress: { completed: number; total: number };
  health: HealthStatus; todoCompletionRate: number; activeRiskCount: number;
}
export interface Role { name: string; permissions: string[]; }
export interface Member { userId: string; name: string; email: string; roleName: string; }
export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  location: string;
  timezone: string;
  currentStage: string;
  stages: StageItem[];
  roles: Role[];
  createdBy: string;
}
export interface TodoUpdateItem {
  note: string; createdBy: string; createdByName: string; createdAt: string;
  attachments: { id: string; filename: string }[];
}
export interface TodoItem {
  id: string; title: string; category: string;
  assignees: { userId: string; name: string }[];
  nodeAt: string | null; dueAt: string | null; remindAt: string | null;
  status: 'open' | 'done'; note: string; createdAt: string;
  completedAt: string | null; completedBy: string | null; completionNote: string | null;
  attachments: { id: string; filename: string }[];
  updates: TodoUpdateItem[];
}
export interface TxUser { userId: string; name: string; }
export interface TransactionItem {
  id: string; type: 'income' | 'expense'; amountCents: number; note: string;
  payer: TxUser; splitAmong: TxUser[];
  createdBy: string; createdByName: string; createdAt: string;
  attachments: { id: string; filename: string }[];
}
export interface TicketType { name: string; priceCents: number; count: number; }
export interface FinanceSummary {
  ticketPriceCents: number; ticketCount: number; ticketIncomeCents: number;
  ticketTypes: TicketType[];
  incomeCents: number; expenseCents: number; profitCents: number;
  perUser: { userId: string; name: string; netCents: number }[];
  settlement: { from: TxUser; to: TxUser; amountCents: number }[];
}
export interface Visibility { userIds: string[]; roleNames: string[]; }
export interface ResourceTypeItem { id: string; name: string; visibility: Visibility; }
export interface ResourceItem {
  id: string; typeId: string; name: string; description: string;
  visibility: Visibility; latestVersion: number; hasPreview: boolean; createdAt: string;
}
export interface ResourceVersionItem {
  version: number; note: string; hasPreview: boolean; createdBy: string; createdAt: string;
  file: { id: string; filename: string; mime: string; size: number } | null;
}
export interface PlatformAccountItem {
  id: string; platform: string; account: string;
  mode: 'full' | 'otp' | 'contact';
  cipherKeySource: 'user' | 'server' | null;
  hasPassword: boolean; note: string;
  addedBy: { userId: string; name: string; contacts: { platform: string; value: string }[] } | null;
  visibility: { userIds: string[]; roleNames: string[] };
  createdAt: string;
}
export interface WorkAssignee {
  userId: string; name: string;
  confirmedAt: string | null; confirmedBy: string | null;
}
export interface WorkModuleItem {
  id: string; name: string; description: string; location: string;
  startAt: string | null; endAt: string | null; requiredCount: number;
  assignees: WorkAssignee[]; createdBy: string; createdAt: string;
}
export interface WorkSheetData {
  project: { id: string; name: string };
  user: { id: string; name: string };
  generatedAt: string;
  items: WorkModuleItem[];
}

// --- Dashboard ---

export interface DashboardMetrics {
  todoCompletionRate: number;
  overdueCount: number;
  budgetUsageRate: number | null;
  pendingMaterialCount: number;
  workConfirmationRate: number;
  memberCount: number;
  activeRiskCount: number;
}
export interface DashboardSummary {
  metrics: DashboardMetrics;
  modules: {
    todos: { total: number; done: number; open: number; overdue: number; dueThisWeek: number; completionRate: number };
    finance: { ticketIncomeCents: number; incomeCents: number; expenseCents: number; profitCents: number } | null;
    materials: { totalResources: number; noVersionCount: number; recentCount: number } | null;
    work: { totalModules: number; totalRequired: number; totalAssigned: number; confirmedCount: number; shortageCount: number } | null;
  };
}
export interface DashboardActionItem {
  id: string; sourceType: 'todo' | 'work'; title: string; detail: string;
  dueAt: string | null; isOverdue: boolean; action: 'complete' | 'confirm';
}
export interface ScheduleItem {
  id: string; sourceType: 'todo' | 'work' | 'project' | 'milestone'; title: string; time: string; allDay: boolean;
}
export interface ScheduleGroup { date: string; label: string; items: ScheduleItem[]; }
export interface RiskItem {
  id: string; ruleCode: string; level: 'info' | 'warning' | 'critical';
  sourceType: string; sourceId: string | null; title: string; description: string;
  status: string; firstDetectedAt: string; lastDetectedAt: string;
  ignoredBy?: string | null; ignoredUntil?: string | null; ignoreReason?: string | null;
}
export type HealthStatus = 'normal' | 'attention' | 'at_risk' | 'critical';
export interface AnnouncementItem {
  id: string; title: string; content: string;
  type: 'normal' | 'important' | 'emergency';
  isPinned: boolean; requireConfirmation: boolean;
  publishedBy: { userId: string; name: string };
  publishedAt: string; expiresAt: string | null;
  confirmedByMe: boolean;
}
export interface AnnouncementListResponse { announcements: AnnouncementItem[]; total: number; page: number; }
export interface AnnouncementConfirmations {
  confirmed: { userId: string; name: string }[];
  unconfirmed: { userId: string; name: string }[];
}
export interface ActivityItem {
  id: string; actor: { userId: string; name: string };
  type: string; message: string;
  sourceType: string; sourceId: string | null;
  createdAt: string;
}
export interface DashboardPreferences {
  defaultView: 'personal' | 'project';
  collapsedCards: string[];
  hiddenCards: string[];
  scheduleRange: 7 | 30;
  cardOrder: string[];
}
// --- Onsite (现场模式) ---

export interface OnsiteAssignee {
  confirmedAt: string | null;
  checkedInAt: string | null;
  completedAt: string | null;
}
export type OnsiteModuleState = 'current' | 'upcoming' | 'done';
export interface OnsiteModule {
  id: string; name: string; location: string | null;
  startAt: string | null; endAt: string | null;
  myAssignee: OnsiteAssignee | null;
  state: OnsiteModuleState;
}
export interface OnsiteAnnouncement {
  id: string; title: string; content: string;
  type: 'emergency' | 'important'; publishedAt: string;
}
export interface OnsiteContact {
  userId: string; name: string; roleName: string | null;
  contacts: { platform: string; value: string }[];
}
export type IncidentCategory = 'equipment' | 'staff' | 'material' | 'venue' | 'safety' | 'other';
export interface OnsiteIncident {
  id: string; category: IncidentCategory; note: string;
  moduleId: string | null; moduleName: string | null;
  reporter: { userId: string; name: string };
  status: 'open' | 'resolved'; createdAt: string;
}
export interface OnsiteRundown {
  id: string; name: string; status: 'idle' | 'running'; startAt: string; itemCount: number;
  currentIndex: number | null; currentItemId: string | null; currentItemName: string | null;
  currentPlannedStart: string | null; currentActualStart: string | null; shiftMin: number;
}
export interface OnsiteData {
  now: string;
  myModules: OnsiteModule[];
  emergency: OnsiteAnnouncement[];
  contacts: OnsiteContact[];
  incidents: OnsiteIncident[];
  rundowns: OnsiteRundown[];
  myPermissions: string[];
}

export interface DashboardData {
  summary: DashboardSummary;
  myActions: { items: DashboardActionItem[] };
  risks: { risks: RiskItem[]; health: HealthStatus };
  schedule: { groups: ScheduleGroup[] };
  announcements: { items: AnnouncementItem[] };
  activities: { items: ActivityItem[] };
  preferences: DashboardPreferences;
}

// --- Physical Inventory (实物清单) ---

export interface PhysicalCategoryItem { id: string; name: string; order: number; }
export type PhysicalItemStatus = 'planned' | 'in_stock' | 'in_use' | 'returned' | 'disposed';
export const PHYSICAL_STATUS_LABELS: Record<PhysicalItemStatus, string> = {
  planned: '计划中', in_stock: '已入库', in_use: '使用中', returned: '已归还', disposed: '已处置',
};
export interface PhysicalItemRef { userId: string; name: string; }
export interface PhysicalItemItem {
  id: string; categoryId: string; name: string; spec: string; unit: string;
  plannedQty: number; onHandQty: number; usedQty: number; lostQty: number;
  status: PhysicalItemStatus; responsible: PhysicalItemRef | null;
  location: string; tags: string[]; note: string;
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface PhysicalLogItem {
  id: string; type: string; qty: number; status: PhysicalItemStatus | null; note: string;
  operator: PhysicalItemRef; createdAt: string;
}
export interface PhysicalSummary {
  total: { planned: number; onHand: number; used: number; lost: number; count: number };
  byCategory: { categoryId: string; planned: number; onHand: number; used: number; lost: number; count: number }[];
}

// --- Tools (实用工具) · 舞台 Rundown ---

export interface StageParticipant { cn: string; contact: string }
export interface StageRundownAttachment { id: string; filename: string; mime: string; size: number }
export interface StageRundownItem {
  id: string; name: string; durationMin: number;
  participants: StageParticipant[]; attachments: StageRundownAttachment[]; note: string;
}
export type StageExecutionStatus = 'idle' | 'running' | 'finished';
export interface StageActual { itemId: string; startedAt: string; endedAt: string | null }
export interface StageExecution {
  status: StageExecutionStatus; currentItemId: string | null;
  startedAt: string | null; finishedAt: string | null;
  shiftMin: number; actuals: StageActual[];
}
export interface StageRundown {
  id: string; name: string; startAt: string; note: string;
  items: StageRundownItem[]; execution: StageExecution;
  createdBy: string; createdAt: string; updatedAt: string;
}
export interface StageRundownSummary {
  id: string; name: string; startAt: string; note: string;
  itemCount: number; totalDurationMin: number; executionStatus: StageExecutionStatus;
  createdAt: string; updatedAt: string;
}
export interface StageScreenShareInfo { enabled: boolean; token: string }

// 现场大屏公开端点（白名单：无 contact/note/attachments）
export interface PublicScreenParticipant { cn: string }
export interface PublicScreenItem { id: string; name: string; durationMin: number; participants: PublicScreenParticipant[] }
export interface PublicScreenRundown { name: string; startAt: string; items: PublicScreenItem[]; execution: StageExecution }
export interface PublicScreenAnnouncement { id: string; title: string; content: string; publishedAt: string }
export interface PublicRundownScreenResponse {
  projectName: string; now: string;
  rundown: PublicScreenRundown; announcements: PublicScreenAnnouncement[];
}

// --- Tools (实用工具) · 舞台报名审核 ---

export interface StageSignupReview {
  userId: string; userName: string; decision: 'approve' | 'reject'; comment: string; updatedAt: string;
}
export interface StageSignupItem {
  id: string; name: string; durationMin: number;
  participants: StageParticipant[]; note: string;
  status: 'pending' | 'approved' | 'rejected'; reviews: StageSignupReview[];
}
export interface StageSignup {
  id: string; name: string; startAt: string; endAt: string; note: string;
  items: StageSignupItem[]; createdBy: string; createdAt: string; updatedAt: string;
}
export interface StageSignupSummary {
  id: string; name: string; startAt: string; endAt: string; note: string;
  itemCount: number; approvedCount: number; totalDurationMin: number; availableMin: number;
  createdAt: string; updatedAt: string;
}

export interface LostFoundItem {
  id: string;
  name: string;
  note: string;
  foundAt: string;
  foundLocation: string;
  status: 'pending' | 'claimed';
  claimedAt: string | null;
  claimNote: string;
  hasPhoto: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LostFoundShareInfo {
  enabled: boolean;
  token: string;
}

/** 公开查找页物品（后端白名单字段，无 claimNote） */
export interface PublicLostFoundItem {
  id: string;
  name: string;
  note: string;
  foundAt: string;
  foundLocation: string;
  status: 'pending' | 'claimed';
  claimedAt: string | null;
  hasPhoto: boolean;
}

export interface PublicLostFoundResponse {
  projectName: string;
  items: PublicLostFoundItem[];
}
