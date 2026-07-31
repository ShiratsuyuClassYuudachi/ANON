import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import type { ProjectDoc } from '../models/Project';
import { Resource } from '../models/Resource';
import { ResourceVersion } from '../models/ResourceVersion';
import { Todo } from '../models/Todo';
import { Transaction } from '../models/Transaction';
import { WorkModule } from '../models/WorkModule';
import { RiskInstance } from '../models/RiskInstance';
import { Milestone } from '../models/Milestone';

// --- Types for API responses ---

export interface TodoSummary {
  total: number;
  done: number;
  open: number;
  overdue: number;
  dueThisWeek: number;
  completionRate: number; // 0-100
}

export interface FinanceDashboardSummary {
  ticketIncomeCents: number;
  incomeCents: number;
  expenseCents: number;
  profitCents: number;
}

export interface MaterialSummary {
  totalResources: number;
  noVersionCount: number;
  recentCount: number; // updated in last 7 days
}

export interface WorkSummary {
  totalModules: number;
  totalRequired: number;
  totalAssigned: number;
  confirmedCount: number;
  shortageCount: number; // modules where assigned < required
}

export interface DashboardMetrics {
  todoCompletionRate: number;
  overdueCount: number;
  budgetUsageRate: number | null; // null if no income data
  pendingMaterialCount: number;
  workConfirmationRate: number;
  memberCount: number;
  activeRiskCount: number;
}

export interface DashboardSummary {
  metrics: DashboardMetrics;
  modules: {
    todos: TodoSummary;
    finance: FinanceDashboardSummary | null;
    materials: MaterialSummary | null;
    work: WorkSummary | null;
  };
}

export interface ActionItem {
  id: string;
  sourceType: 'todo' | 'work';
  title: string;
  detail: string;
  dueAt: string | null;
  isOverdue: boolean;
  action: 'complete' | 'confirm';
}

export interface ScheduleItem {
  id: string;
  sourceType: 'todo' | 'work' | 'project' | 'milestone';
  title: string;
  time: string; // ISO
  allDay: boolean;
}

export interface ScheduleGroup {
  date: string; // YYYY-MM-DD
  label: string; // 今天 / 明天 / MM-DD
  items: ScheduleItem[];
}

// --- Core functions ---

export async function buildSummary(
  project: ProjectDoc,
  userId: string,
  permissions: Set<string>,
): Promise<DashboardSummary> {
  const projectId = project._id;
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 86400000);

  const [todos, transactions, resources, workModules, memberships, activeRisks] = await Promise.all([
    Todo.find({ projectId }),
    Transaction.find({ projectId }),
    Resource.find({ projectId }),
    WorkModule.find({ projectId }),
    Membership.find({ projectId }),
    RiskInstance.countDocuments({ projectId, status: 'active' }),
  ]);

  // Todo summary
  const todoTotal = todos.length;
  const todoDone = todos.filter((t) => t.status === 'done').length;
  const todoOpen = todoTotal - todoDone;
  const todoOverdue = todos.filter((t) => t.status === 'open' && t.dueAt && t.dueAt < now).length;
  const todoDueThisWeek = todos.filter(
    (t) => t.status === 'open' && t.dueAt && t.dueAt >= now && t.dueAt <= weekLater,
  ).length;
  const todoSummary: TodoSummary = {
    total: todoTotal,
    done: todoDone,
    open: todoOpen,
    overdue: todoOverdue,
    dueThisWeek: todoDueThisWeek,
    completionRate: todoTotal > 0 ? Math.round((todoDone / todoTotal) * 100) : 0,
  };

  // Finance summary (permission-gated)
  const canViewFinance =
    permissions.has('project:manage') || permissions.has('finance:manage') || permissions.has('finance:add');
  let financeSummary: FinanceDashboardSummary | null = null;
  if (canViewFinance) {
    const ticketTypes = project.ticketTypes ?? [];
    const ticketIncomeCents =
      ticketTypes.reduce((sum, t) => sum + t.priceCents * t.count, 0) +
      (project.ticketPriceCents ?? 0) * (project.ticketCount ?? 0);
    let incomeCents = 0;
    let expenseCents = 0;
    for (const t of transactions) {
      if (t.type === 'income') incomeCents += t.amountCents;
      else expenseCents += t.amountCents;
    }
    financeSummary = {
      ticketIncomeCents,
      incomeCents,
      expenseCents,
      profitCents: ticketIncomeCents + incomeCents - expenseCents,
    };
  }

  // Material summary (permission-gated: all members can see materials in this app)
  const resourceIds = resources.map((r) => r._id);
  const versions = resourceIds.length > 0 ? await ResourceVersion.find({ resourceId: { $in: resourceIds } }) : [];
  const versionByResource = new Map<string, number>();
  for (const v of versions) {
    const rid = v.resourceId.toString();
    versionByResource.set(rid, (versionByResource.get(rid) ?? 0) + 1);
  }
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const materialSummary: MaterialSummary = {
    totalResources: resources.length,
    noVersionCount: resources.filter((r) => !versionByResource.has(r._id.toString())).length,
    recentCount: resources.filter((r) => {
      const createdAt = (r as unknown as { createdAt: Date }).createdAt;
      return createdAt && createdAt >= sevenDaysAgo;
    }).length,
  };

  // Work summary
  let totalRequired = 0;
  let totalAssigned = 0;
  let confirmedCount = 0;
  let shortageCount = 0;
  for (const wm of workModules) {
    totalRequired += wm.requiredCount;
    totalAssigned += wm.assignees.length;
    confirmedCount += wm.assignees.filter((a) => a.confirmedAt).length;
    if (wm.assignees.length < wm.requiredCount) shortageCount++;
  }
  const workSummary: WorkSummary = {
    totalModules: workModules.length,
    totalRequired,
    totalAssigned,
    confirmedCount,
    shortageCount,
  };

  // Metrics
  const totalIncome = financeSummary ? financeSummary.ticketIncomeCents + financeSummary.incomeCents : 0;
  const metrics: DashboardMetrics = {
    todoCompletionRate: todoSummary.completionRate,
    overdueCount: todoOverdue,
    budgetUsageRate:
      financeSummary && totalIncome > 0 ? Math.round((financeSummary.expenseCents / totalIncome) * 100) : null,
    pendingMaterialCount: materialSummary.noVersionCount,
    workConfirmationRate: totalAssigned > 0 ? Math.round((confirmedCount / totalAssigned) * 100) : 100,
    memberCount: memberships.length,
    activeRiskCount: activeRisks,
  };

  return {
    metrics,
    modules: {
      todos: todoSummary,
      finance: financeSummary,
      materials: materialSummary,
      work: workSummary,
    },
  };
}

