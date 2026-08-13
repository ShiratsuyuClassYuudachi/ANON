import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface ILostFoundItem {
  projectId: Types.ObjectId;
  name: string;
  note: string;
  /** 照片 File 文档；photoPreviewPath 为 generatePreview 的存储引用（非 File） */
  photoId: Types.ObjectId | null;
  photoPreviewPath: string | null;
  foundAt: Date;
  foundLocation: string;
  status: 'pending' | 'claimed';
  claimedAt: Date | null;
  /** 认领备注/联系方式，仅项目内可见，公开接口不下发 */
  claimNote: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type LostFoundItemDoc = HydratedDocument<ILostFoundItem>;

const schema = new Schema<ILostFoundItem>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    note: { type: String, default: '' },
    photoId: { type: Schema.Types.ObjectId, ref: 'File', default: null },
    photoPreviewPath: { type: String, default: null },
    foundAt: { type: Date, default: Date.now },
    foundLocation: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'claimed'], default: 'pending' },
    claimedAt: { type: Date, default: null },
    claimNote: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, foundAt: -1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const LostFoundItem: Model<ILostFoundItem> =
  models.LostFoundItem ?? model<ILostFoundItem>('LostFoundItem', schema);
