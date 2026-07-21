import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IInviteCode {
  code: string;
  createdBy: Types.ObjectId;
  usedBy?: Types.ObjectId;
  usedAt?: Date;
}

export type InviteCodeDoc = HydratedDocument<IInviteCode>;

const schema = new Schema<IInviteCode>(
  {
    code: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    usedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    usedAt: Date,
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const InviteCode: Model<IInviteCode> =
  models.InviteCode ?? model<IInviteCode>('InviteCode', schema);
