import { Types } from 'mongoose';
import { StageSignup } from '../models/StageSignup';
import type { IStageParticipant } from '../models/StageRundown';
import { AppError } from '../utils/errors';

export interface SignupItemInput {
  name: string;
  durationMin: number;
  participants: IStageParticipant[];
  note: string;
}

export function assertSignupDuration(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 1440) {
    throw new AppError(400, 'bad_request', '时长必须为 1–1440 分钟的整数');
  }
  return n;
}

/** 网页与机器人共用校验；只追加条目，避免覆盖同时录入的其他节目。 */
export async function addSignupItem(projectId: Types.ObjectId, signupId: string, input: SignupItemInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'bad_request', '节目名称不能为空');
  const item = {
    _id: new Types.ObjectId(),
    name,
    durationMin: assertSignupDuration(input.durationMin),
    participants: input.participants.map((p) => ({ cn: p.cn.trim(), contact: p.contact.trim() })).filter((p) => p.cn),
    note: input.note.trim(),
    status: 'pending' as const,
    reviews: [],
  };
  const doc = await StageSignup.findOneAndUpdate(
    { _id: signupId, projectId },
    { $push: { items: item } },
    { new: true, runValidators: true },
  );
  if (!doc) throw new AppError(404, 'not_found', '报名批次不存在');
  return doc;
}
