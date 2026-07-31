import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import type { ProjectDoc } from '../models/Project';
import { WorkModule, type WorkModuleDoc } from '../models/WorkModule';
import { AppError } from '../utils/errors';

/** userId → 成员姓名（Membership populate User.name 联查） */
export async function memberNameMap(projectId: Types.ObjectId): Promise<Map<string, string>> {
  const ms = await Membership.find({ projectId }).populate<{ userId: { _id: Types.ObjectId; name: string } }>(
    'userId',
    'name',
  );
  return new Map(ms.map((m) => [String(m.userId._id), m.userId.name]));
}

export function moduleJson(m: WorkModuleDoc, names: Map<string, string>) {
  return {
    id: String(m._id),
    name: m.name,
    description: m.description ?? '',
    location: m.location ?? '',
    startAt: m.startAt ? m.startAt.toISOString() : null,
    endAt: m.endAt ? m.endAt.toISOString() : null,
    requiredCount: m.requiredCount,
    assignees: m.assignees.map((a) => ({
      userId: String(a.userId),
      name: names.get(String(a.userId)) ?? '',
      confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
      confirmedBy: a.confirmedBy ? String(a.confirmedBy) : null,
      checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    })),
    createdBy: String(m.createdBy),
    // HydratedDocument 类型不含 timestamps 字段，沿用 routes/todos.ts 的 cast 手法
    createdAt: (m as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

/** 实时计算某成员的任务单：分配给 ta 的模块（Mongo 升序：无 startAt 的排最前，其次 createdAt） */
export async function buildSheet(project: ProjectDoc, targetUserId: string) {
  const ms = await Membership.find({ projectId: project._id }).populate<{
    userId: { _id: Types.ObjectId; name: string };
  }>('userId', 'name');
  const target = ms.find((m) => String(m.userId._id) === targetUserId);
  if (!target) throw new AppError(404, 'not_found', '该用户不是项目成员');
  const names = new Map(ms.map((m) => [String(m.userId._id), m.userId.name]));
  const modules = await WorkModule.find({ projectId: project._id, 'assignees.userId': targetUserId }).sort({
    startAt: 1,
    createdAt: 1,
  });
  return {
    project: { id: String(project._id), name: project.name },
    user: { id: targetUserId, name: target.userId.name },
    generatedAt: new Date().toISOString(),
    items: modules.map((m) => moduleJson(m, names)),
  };
}
