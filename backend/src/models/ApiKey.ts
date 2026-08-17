import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IApiKey {
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  /** 工具兑换的 key 有值；用户自助生成的 key 无值 */
  toolId?: Types.ObjectId;
  name: string;
  keyHash: string;
  scopes: string[];
  /** 缺省/null = 永久有效 */
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ApiKeyDoc = HydratedDocument<IApiKey>;

const schema = new Schema<IApiKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    toolId: { type: Schema.Types.ObjectId, ref: 'CustomTool' },
    name: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    expiresAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true },
);
schema.index({ expiresAt: 1 });
schema.index({ userId: 1, toolId: 1 });

export const ApiKey: Model<IApiKey> = models.ApiKey ?? model<IApiKey>('ApiKey', schema);
