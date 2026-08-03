import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface ITodoUpdate {
  note: string;
  attachments: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
}

export interface ITodo {
  projectId: Types.ObjectId;
  title: string;
  category: string;
  assigneeIds: Types.ObjectId[];
  nodeAt?: Date;
  dueAt?: Date;
  remindAt?: Date;
  status: 'open' | 'done';
  note: string;
  createdBy: Types.ObjectId;
  completedAt?: Date;
  completedBy?: Types.ObjectId;
  completionNote?: string;
  attachments: Types.ObjectId[];
  updates: ITodoUpdate[];
}

export type TodoDoc = HydratedDocument<ITodo>;

const schema = new Schema<ITodo>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    category: { type: String, default: '' },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    nodeAt: Date,
    dueAt: Date,
    remindAt: Date,
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    note: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: Date,
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completionNote: String,
    attachments: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    updates: {
      type: [{
        _id: false,
        note: { type: String, default: '' },
        attachments: [{ type: Schema.Types.ObjectId, ref: 'File' }],
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, status: 1 });

// vitest 在同一 fork 中跨测试文件复用外部化的 mongoose 实例，模型需幂等注册
export const Todo: Model<ITodo> = models.Todo ?? model<ITodo>('Todo', schema);
