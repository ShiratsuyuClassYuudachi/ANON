import { badRequest, bodyObj, err, form, formFiles, formStr, json, nameOf, notFound, nowIso, parseDateField, requireProject, storeUpload, uid } from '../helpers';
import { def, type Route } from '../router';
import type { Ctx, Db, DbTodo } from '../types';

function todoJson(db: Db, t: DbTodo) {
  const fileRef = (id: string) => {
    const f = db.files[id];
    return f ? { id, filename: f.filename } : null;
  };
  return {
    id: t.id,
    title: t.title,
    category: t.category,
    assignees: t.assigneeIds
      .map((id) => ({ userId: id, name: nameOf(db, id) }))
      .filter((a) => !!a.name),
    nodeAt: t.nodeAt,
    dueAt: t.dueAt,
    remindAt: t.remindAt,
    status: t.status,
    note: t.note,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    completedBy: t.completedBy,
    completionNote: t.completionNote,
    attachments: t.attachments.map(fileRef).filter((x): x is { id: string; filename: string } => !!x),
    updates: t.updates.map((u) => ({
      note: u.note,
      createdBy: u.createdBy,
      createdByName: nameOf(db, u.createdBy),
      createdAt: u.createdAt,
      attachments: u.attachments.map(fileRef).filter((x): x is { id: string; filename: string } => !!x),
    })),
  };
}

function findTodo(ctx: Ctx): DbTodo {
  const { db, params } = ctx;
  const t = db.todos.find((x) => x.id === params.tid && x.projectId === params.pid);
  if (!t) throw notFound('待办不存在');
  return t;
}

/** 保存 FormData 附件并返回文件 id 列表 */
async function saveAttachments(db: Db, fd: FormData): Promise<string[]> {
  const ids: string[] = [];
  for (const f of formFiles(fd)) ids.push(await storeUpload(db, f));
  return ids;
}

const SORTS: Record<string, 'dueAt' | 'nodeAt' | 'createdAt'> = { dueAt: 'dueAt', nodeAt: 'nodeAt', createdAt: 'createdAt' };