export async function buildMyActions(projectId: Types.ObjectId, userId: string): Promise<ActionItem[]> {
  const now = new Date();
  const actions: ActionItem[] = [];

  const [myTodos, myWorkModules] = await Promise.all([
    Todo.find({ projectId, status: 'open', assigneeIds: userId }),
    WorkModule.find({ projectId, 'assignees.userId': userId }),
  ]);

  for (const todo of myTodos) {
    const isOverdue = !!(todo.dueAt && todo.dueAt < now);
    actions.push({
      id: String(todo._id),
      sourceType: 'todo',
      title: todo.title,
      detail: todo.category || '待办',
      dueAt: todo.dueAt ? todo.dueAt.toISOString() : null,
      isOverdue,
      action: 'complete',
    });
  }

  for (const wm of myWorkModules) {
    const myAssignment = wm.assignees.find((a) => String(a.userId) === userId);
    if (myAssignment && !myAssignment.confirmedAt) {
      const isOverdue = !!(wm.startAt && wm.startAt < now);
      actions.push({
        id: String(wm._id),
        sourceType: 'work',
        title: `确认任务分配：${wm.name}`,
        detail: wm.location || '现场任务',
        dueAt: wm.startAt ? wm.startAt.toISOString() : null,
        isOverdue,
        action: 'confirm',
      });
    }
  }

  // Sort: overdue first, then by dueAt asc, then no-date last
  actions.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });

  return actions;
}

export async function buildSchedule(project: ProjectDoc, days: number = 7): Promise<ScheduleGroup[]> {
  const projectId = project._id;
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);

  const [todos, workModules, milestones] = await Promise.all([
    Todo.find({ projectId, status: 'open', dueAt: { $gte: now, $lte: end } }).sort({ dueAt: 1 }),
    WorkModule.find({ projectId, startAt: { $gte: now, $lte: end } }).sort({ startAt: 1 }),
    Milestone.find({ projectId, completedAt: { $exists: false }, date: { $gte: now, $lte: end } }).sort({ date: 1 }),
  ]);

  const items: ScheduleItem[] = [];

  for (const todo of todos) {
    items.push({
      id: String(todo._id),
      sourceType: 'todo',
      title: todo.title,
      time: todo.dueAt!.toISOString(),
      allDay: false,
    });
  }

  for (const wm of workModules) {
    items.push({
      id: String(wm._id),
      sourceType: 'work',
      title: wm.name,
      time: wm.startAt!.toISOString(),
      allDay: false,
    });
  }

  for (const ms of milestones) {
    items.push({
      id: String(ms._id),
      sourceType: 'milestone',
      title: ms.title,
      time: ms.date.toISOString(),
      allDay: true,
    });
  }

  // Add project start/end if within range
  if (project.startDate && project.startDate >= now && project.startDate <= end) {
    items.push({
      id: String(project._id),
      sourceType: 'project',
      title: '活动开始',
      time: project.startDate.toISOString(),
      allDay: false,
    });
  }
  if (project.endDate && project.endDate >= now && project.endDate <= end) {
    items.push({
      id: String(project._id),
      sourceType: 'project',
      title: '活动结束',
      time: project.endDate.toISOString(),
      allDay: false,
    });
  }

  // Sort all by time
  items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  // Group by date
  const groups = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const d = new Date(item.time);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getTime() + 86400000);
  const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  return [...groups.entries()].map(([date, groupItems]) => ({
    date,
    label: date === todayKey ? '今天' : date === tomorrowKey ? '明天' : date.slice(5).replace('-', '-'),
    items: groupItems,
  }));
}
