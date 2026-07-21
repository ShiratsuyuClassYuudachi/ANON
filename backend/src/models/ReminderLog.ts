import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IReminderLog {
  todoId: Types.ObjectId;
  kind: 'remind' | 'due';
  sentAt: Date;
}

export type ReminderLogDoc = HydratedDocument<IReminderLog>;

const schema = new Schema<IReminderLog>({
  todoId: { type: Schema.Types.ObjectId, ref: 'Todo', required: true },
  kind: { type: String, enum: ['remind', 'due'], required: true },
  sentAt: { type: Date, default: () => new Date() },
});
schema.index({ todoId: 1, kind: 1 }, { unique: true });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const ReminderLog: Model<IReminderLog> = models.ReminderLog ?? model<IReminderLog>('ReminderLog', schema);
