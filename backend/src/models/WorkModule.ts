import { HydratedDocument, Model, Schema, Types, model, models } from 'mongoose';

export interface IWorkAssignee {
  userId: Types.ObjectId;
  confirmedAt?: Date;
  confirmedBy?: Types.ObjectId;
}

export interface IWorkModule {
  projectId: Types.ObjectId;
  name: string;
  description?: string;
  location?: string;
  startAt?: Date;
  endAt?: Date;
  requiredCount: number;
  assignees: IWorkAssignee[];
  createdBy: Types.ObjectId;
}

export type WorkModuleDoc = HydratedDocument<IWorkModule>;

const assigneeSchema = new Schema<IWorkAssignee>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
);

const schema = new Schema<IWorkModule>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String },
    location: { type: String },
    startAt: { type: Date },
    endAt: { type: Date },
    requiredCount: { type: Number, default: 1, min: 1 },
    assignees: { type: [assigneeSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1 });

export const WorkModule: Model<IWorkModule> = models.WorkModule ?? model<IWorkModule>('WorkModule', schema);
