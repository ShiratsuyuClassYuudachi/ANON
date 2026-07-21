import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IResourceVersion {
  resourceId: Types.ObjectId;
  version: number;
  fileId: Types.ObjectId;
  previewPath: string | null;
  note: string;
  createdBy: Types.ObjectId;
}

export type ResourceVersionDoc = HydratedDocument<IResourceVersion>;

const schema = new Schema<IResourceVersion>(
  {
    resourceId: { type: Schema.Types.ObjectId, ref: 'Resource', required: true },
    version: { type: Number, required: true },
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    previewPath: { type: String, default: null },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ resourceId: 1, version: -1 }, { unique: true });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const ResourceVersion: Model<IResourceVersion> =
  models.ResourceVersion ?? model<IResourceVersion>('ResourceVersion', schema);