export const todoRoutes: Route[] = [
  def('GET', '/api/projects/:pid/todos', async (ctx) => {
    const { db, query, params } = ctx;
    requireProject(ctx);
    const category = query.get('category');
    const assignee = query.get('assignee');
    const status = query.get('status');
    const sortField = SORTS[query.get('sort') ?? ''] ?? 'createdAt';
    const dir = query.get('order') === 'asc' ? 1 : -1;
    const todos = db.todos
      .filter((t) => t.projectId === params.pid)
      .filter((t) => !category || t.category === category)
      .filter((t) => !assignee || t.assigneeIds.includes(assignee))
      // 与后端一致：status 仅接受 open/done，其他值（如 all）忽略
      .filter((t) => (status === 'open' || status === 'done') ? t.status === status : true)
      .sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        // null 一律排尾
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (new Date(av).getTime() - new Date(bv).getTime()) * dir;
      });
    return json({ todos: todos.map((t) => todoJson(db, t)) });
  }),

  def('POST', '/api/projects/:pid/todos', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    if (!b.title || !String(b.title).trim()) return badRequest('标题必填');
    const assigneeIds = Array.isArray(b.assigneeIds) ? [...new Set(b.assigneeIds.map(String))] : [];
    const members = db.memberships.filter((m) => m.projectId === params.pid);
    if (assigneeIds.some((id) => !members.some((m) => m.userId === id))) return badRequest('指派人必须是项目成员');
    const todo: DbTodo = {
      id: uid(),
      projectId: params.pid,
      title: String(b.title).trim(),
      category: String(b.category ?? ''),
      assigneeIds,
      nodeAt: parseDateField(b.nodeAt),
      dueAt: parseDateField(b.dueAt),
      remindAt: parseDateField(b.remindAt),
      status: 'open',
      note: String(b.note ?? ''),
      createdBy: db.currentUserId,
      createdAt: nowIso(),
      completedAt: null,
      completedBy: null,
      completionNote: null,
      attachments: [],
      updates: [],
    };
    db.todos.push(todo);
    return json({ todo: todoJson(db, todo) }, 201);
  }),

  // 模板导出：烘焙示例模板（anchorField=end，锚定项目结束日）
  def('GET', '/api/projects/:pid/todos/template/export', async (ctx) => {
    const { project } = requireProject(ctx);
    const DAY = 86400000;
    const anchor = project.endDate ?? project.startDate ?? nowIso();
    return json({
      name: '示例模板',
      exportedAt: nowIso(),
      anchorField: 'end',
      anchorDate: anchor,
      todos: [
        { title: '确定主题与分工', category: '筹备', note: '', nodeOffsetMs: -60 * DAY, dueOffsetMs: -55 * DAY, remindOffsetMs: null },
        { title: '开票公告发布', category: '宣传', note: '', nodeOffsetMs: -21 * DAY, dueOffsetMs: -20 * DAY, remindOffsetMs: -21 * DAY },
        { title: '物料清单与采购', category: '物料', note: '', nodeOffsetMs: -14 * DAY, dueOffsetMs: -7 * DAY, remindOffsetMs: null },
        { title: '布展与动线确认', category: '现场', note: '', nodeOffsetMs: -2 * DAY, dueOffsetMs: -1 * DAY, remindOffsetMs: -2 * DAY },
        { title: '结算与复盘', category: '财务', note: '', nodeOffsetMs: 1 * DAY, dueOffsetMs: 3 * DAY, remindOffsetMs: null },
      ],
    });
  }),

  def('POST', '/api/projects/:pid/todos/template/import', async (ctx) => {
    const { db, params } = ctx;
    requireProject(ctx);
    const b = bodyObj(ctx);
    const template = b.template as { todos?: { title: string; category?: string; note?: string; nodeOffsetMs: number | null; dueOffsetMs: number | null; remindOffsetMs: number | null }[] } | undefined;
    if (!template || !Array.isArray(template.todos)) return badRequest('模板格式无效');
    if (b.anchor !== 'start' && b.anchor !== 'end') return badRequest('anchor 必须是 start 或 end');
    const anchorDate = new Date(String(b.date ?? ''));
    if (Number.isNaN(anchorDate.getTime())) return badRequest('锚定日期无效');
    const base = anchorDate.getTime();
    const at = (offset: number | null) => (offset === null ? null : new Date(base + offset).toISOString());
    for (const t of template.todos) {
      db.todos.push({
        id: uid(),
        projectId: params.pid,
        title: String(t.title ?? ''),
        category: String(t.category ?? ''),
        assigneeIds: [],
        nodeAt: at(t.nodeOffsetMs),
        dueAt: at(t.dueOffsetMs),
        remindAt: at(t.remindOffsetMs),
        status: 'open',
        note: String(t.note ?? ''),
        createdBy: db.currentUserId,
        createdAt: nowIso(),
        completedAt: null,
        completedBy: null,
        completionNote: null,
        attachments: [],
        updates: [],
      });
    }
    return json({ created: template.todos.length }, 201);
  }),

  def('PATCH', '/api/projects/:pid/todos/:tid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const todo = findTodo(ctx);
    const b = bodyObj(ctx);
    if (b.title !== undefined) todo.title = String(b.title).trim();
    if (b.category !== undefined) todo.category = String(b.category);
    if (b.note !== undefined) todo.note = String(b.note);
    if (b.nodeAt !== undefined) todo.nodeAt = parseDateField(b.nodeAt);
    if (b.dueAt !== undefined) todo.dueAt = parseDateField(b.dueAt);
    if (b.remindAt !== undefined) todo.remindAt = parseDateField(b.remindAt);
    if (b.status !== undefined) {
      if (b.status !== 'open' && b.status !== 'done') return badRequest('status 无效');
      todo.status = b.status;
      if (b.status === 'open') {
        todo.completedAt = null;
        todo.completedBy = null;
      }
    }
    if (b.assigneeIds !== undefined) {
      if (!Array.isArray(b.assigneeIds)) return badRequest('assigneeIds 必须是数组');
      const assigneeIds = [...new Set(b.assigneeIds.map(String))];
      const members = db.memberships.filter((m) => m.projectId === todo.projectId);
      if (assigneeIds.some((id) => !members.some((m) => m.userId === id))) return badRequest('指派人必须是项目成员');
      todo.assigneeIds = assigneeIds;
    }
    return json({ todo: todoJson(db, todo) });
  }),

  def('DELETE', '/api/projects/:pid/todos/:tid', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const todo = findTodo(ctx);
    db.todos.splice(db.todos.indexOf(todo), 1);
    return json({ ok: true });
  }),

  def('POST', '/api/projects/:pid/todos/:tid/complete', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const todo = findTodo(ctx);
    if (todo.status === 'done') return err(409, 'already_done', '待办已完成');
    const fd = form(ctx);
    todo.status = 'done';
    todo.completedAt = nowIso();
    todo.completedBy = db.currentUserId;
    todo.completionNote = formStr(fd, 'completionNote');
    todo.attachments.push(...(await saveAttachments(db, fd)));
    return json({ todo: todoJson(db, todo) });
  }),

  def('POST', '/api/projects/:pid/todos/:tid/updates', async (ctx) => {
    const { db } = ctx;
    requireProject(ctx);
    const todo = findTodo(ctx);
    if (todo.status === 'done') return err(409, 'already_done', '待办已完成');
    const fd = form(ctx);
    const note = formStr(fd, 'note').trim();
    const files = formFiles(fd);
    if (!note && files.length === 0) return badRequest('进度内容不能为空');
    const attachments: string[] = [];
    for (const f of files) attachments.push(await storeUpload(db, f));
    todo.updates.push({ note, attachments, createdBy: db.currentUserId, createdAt: nowIso() });
    return json({ todo: todoJson(db, todo) }, 201);
  }),
];
