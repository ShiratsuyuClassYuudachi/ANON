import type {
  DashboardData,
  DashboardActionItem,
  DashboardPreferences,
  HealthStatus,
  OnsiteData,
  ProjectSummary,
  RiskItem,
  ScheduleGroup,
  ScheduleItem,
} from '../types';
import { canSee, currentStageOf, memberInfos, membersJson, nameOf } from './helpers';
import type { Db, DbAnnouncement, DbProject, DbRisk } from './types';

// 聚合规则 R1–R7：逻辑移植自后端源码（出处见各函数注释），按 demo store 现算，
// 保证会话内的修改在看板/列表/汇总上正确联动。

const DAY = 86400000;
const LEVEL_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** services/risk.ts computeHealth */
export function computeHealth(levels: string[]): HealthStatus {
  const criticals = levels.filter((l) => l === 'critical').length;
  const warnings = levels.filter((l) => l === 'warning').length;
  if (criticals > 0) return 'critical';
  if (warnings >= 2) return 'at_risk';
  if (warnings === 1 || levels.some((l) => l === 'info')) return 'attention';
  return 'normal';
}

function activeRisksOf(db: Db, projectId: string): DbRisk[] {
  return db.risks.filter((r) => r.projectId === projectId && r.status === 'active');
}

/** routes/dashboard.ts riskJson（dashboard 版：不含 ignored 系与 resolvedAt 字段） */
function riskJson(r: DbRisk): RiskItem {
  return {
    id: r.id,
    ruleCode: r.ruleCode,
    level: r.level,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    title: r.title,
    description: r.description,
    status: r.status,
    firstDetectedAt: r.firstDetectedAt,
    lastDetectedAt: r.lastDetectedAt,
  };
}

/** routes/risks.ts riskJson（全字段版，R4） */
export function riskJsonFull(r: DbRisk): RiskItem {
  return {
    ...riskJson(r),
    ignoredBy: r.ignoredBy,
    ignoredUntil: r.ignoredUntil,
    ignoreReason: r.ignoreReason,
  };
}

export function sortRisks(risks: DbRisk[]): DbRisk[] {
  return [...risks].sort(
    (a, b) =>
      (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9) ||
      new Date(b.lastDetectedAt).getTime() - new Date(a.lastDetectedAt).getTime(),
  );
}

/** R1 ProjectSummary（routes/projects.ts GET /） */
export function projectSummary(db: Db, p: DbProject): ProjectSummary {
  const todos = db.todos.filter((t) => t.projectId === p.id);
  const done = todos.filter((t) => t.status === 'done').length;
  const levels = activeRisksOf(db, p.id).map((r) => r.level);
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  const membership = db.memberships.find((m) => m.projectId === p.id && m.userId === db.currentUserId);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    myRole: membership?.roleName ?? null,
    currentStage: currentStageOf(p),
    stageProgress: { completed: stages.filter((s) => s.completedAt).length, total: stages.length },
    health: computeHealth(levels),
    todoCompletionRate: todos.length > 0 ? Math.round((done / todos.length) * 100) : 0,
    activeRiskCount: levels.length,
  };
}

