import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

/** Rundown 现场大屏对外公开分享：每 Rundown 一份，token 即免登录大屏链接标识 */
export interface IStageScreenShare {
  projectId: Types.ObjectId;
  rundownId: Types.ObjectId;
  token: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type StageScreenShareDoc = HydratedDocument<IStageScreenShare>;

const schema = new Schema<IStageScreenShare>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    rundownId: { type: Schema.Types.ObjectId, ref: 'StageRundown', required: true, unique: true },
    token: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const StageScreenShare: Model<IStageScreenShare> =
  models.StageScreenShare ?? model<IStageScreenShare>('StageScreenShare', schema);
