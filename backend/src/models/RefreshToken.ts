import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IRefreshToken {
  /** 用户 */
  userId: Types.ObjectId;
  /** sha256(refreshToken) hex，唯一索引；库中不存明文 */
  tokenHash: string;
  /** 30 天滚动有效；过期由 services/session.ts 手动清扫（FerretDB TTL 兼容性未验证） */
  expiresAt: Date;
}

export type RefreshTokenDoc = HydratedDocument<IRefreshToken>;

const schema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ userId: 1 });
schema.index({ expiresAt: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const RefreshToken: Model<IRefreshToken> =
  models.RefreshToken ?? model<IRefreshToken>('RefreshToken', schema);
