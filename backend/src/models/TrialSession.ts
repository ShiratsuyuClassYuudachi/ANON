import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface ITrialSession {
  /** sha256(`trial:${jwtSecret}:${password}`) hex，唯一索引 */
  keyHash: string;
  /** 试用管理员 */
  userId: Types.ObjectId;
  /** 管理员 + 4 成员，供级联删除 */
  userIds: Types.ObjectId[];
  projectId: Types.ObjectId;
  /** 创建时间 + 24h，到期由 services/trial.ts 清扫器级联销毁 */
  expiresAt: Date;
}

export type TrialSessionDoc = HydratedDocument<ITrialSession>;

const schema = new Schema<ITrialSession>(
  {
    keyHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userIds: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index({ keyHash: 1 }, { unique: true });
schema.index({ expiresAt: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const TrialSession: Model<ITrialSession> =
  models.TrialSession ?? model<ITrialSession>('TrialSession', schema);
