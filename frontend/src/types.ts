export interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  contacts: { platform: string; value: string }[];
}
export interface ProjectSummary {
  id: string; name: string; description: string;
  startDate: string | null; endDate: string | null; myRole: string | null;
}
export interface Role { name: string; permissions: string[]; }
export interface Member { userId: string; name: string; email: string; roleName: string; }
export interface ProjectDetail {
  id: string; name: string; description: string;
  startDate: string | null; endDate: string | null;
  roles: Role[]; createdBy: string;
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
