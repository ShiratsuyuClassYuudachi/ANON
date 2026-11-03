import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { authRequired } from '../middleware/auth';
import { loadMembership, requirePermission } from '../middleware/projectAccess';
import { ExternalMember } from '../models/ExternalMember';
import { Membership } from '../models/Membership';
import { externalMemberJson } from '../services/projectPeople';
import { logActivity } from '../services/activity';
import { ah } from '../utils/async';
import { AppError } from '../utils/errors';

export const externalMembersRouter = Router({ mergeParams: true });
externalMembersRouter.use(authRequired, loadMembership);

function parseProfile(body: Record<string, unknown>) {
  const out: { name?: string; duty?: string; contacts?: { platform: string; value: string }[] } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new AppError(400, 'bad_request', '姓名必填');
    out.name = body.name.trim();
  }
  if (body.duty !== undefined) {
    if (typeof body.duty !== 'string') throw new AppError(400, 'bad_request', '岗位须为文字');
    out.duty = body.duty.trim();
  }
  if (body.contacts !== undefined) {
    if (!Array.isArray(body.contacts)) throw new AppError(400, 'bad_request', '联系方式须为数组');
    out.contacts = body.contacts.map((c) => {
      if (!c || typeof c.platform !== 'string' || typeof c.value !== 'string' || !c.platform.trim() || !c.value.trim()) {
        throw new AppError(400, 'bad_request', '联系方式的平台和内容均需填写');
      }
      return { platform: c.platform.trim(), value: c.value.trim() };
    });
  }
  return out;
}

externalMembersRouter.get('/', ah(async (req, res) => {
  const filter: Record<string, unknown> = { projectId: req.project!._id };
  for (const key of ['includeArchived', 'includeLinked']) {
    if (req.query[key] !== undefined && !['true', 'false'].includes(String(req.query[key]))) throw new AppError(400, 'bad_request', `${key} 须为布尔值`);
  }
  if (req.query.includeArchived !== 'true') filter.archivedAt = null;
  if (req.query.includeLinked !== 'true') filter.linkedUserId = null;
  const members = await ExternalMember.find(filter).sort({ createdAt: 1 });
  res.json({ externalMembers: members.map(externalMemberJson) });
}));

externalMembersRouter.post('/', ...requirePermission('member:manage'), ah(async (req, res) => {
  const profile = parseProfile(req.body ?? {});
  if (!profile.name) throw new AppError(400, 'bad_request', '姓名必填');
  const member = await ExternalMember.create({ ...profile, projectId: req.project!._id, createdBy: req.userId });
  logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'member:external_create', message: `${req.user!.name}录入了未注册成员「${member.name}」`, sourceType: 'member', sourceId: member._id });
  res.status(201).json({ externalMember: externalMemberJson(member) });
}));

externalMembersRouter.patch('/:memberId', ...requirePermission('member:manage'), ah(async (req, res) => {
  if (!isValidObjectId(req.params.memberId)) throw new AppError(400, 'bad_request', '成员 ID 非法');
  const profile = parseProfile(req.body ?? {});
  if (req.body.archived !== undefined && typeof req.body.archived !== 'boolean') throw new AppError(400, 'bad_request', 'archived 须为布尔值');
  const fields: Record<string, unknown> = { ...profile };
  if (req.body.archived !== undefined) fields.archivedAt = req.body.archived ? new Date() : null;
  const member = await ExternalMember.findOneAndUpdate({ _id: req.params.memberId, projectId: req.project!._id }, { $set: fields }, { new: true, runValidators: true });
  if (!member) throw new AppError(404, 'not_found', '成员不存在');
  logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'member:external_update', message: `${req.user!.name}更新了成员档案「${member.name}」`, sourceType: 'member', sourceId: member._id });
  res.json({ externalMember: externalMemberJson(member) });
}));

externalMembersRouter.post('/:memberId/link', ...requirePermission('member:manage'), ah(async (req, res) => {
  const userId = req.body?.userId;
  if (!isValidObjectId(req.params.memberId) || typeof userId !== 'string' || !isValidObjectId(userId)) throw new AppError(400, 'bad_request', '成员或用户 ID 非法');
  if (!await Membership.exists({ projectId: req.project!._id, userId })) throw new AppError(400, 'bad_request', '只能关联本项目已入项的账号');
  // 单文档条件更新，避免并发关联到不同账号；无需跨集合事务。
  let member = await ExternalMember.findOneAndUpdate({ _id: req.params.memberId, projectId: req.project!._id, linkedUserId: null },
    { $set: { linkedUserId: userId, linkedAt: new Date(), linkedBy: req.userId } }, { new: true });
  if (!member) {
    member = await ExternalMember.findOne({ _id: req.params.memberId, projectId: req.project!._id });
    if (!member) throw new AppError(404, 'not_found', '成员不存在');
    if (String(member.linkedUserId) !== userId) throw new AppError(409, 'member_already_linked', '成员已关联其他账号');
  } else {
    logActivity({ projectId: req.project!._id, actorId: req.userId!, type: 'member:external_link', message: `${req.user!.name}关联了成员档案「${member.name}」`, sourceType: 'member', sourceId: member._id });
  }
  res.json({ externalMember: externalMemberJson(member) });
}));
