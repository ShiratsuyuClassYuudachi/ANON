import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IRole {
  name: string;
  permissions: string[];
}

export interface IProject {
  name: string;
  description: string;
  startDate?: Date;
  endDate?: Date;
  createdBy: Types.ObjectId;
  roles: IRole[];
}

export type ProjectDoc = HydratedDocument<IProject>;

const schema = new Schema<IProject>(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    startDate: Date,
    endDate: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roles: [{ name: String, permissions: [String], _id: false }],
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Project: Model<IProject> = models.Project ?? model<IProject>('Project', schema);
