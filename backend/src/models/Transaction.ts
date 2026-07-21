import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface ITransaction {
  projectId: Types.ObjectId;
  type: 'income' | 'expense';
  amountCents: number;
  note: string;
  createdBy: Types.ObjectId;
  payerUserId: Types.ObjectId;
  splitAmong: Types.ObjectId[];
  attachments: Types.ObjectId[];
}

export type TransactionDoc = HydratedDocument<ITransaction>;

const schema = new Schema<ITransaction>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amountCents: { type: Number, required: true, min: 1 },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    payerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    splitAmong: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    attachments: [{ type: Schema.Types.ObjectId, ref: 'File' }],
  },
  { timestamps: true },
);
schema.index({ projectId: 1, createdAt: -1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Transaction: Model<ITransaction> =
  models.Transaction ?? model<ITransaction>('Transaction', schema);
