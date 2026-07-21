import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IProjectInvite {
  projectId: Types.ObjectId;
  token: string;
  targetUserId?: Types.ObjectId;
  roleName: string;
  expiresAt: Date;
  acceptedBy?: Types.ObjectId;
  acceptedAt?: Date;
}

export type ProjectInviteDoc = HydratedDocument<IProjectInvite>;

const schema = new Schema<IProjectInvite>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    token: { type: String, required: true, unique: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    roleName: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: Date,
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const ProjectInvite: Model<IProjectInvite> =
  models.ProjectInvite ?? model<IProjectInvite>('ProjectInvite', schema);
