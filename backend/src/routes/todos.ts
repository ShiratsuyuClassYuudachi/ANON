import { Router } from 'express';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { fixFilename, upload } from '../middleware/upload';
import { File } from '../models/File';
import { Membership } from '../models/Membership';
import { Todo, type TodoDoc } from '../models/Todo';
import { User } from '../models/User';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const todosRouter = Router({ mergeParams: true });
todosRouter.use(authRequired, loadMembership);

const SORTS: Record<string, string> = { dueAt: 'dueAt', nodeAt: 'nodeAt', createdAt: 'createdAt' };

async function todoJson(t: TodoDoc) {
  const users = await User.find({ _id: { $in: t.assigneeIds } }).lean();
  const files = await File.find({ _id: { $in: t.attachments } }).lean();
  return {
    id: t._id.toString(),
    title: t.title,
    category: t.category,
    assignees: users.map((u) => ({ userId: u._id.toString(), name: u.name })),
    nodeAt: t.nodeAt ?? null,
    dueAt: t.dueAt ?? null,
    remindAt: t.remindAt ?? null,
    status: t.status,
    note: t.note,
    createdBy: t.createdBy.toString(),
    createdAt: (t as unknown as { createdAt: Date }).createdAt,
    completedAt: t.completedAt ?? null,
    completedBy: t.completedBy?.toString() ?? null,
    completionNote: t.completionNote ?? null,
    attachments: files.map((f) => ({ id: f._id.toString(), filename: f.filename })),
  };
}

async function assertAssigneesAreMembers(projectId: unknown, assigneeIds: string[]) {
  const count = await Membership.countDocuments({
    projectId,
    userId: { $in: assigneeIds },
  });
  if (count !== new Set(assigneeIds).size) {
    throw new AppError(400, 'bad_request', '指派人必须是项目成员');
  }
}

function parseDate(v: unknown): Date | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'bad_request', '时间格式无效');
  return d;
}

todosRouter.get(
  '/',
  ah(async (req, res) => {
    const { category, assignee, status, sort, order } = req.query;
    const filter: Record<string, unknown> = { projectId: req.project!._id };
    if (category) filter.category = String(category);
    if (assignee) filter.assigneeIds = String(assignee);
    if (status === 'open' || status === 'done') filter.status = status;
    const sortField = SORTS[String(sort)] ?? 'createdAt';
    const dir = order === 'asc' ? 1 : -1;
    const todos = await Todo.find(filter).sort({ [sortField]: dir, _id: dir });
    res.json({ todos: await Promise.all(todos.map(todoJson)) });
  }),
);

todosRouter.post(
  '/',
  ah(async (req, res) => {
    const { title, category, assigneeIds, nodeAt, dueAt, remindAt, note } = req.body ?? {};
    if (!title || !String(title).trim()) throw new AppError(400, 'bad_request', '标题必填');
    const assignees: string[] = Array.isArray(assigneeIds) ? assigneeIds.map(String) : [];
    await assertAssigneesAreMembers(req.project!._id, assignees);
    const todo = await Todo.create({
      projectId: req.project!._id,
      title: String(title).trim(),
      category: String(category ?? ''),
      assigneeIds: assignees,
      nodeAt: parseDate(nodeAt),
      dueAt: parseDate(dueAt),
      remindAt: parseDate(remindAt),
      note: String(note ?? ''),
      createdBy: req.userId,
    });
    res.status(201).json({ todo: await todoJson(todo) });
  }),
);

todosRouter.patch(
  '/:todoId',
  ...requirePermission('todo:manage'),
  ah(async (req, res) => {
    const todo = await Todo.findOne({ _id: req.params.todoId, projectId: req.project!._id });
    if (!todo) throw new AppError(404, 'not_found', '待办不存在');
    const { title, category, assigneeIds, nodeAt, dueAt, remindAt, note, status } = req.body ?? {};
    if (title !== undefined) todo.title = String(title).trim();
    if (category !== undefined) todo.category = String(category);
    if (note !== undefined) todo.note = String(note);
    if (nodeAt !== undefined) todo.nodeAt = parseDate(nodeAt);
    if (dueAt !== undefined) todo.dueAt = parseDate(dueAt);
    if (remindAt !== undefined) todo.remindAt = parseDate(remindAt);
    if (status !== undefined) {
      if (status !== 'open' && status !== 'done') throw new AppError(400, 'bad_request', 'status 无效');
      todo.status = status;
      if (status === 'open') {
        todo.completedAt = undefined;
        todo.completedBy = undefined;
      }
    }
    if (assigneeIds !== undefined) {
      const assignees: string[] = Array.isArray(assigneeIds) ? assigneeIds.map(String) : [];
      await assertAssigneesAreMembers(req.project!._id, assignees);
      todo.assigneeIds = assignees as never;
    }
    await todo.save();
    res.json({ todo: await todoJson(todo) });
  }),
);

todosRouter.delete(
  '/:todoId',
  ...requirePermission('todo:manage'),
  ah(async (req, res) => {
    const r = await Todo.deleteOne({ _id: req.params.todoId, projectId: req.project!._id });
    if (!r.deletedCount) throw new AppError(404, 'not_found', '待办不存在');
    res.json({ ok: true });
  }),
);

todosRouter.post(
  '/:todoId/complete',
  upload.array('files', 10),
  ah(async (req, res) => {
    const todo = await Todo.findOne({ _id: req.params.todoId, projectId: req.project!._id });
    if (!todo) throw new AppError(404, 'not_found', '待办不存在');
    const perms = req.myPermissions!;
    const isAssignee = todo.assigneeIds.some((id) => id.toString() === req.userId);
    const allowed =
      perms.has('project:manage') || perms.has('todo:manage') || (isAssignee && perms.has('todo:complete'));
    if (!allowed) throw new AppError(403, 'forbidden', '没有权限完成该待办');
    if (todo.status === 'done') throw new AppError(409, 'already_done', '待办已完成');

    const uploaded = (req.files as Express.Multer.File[]) ?? [];
    const fileDocs = await File.insertMany(
      uploaded.map((f) => ({
        projectId: req.project!._id,
        filename: fixFilename(f.originalname),
        path: f.path,
        mime: f.mimetype,
        size: f.size,
        uploadedBy: req.userId,
      })),
    );

    todo.status = 'done';
    todo.completedAt = new Date();
    todo.completedBy = req.userId as never;
    todo.completionNote = String(req.body?.completionNote ?? '');
    todo.attachments.push(...fileDocs.map((f) => f._id));
    await todo.save();
    res.json({ todo: await todoJson(todo) });
  }),
);
