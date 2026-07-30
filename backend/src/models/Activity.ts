import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IActivity {
  projectId: Types.ObjectId;
  actorId: Types.ObjectId;
  type: string;
  message: string;
  sourceType: string;
  sourceId?: Types.ObjectId;
  metadata?: Record<string, unknown>;
  permissionGate?: string;
}

export type ActivityDoc = HydratedDocument<IActivity>;

const schema = new Schema<IActivity>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    sourceType: { type: String, required: true },
    sourceId: Schema.Types.ObjectId,
    metadata: Schema.Types.Mixed,
    permissionGate: String,
  },
  { timestamps: true },
);
schema.index({ projectId: 1, createdAt: -1 });
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });

export const Activity: Model<IActivity> =
  models.Activity ?? model<IActivity>('Activity', schema);
