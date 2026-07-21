import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IVisibility {
  userIds: Types.ObjectId[];
  roleNames: string[];
}

export interface IPlatformAccount {
  projectId: Types.ObjectId;
  platform: string;
  account: string;
  mode: 'full' | 'otp' | 'contact';
  passwordCipher?: string;
  cipherKeySource?: 'user' | 'server';
  note: string;
  addedBy: Types.ObjectId;
  visibility: IVisibility;
}

export type PlatformAccountDoc = HydratedDocument<IPlatformAccount>;

const visibilitySchema = new Schema<IVisibility>(
  {
    userIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    roleNames: [{ type: String }],
  },
  { _id: false },
);

const schema = new Schema<IPlatformAccount>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    platform: { type: String, required: true },
    account: { type: String, required: true },
    mode: { type: String, enum: ['full', 'otp', 'contact'], required: true },
    passwordCipher: { type: String },
    cipherKeySource: { type: String, enum: ['user', 'server'] },
    note: { type: String, default: '' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    visibility: { type: visibilitySchema, default: () => ({ userIds: [], roleNames: [] }) },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, platform: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const PlatformAccount: Model<IPlatformAccount> =
  models.PlatformAccount ?? model<IPlatformAccount>('PlatformAccount', schema);
