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
