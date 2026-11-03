import { Types } from 'mongoose';
import type { ProjectDoc } from '../models/Project';
import { WorkModule, type WorkModuleDoc } from '../models/WorkModule';
import { AppError } from '../utils/errors';
import { loadProjectPeople, ProjectPeople } from './projectPeople';

/** userId → 成员姓名，同时载入档案与关联信息供任务身份解析。 */
export const memberNameMap = loadProjectPeople;

export function moduleJson(m: WorkModuleDoc, names: Map<string, string>) {
  const people = names instanceof ProjectPeople ? names : new ProjectPeople(names);
  const all = people.workAssignments(m);
  const stateJson = (a: { confirmedAt?: Date; confirmedBy?: Types.ObjectId; checkedInAt?: Date; completedAt?: Date }) => ({
    confirmedAt: a.confirmedAt?.toISOString() ?? null, confirmedBy: a.confirmedBy ? String(a.confirmedBy) : null,
    checkedInAt: a.checkedInAt?.toISOString() ?? null, completedAt: a.completedAt?.toISOString() ?? null,
  });
  return {
    id: String(m._id), name: m.name, description: m.description ?? '', location: m.location ?? '',
    startAt: m.startAt?.toISOString() ?? null, endAt: m.endAt?.toISOString() ?? null, requiredCount: m.requiredCount,
    assignees: all.registered.map((a) => ({ userId: String(a.userId), name: names.get(String(a.userId)) ?? '', ...stateJson(a) })),
    externalAssignees: all.external.map((a) => ({ externalMemberId: String(a.externalMemberId), name: people.externals.get(String(a.externalMemberId))?.name ?? '未知', archivedAt: people.externals.get(String(a.externalMemberId))?.archivedAt?.toISOString() ?? null, ...stateJson(a) })),
    createdBy: String(m.createdBy), createdAt: (m as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

/** 已关联档案的任务随账号显示；旧档案任务单仍可用于历史查看。 */
export async function buildSheet(project: ProjectDoc, targetId: string, external = false) {
  const people = await loadProjectPeople(project._id);
  const profile = external ? people.externals.get(targetId) : undefined;
  if (external ? !profile : !people.has(targetId)) throw new AppError(404, 'not_found', '该成员不在项目中');
  const linked = external ? people.links.get(targetId) : undefined;
  const filter = external && !linked
    ? { 'externalAssignees.externalMemberId': targetId }
    : people.workFilter(linked ?? targetId);
  const modules = await WorkModule.find({ projectId: project._id, ...filter }).sort({ startAt: 1, createdAt: 1 });
  return {
    project: { id: String(project._id), name: project.name },
    user: { id: linked ?? targetId, name: people.get(linked ?? targetId) ?? profile!.name, ...(external && !linked ? { externalMemberId: targetId } : {}) },
    generatedAt: new Date().toISOString(), items: modules.map((m) => moduleJson(m, people)),
  };
}
