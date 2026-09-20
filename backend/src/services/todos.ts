import { type Types } from 'mongoose';
import { Membership } from '../models/Membership';
import { Todo, type TodoDoc } from '../models/Todo';
import { AppError } from '../utils/errors';
import { logActivity } from './activity';
import { notify } from './notifications';

/** 待办创建共用逻辑：HTTP 路由（routes/todos.ts）与 QQ 群 AI 录单（services/qqTodo.ts）共用 */

export async function assertAssigneesAreMembers(projectId: unknown, assigneeIds: string[]) {
  const count = await Membership.countDocuments({
    projectId,
    userId: { $in: assigneeIds },
  });
  if (count !== new Set(assigneeIds).size) {
    throw new AppError(400, 'bad_request', '指派人必须是项目成员');
  }
}

export function todoAssignBody(todo: TodoDoc): string {
  const parts = [`待办「${todo.title}」`];
  if (todo.dueAt) parts.push(`截止 ${todo.dueAt.toISOString()}`);
  if (todo.nodeAt) parts.push(`节点 ${todo.nodeAt.toISOString()}`);
  return parts.join('，');
}

export function todoLink(projectId: unknown): string {
  return `/p/${String(projectId)}?tab=todos`;
}

export async function createTodo(input: {
  projectId: Types.ObjectId | string;
  /** 已 trim 的非空串 */
  title: string;
  category?: string;
  assigneeIds?: string[];
  nodeAt?: Date;
  dueAt?: Date;
  remindAt?: Date;
  note?: string;
  createdBy: Types.ObjectId | string;
  /** logActivity 消息用 */
  actorName: string;
  /** QQ 群@录单来源群 group_openid；节点/到期提醒只发该群 */
  qqSourceGroupOpenId?: string;
}): Promise<TodoDoc> {
  const assignees = input.assigneeIds ?? [];
  await assertAssigneesAreMembers(input.projectId, assignees);
  const todo = await Todo.create({
    projectId: input.projectId,
    title: input.title,
    category: input.category ?? '',
    assigneeIds: assignees,
    nodeAt: input.nodeAt,
    dueAt: input.dueAt,
    remindAt: input.remindAt,
    note: input.note ?? '',
    createdBy: input.createdBy,
    qqSourceGroupOpenId: input.qqSourceGroupOpenId,
  });
  logActivity({
    projectId: input.projectId,
    actorId: input.createdBy,
    type: 'todo:create',
    message: `${input.actorName}创建了待办「${todo.title}」`,
    sourceType: 'todo',
    sourceId: todo._id,
  });
  if (assignees.length) {
    notify({
      projectId: input.projectId,
      type: 'todo:assigned',
      title: `你被指派了待办：${todo.title}`,
      body: todoAssignBody(todo),
      link: todoLink(input.projectId),
      metadata: { todoId: todo._id.toString() },
      recipients: assignees,
      actorId: input.createdBy.toString(),
    });
  }
  return todo;
}
