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
export interface TodoItem {
  id: string; title: string; category: string;
  assignees: { userId: string; name: string }[];
  nodeAt: string | null; dueAt: string | null; remindAt: string | null;
  status: 'open' | 'done'; note: string; createdAt: string;
  completedAt: string | null; completedBy: string | null; completionNote: string | null;
  attachments: { id: string; filename: string }[];
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
export interface DashboardData {
  summary: DashboardSummary;
  myActions: { items: DashboardActionItem[] };
  risks: { risks: RiskItem[]; health: HealthStatus };
  schedule: { groups: ScheduleGroup[] };
  announcements: { items: AnnouncementItem[] };
  activities: { items: ActivityItem[] };
  preferences: DashboardPreferences;
}
