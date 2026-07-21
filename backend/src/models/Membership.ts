import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IMembership {
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  roleName: string;
}

export type MembershipDoc = HydratedDocument<IMembership>;

const schema = new Schema<IMembership>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    roleName: { type: String, required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, userId: 1 }, { unique: true });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Membership: Model<IMembership> =
  models.Membership ?? model<IMembership>('Membership', schema);
