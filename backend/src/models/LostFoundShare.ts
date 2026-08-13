import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

/** 失物招领对外公开分享：每项目一份，token 即免登录公开页链接标识 */
export interface ILostFoundShare {
  projectId: Types.ObjectId;
  token: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type LostFoundShareDoc = HydratedDocument<ILostFoundShare>;

const schema = new Schema<ILostFoundShare>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    token: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const LostFoundShare: Model<ILostFoundShare> =
  models.LostFoundShare ?? model<ILostFoundShare>('LostFoundShare', schema);
