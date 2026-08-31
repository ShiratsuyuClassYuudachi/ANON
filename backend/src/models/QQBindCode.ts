import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

/** QQ 绑定一次性验证码：用户在 Me 页 / 项目设置页生成，QQ 侧发「绑定 XXXXXX」消费 */
export interface IQQBindCode {
  /** 6 位数字，唯一索引 */
  code: string;
  kind: 'user' | 'project';
  /** kind=user 时的目标用户 */
  userId?: Types.ObjectId;
  /** kind=project 时的目标项目 */
  projectId?: Types.ObjectId;
  /** TTL 索引：到期自动清理 */
  expiresAt: Date;
}

export type QQBindCodeDoc = HydratedDocument<IQQBindCode>;

const schema = new Schema<IQQBindCode>(
  {
    code: { type: String, required: true },
    kind: { type: String, enum: ['user', 'project'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index({ code: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const QQBindCode: Model<IQQBindCode> =
  models.QQBindCode ?? model<IQQBindCode>('QQBindCode', schema);
