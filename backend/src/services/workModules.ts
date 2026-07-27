import { Types } from 'mongoose';
import { Membership } from '../models/Membership';
import type { WorkModuleDoc } from '../models/WorkModule';

/** userId → 成员姓名（Membership 联查 User.name；populate 写法照 routes/todos.ts 中 assignees 姓名的联查方式，先读该文件对齐） */
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
    })),
    createdBy: String(m.createdBy),
    // HydratedDocument 类型不含 timestamps 字段，沿用 routes/todos.ts 的 cast 手法
    createdAt: (m as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}