/** R3 metrics + modules（services/dashboard.ts buildSummary） */
export function buildSummary(db: Db, p: DbProject) {
  const now = Date.now();
  const weekLater = now + 7 * DAY;
  const todos = db.todos.filter((t) => t.projectId === p.id);
  const txs = db.transactions.filter((t) => t.projectId === p.id);
  const resources = db.resources.filter((r) => r.projectId === p.id);
  const modules = db.workModules.filter((m) => m.projectId === p.id);
  const members = membersJson(db, p.id);
  const activeRisks = activeRisksOf(db, p.id).length;

  const total = todos.length;
  const done = todos.filter((t) => t.status === 'done').length;
  const overdue = todos.filter((t) => t.status === 'open' && t.dueAt && new Date(t.dueAt).getTime() < now).length;
  const dueThisWeek = todos.filter(
    (t) => t.status === 'open' && t.dueAt && new Date(t.dueAt).getTime() >= now && new Date(t.dueAt).getTime() <= weekLater,
  ).length;
  const todoSummary = {
    total,
    done,
    open: total - done,
    overdue,
    dueThisWeek,
    completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
  };

  const ticketIncomeCents =
    p.ticketTypes.reduce((s, t) => s + t.priceCents * t.count, 0) + p.ticketPriceCents * p.ticketCount;
  let incomeCents = 0;
  let expenseCents = 0;
  for (const t of txs) {
    if (t.type === 'income') incomeCents += t.amountCents;
    else expenseCents += t.amountCents;
  }
  const financeSummary = {
    ticketIncomeCents,
    incomeCents,
    expenseCents,
    profitCents: ticketIncomeCents + incomeCents - expenseCents,
  };

  const versionCount = new Map<string, number>();
  for (const v of db.versions) {
    versionCount.set(v.resourceId, (versionCount.get(v.resourceId) ?? 0) + 1);
  }
  const sevenDaysAgo = now - 7 * DAY;
  const materialSummary = {
    totalResources: resources.length,
    noVersionCount: resources.filter((r) => !versionCount.has(r.id)).length,
    recentCount: resources.filter((r) => new Date(r.createdAt).getTime() >= sevenDaysAgo).length,
  };

  let totalRequired = 0;
  let totalAssigned = 0;
  let confirmedCount = 0;
  let shortageCount = 0;
  for (const m of modules) {
    totalRequired += m.requiredCount;
    totalAssigned += m.assignees.length;
    confirmedCount += m.assignees.filter((a) => a.confirmedAt).length;
    if (m.assignees.length < m.requiredCount) shortageCount++;
  }
  const workSummary = {
    totalModules: modules.length,
    totalRequired,
    totalAssigned,
    confirmedCount,
    shortageCount,
  };

  const totalIncome = ticketIncomeCents + incomeCents;
  return {
    metrics: {
      todoCompletionRate: todoSummary.completionRate,
      overdueCount: overdue,
      budgetUsageRate: totalIncome > 0 ? Math.round((expenseCents / totalIncome) * 100) : null,
      pendingMaterialCount: materialSummary.noVersionCount,
      workConfirmationRate: totalAssigned > 0 ? Math.round((confirmedCount / totalAssigned) * 100) : 100,
      memberCount: members.length,
      activeRiskCount: activeRisks,
    },
    modules: {
      todos: todoSummary,
      finance: financeSummary,
      materials: materialSummary,
      work: workSummary,
    },
  };
}

/** R3 待我处理（services/dashboard.ts buildMyActions） */
export function buildMyActions(db: Db, p: DbProject): DashboardActionItem[] {
  const now = Date.now();
  const me = db.currentUserId;
  const actions: DashboardActionItem[] = [];

  for (const t of db.todos.filter((x) => x.projectId === p.id && x.status === 'open' && x.assigneeIds.includes(me))) {
    const isOverdue = !!(t.dueAt && new Date(t.dueAt).getTime() < now);
    actions.push({
      id: t.id,
      sourceType: 'todo',
      title: t.title,
      detail: t.category || '待办',
      dueAt: t.dueAt,
      isOverdue,
      action: 'complete',
    });
  }

  for (const m of db.workModules.filter((x) => x.projectId === p.id && x.assignees.some((a) => a.userId === me))) {
    const mine = m.assignees.find((a) => a.userId === me)!;
    if (!mine.confirmedAt) {
      const isOverdue = !!(m.startAt && new Date(m.startAt).getTime() < now);
      actions.push({
        id: m.id,
        sourceType: 'work',
        title: `确认任务分配：${m.name}`,
        detail: m.location || '现场任务',
        dueAt: m.startAt,
        isOverdue,
        action: 'confirm',
      });
    }
  }

  actions.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
  return actions;
}

/** R3 近期日程（services/dashboard.ts buildSchedule） */
export function buildSchedule(db: Db, p: DbProject, days: number): ScheduleGroup[] {
  const now = Date.now();
  const end = now + days * DAY;
  const inWindow = (iso: string | null) => iso !== null && new Date(iso).getTime() >= now && new Date(iso).getTime() <= end;

  const items: ScheduleItem[] = [];
  for (const t of db.todos.filter((x) => x.projectId === p.id && x.status === 'open' && inWindow(x.dueAt))) {
    items.push({ id: t.id, sourceType: 'todo', title: t.title, time: t.dueAt!, allDay: false });
  }
  for (const m of db.workModules.filter((x) => x.projectId === p.id && inWindow(x.startAt))) {
    items.push({ id: m.id, sourceType: 'work', title: m.name, time: m.startAt!, allDay: false });
  }
  for (const ms of db.milestones.filter((x) => x.projectId === p.id && !x.completedAt && inWindow(x.date))) {
    items.push({ id: ms.id, sourceType: 'milestone', title: ms.title, time: ms.date, allDay: true });
  }
  if (inWindow(p.startDate)) {
    items.push({ id: p.id, sourceType: 'project', title: '活动开始', time: p.startDate!, allDay: false });
  }
  if (inWindow(p.endDate)) {
    items.push({ id: p.id, sourceType: 'project', title: '活动结束', time: p.endDate!, allDay: false });
  }

  items.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const groups = new Map<string, ScheduleItem[]>();
  for (const item of items) {
    const key = dayKey(new Date(item.time));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  const todayKey = dayKey(new Date());
  const tomorrowKey = dayKey(new Date(Date.now() + DAY));
  return [...groups.entries()].map(([date, groupItems]) => ({
    date,
    label: date === todayKey ? '今天' : date === tomorrowKey ? '明天' : date.slice(5),
    items: groupItems,
  }));
}

export const DEFAULT_PREFS: DashboardPreferences = {
  defaultView: 'project',
  collapsedCards: [],
  hiddenCards: [],
  scheduleRange: 7,
  cardOrder: [],
};

export function prefsOf(db: Db, projectId: string): DashboardPreferences {
  const doc = db.dashboardPreferences.find((x) => x.projectId === projectId && x.userId === db.currentUserId);
  return doc
    ? {
        defaultView: doc.defaultView,
        collapsedCards: doc.collapsedCards,
        hiddenCards: doc.hiddenCards,
        scheduleRange: doc.scheduleRange,
        cardOrder: doc.cardOrder,
      }
    : { ...DEFAULT_PREFS };
}

/** routes/announcements.ts 列表端点单条 shape（看板聚合与管理列表共用） */
export function announcementJson(db: Db, a: DbAnnouncement) {
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    type: a.type,
    isPinned: a.isPinned,
    requireConfirmation: a.requireConfirmation,
    publishedBy: { userId: a.publishedBy, name: nameOf(db, a.publishedBy) },
    publishedAt: a.publishedAt,
    expiresAt: a.expiresAt,
    confirmedByMe: a.confirmedBy.includes(db.currentUserId),
  };
}

