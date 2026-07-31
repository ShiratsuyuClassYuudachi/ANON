import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IPushSubscription {
  userId: Types.ObjectId;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export type PushSubscriptionDoc = HydratedDocument<IPushSubscription>;

const schema = new Schema<IPushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true },
    p256dh: { type: String, required: true },
    auth: { type: String, required: true },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);

// 同一用户同一端点只保留一条（浏览器重新订阅时 upsert 更新密钥）
schema.index({ userId: 1, endpoint: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const PushSubscription: Model<IPushSubscription> =
  models.PushSubscription ?? model<IPushSubscription>('PushSubscription', schema);
