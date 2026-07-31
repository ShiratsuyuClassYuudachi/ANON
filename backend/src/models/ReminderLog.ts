import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IReminderLog {
  todoId: Types.ObjectId;
  kind: 'remind' | 'due' | 'milestone_approaching';
  sentAt: Date;
  targetType?: 'todo' | 'milestone';
  targetId?: Types.ObjectId;
}

export type ReminderLogDoc = HydratedDocument<IReminderLog>;

const schema = new Schema<IReminderLog>({
  todoId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['remind', 'due', 'milestone_approaching'], required: true },
  sentAt: { type: Date, default: () => new Date() },
  targetType: { type: String, enum: ['todo', 'milestone'], default: 'todo' },
  targetId: Schema.Types.ObjectId,
});
schema.index({ todoId: 1, kind: 1 }, { unique: true });
schema.index({ targetType: 1, targetId: 1, kind: 1 }, { unique: true, sparse: true });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const ReminderLog: Model<IReminderLog> = models.ReminderLog ?? model<IReminderLog>('ReminderLog', schema);