function buildAnnouncements(db: Db, p: DbProject, membershipRole: string | null, limit = 5) {
  const now = Date.now();
  const visible = db.announcements
    .filter((a) => a.projectId === p.id && (!a.expiresAt || new Date(a.expiresAt).getTime() > now))
    .filter((a) => canSee(a.visibility, db.currentUserId, membershipRole))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
  return visible.map((a) => announcementJson(db, a));
}

function buildActivities(db: Db, p: DbProject, permissions: Set<string>, limit = 10) {
  return db.activities
    .filter((a) => a.projectId === p.id)
    .filter((a) => !a.permissionGate || permissions.has(a.permissionGate) || permissions.has('project:manage'))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      actor: { userId: a.actorId, name: nameOf(db, a.actorId) },
      type: a.type,
      message: a.message,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      createdAt: a.createdAt,
    }));
}

/** R3 DashboardData 整体（routes/dashboard.ts GET /） */
export function buildDashboard(db: Db, p: DbProject, membershipRole: string | null, permissions: Set<string>, scheduleDays: number): DashboardData {
  const prefs = prefsOf(db, p.id);
  const days = Math.min(scheduleDays || prefs.scheduleRange, 30);
  const active = sortRisks(activeRisksOf(db, p.id));
  return {
    summary: buildSummary(db, p),
    myActions: { items: buildMyActions(db, p) },
    risks: { risks: active.map(riskJson), health: computeHealth(active.map((r) => r.level)) },
    schedule: { groups: buildSchedule(db, p, days) },
    announcements: { items: buildAnnouncements(db, p, membershipRole) },
    activities: { items: buildActivities(db, p, permissions) },
    preferences: prefs,
  };
}

