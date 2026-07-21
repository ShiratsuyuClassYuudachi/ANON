import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IVisibility {
  userIds: Types.ObjectId[];
  roleNames: string[];
}

export interface IResourceType {
  projectId: Types.ObjectId;
  name: string;
  visibility: IVisibility;
}

export type ResourceTypeDoc = HydratedDocument<IResourceType>;

export const visibilitySchema = new Schema<IVisibility>(
  {
    userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    roleNames: [{ type: String }],
  },
  { _id: false },
);

const schema = new Schema<IResourceType>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    visibility: { type: visibilitySchema, default: () => ({ userIds: [], roleNames: [] }) },
  },
  { timestamps: true },
);
schema.index({ projectId: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const ResourceType: Model<IResourceType> =
  models.ResourceType ?? model<IResourceType>('ResourceType', schema);
