import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';
import { visibilitySchema, type IVisibility } from './ResourceType';

export interface IResource {
  projectId: Types.ObjectId;
  typeId: Types.ObjectId;
  name: string;
  description: string;
  visibility: IVisibility;
}

export type ResourceDoc = HydratedDocument<IResource>;

const schema = new Schema<IResource>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    typeId: { type: Schema.Types.ObjectId, ref: 'ResourceType', required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    visibility: { type: visibilitySchema, default: () => ({ userIds: [], roleNames: [] }) },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, typeId: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Resource: Model<IResource> =
  models.Resource ?? model<IResource>('Resource', schema);