/** R5 财务汇总（services/finance.ts buildSummary） */
export function buildFinanceSummary(db: Db, p: DbProject) {
  const members = memberInfos(db, p.id);
  const txs = db.transactions.filter((t) => t.projectId === p.id);
  const memberIds = members.map((m) => m.userId);
  const net = new Map<string, number>(memberIds.map((id) => [id, 0]));
  const add = (id: string, v: number) => net.set(id, (net.get(id) ?? 0) + v);

  /** 整数分均摊：余数按顺序每人多摊 1 分；支出分摊取负、公款池盈余取正，由调用方决定符号 */
  const sharesOf = (amountCents: number, ids: string[]) => {
    const base = Math.floor(amountCents / ids.length);
    const rem = amountCents - base * ids.length;
    return ids.map((id, i) => ({ id, share: base + (i < rem ? 1 : 0) }));
  };

  const ticketTypes = p.ticketTypes.map((t) => ({ name: t.name, priceCents: t.priceCents, count: t.count }));
  const ticketIncomeCents =
    ticketTypes.reduce((s, t) => s + t.priceCents * t.count, 0) + p.ticketPriceCents * p.ticketCount;
  let incomeCents = 0;
  let expenseCents = 0;
  let commonExpenseCents = 0;

  for (const t of txs) {
    if (t.type === 'income') {
      incomeCents += t.amountCents;
      add(t.payerUserId, -t.amountCents);
    } else {
      expenseCents += t.amountCents;
      add(t.payerUserId, t.amountCents);
      if (t.splitAmong.length === 0) commonExpenseCents += t.amountCents;
      else for (const { id, share } of sharesOf(t.amountCents, t.splitAmong)) add(id, -share);
    }
  }

  const poolProfitCents = ticketIncomeCents + incomeCents - commonExpenseCents;
  for (const { id, share } of sharesOf(poolProfitCents, memberIds)) add(id, share);

  const perUser = members.map((m) => ({ ...m, netCents: net.get(m.userId) ?? 0 }));
  const nameOfId = new Map(members.map((m) => [m.userId, m.name]));
  const debtors = perUser
    .filter((x) => x.netCents < 0)
    .map((x) => ({ ...x }))
    .sort((a, b) => a.netCents - b.netCents || a.userId.localeCompare(b.userId));
  const creditors = perUser
    .filter((x) => x.netCents > 0)
    .map((x) => ({ ...x }))
    .sort((a, b) => b.netCents - a.netCents || a.userId.localeCompare(b.userId));

  const settlement: { from: { userId: string; name: string }; to: { userId: string; name: string }; amountCents: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(-d.netCents, c.netCents);
    if (amount > 0) {
      settlement.push({
        from: { userId: d.userId, name: nameOfId.get(d.userId) ?? '' },
        to: { userId: c.userId, name: nameOfId.get(c.userId) ?? '' },
        amountCents: amount,
      });
    }
    d.netCents += amount;
    c.netCents -= amount;
    if (d.netCents === 0) i += 1;
    if (c.netCents === 0) j += 1;
  }

  return {
    ticketPriceCents: p.ticketPriceCents,
    ticketCount: p.ticketCount,
    ticketTypes,
    ticketIncomeCents,
    incomeCents,
    expenseCents,
    profitCents: ticketIncomeCents + incomeCents - expenseCents,
    perUser,
    settlement,
  };
}

/** R7 现场模式（routes/onsite.ts GET /） */
export function buildOnsite(db: Db, p: DbProject, membershipRole: string | null, permissions: Set<string>): OnsiteData {
  const me = db.currentUserId;
  const now = new Date();
  const nowMs = now.getTime();

  const STATE_ORDER = { current: 0, upcoming: 1, done: 2 } as const;
  const myModules = db.workModules
    .filter((m) => m.projectId === p.id && m.assignees.some((a) => a.userId === me))
    .map((m) => {
      const mine = m.assignees.find((a) => a.userId === me)!;
      const startMs = m.startAt ? new Date(m.startAt).getTime() : null;
      const endMs = m.endAt ? new Date(m.endAt).getTime() : null;
      const state: 'current' | 'upcoming' | 'done' = mine.completedAt
        ? 'done'
        : startMs !== null && startMs <= nowMs && (endMs === null || endMs >= nowMs)
          ? 'current'
          : 'upcoming';
      return {
        id: m.id,
        name: m.name,
        location: m.location || null,
        startAt: m.startAt,
        endAt: m.endAt,
        myAssignee: {
          confirmedAt: mine.confirmedAt,
          checkedInAt: mine.checkedInAt,
          completedAt: mine.completedAt,
        },
        state,
        startAtTs: startMs ?? Number.POSITIVE_INFINITY,
      };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.startAtTs - b.startAtTs)
    .map(({ startAtTs: _ts, ...rest }) => rest);

  const emergency = db.announcements
    .filter((a) => a.projectId === p.id && (a.type === 'emergency' || a.type === 'important'))
    .filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > nowMs)
    .filter((a) => canSee(a.visibility, me, membershipRole))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 5)
    .map((a) => ({ id: a.id, title: a.title, content: a.content, type: a.type as 'emergency' | 'important', publishedAt: a.publishedAt }));

  const contacts = membersJson(db, p.id)
    .map((m) => {
      const u = db.users.find((x) => x.id === m.userId);
      return { userId: m.userId, name: m.name, roleName: m.roleName as string | null, contacts: u?.contacts ?? [] };
    })
    .filter((c) => c.contacts.length > 0);

  const moduleNameOf = new Map(db.workModules.filter((m) => m.projectId === p.id).map((m) => [m.id, m.name]));
  const incidents = db.incidents
    .filter((x) => x.projectId === p.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50)
    .map((x) => ({
      id: x.id,
      category: x.category,
      note: x.note,
      moduleId: x.moduleId,
      moduleName: x.moduleId ? (moduleNameOf.get(x.moduleId) ?? null) : null,
      reporter: { userId: x.reporterId, name: nameOf(db, x.reporterId) },
      status: x.status,
      createdAt: x.createdAt,
    }));

  return { now: now.toISOString(), myModules, emergency, contacts, incidents, myPermissions: [...permissions] };
}
