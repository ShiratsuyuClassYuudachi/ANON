import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IMilestone {
  projectId: Types.ObjectId;
  title: string;
  date: Date;
  description: string;
  stageId?: Types.ObjectId;
  completedAt?: Date;
  createdBy: Types.ObjectId;
}

export type MilestoneDoc = HydratedDocument<IMilestone>;

const schema = new Schema<IMilestone>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    description: { type: String, default: '' },
    stageId: Schema.Types.ObjectId,
    completedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, date: 1 });

export const Milestone: Model<IMilestone> =
  models.Milestone ?? model<IMilestone>('Milestone', schema);
