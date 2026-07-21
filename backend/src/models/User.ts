import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IUser {
  email: string;
  name: string;
  passwordHash: string;
  isSuperAdmin: boolean;
  contacts: { platform: string; value: string }[];
  inviteCodeId?: Types.ObjectId;
}

export type UserDoc = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    isSuperAdmin: { type: Boolean, default: false },
    contacts: [{ platform: String, value: String, _id: false }],
    inviteCodeId: { type: Schema.Types.ObjectId, ref: 'InviteCode' },
  },
  { timestamps: true },
);

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const User: Model<IUser> = models.User ?? model<IUser>('User', userSchema);

export function publicUser(u: UserDoc) {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    isSuperAdmin: u.isSuperAdmin,
    contacts: u.contacts,
  };
}
