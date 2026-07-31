import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IDashboardPreference {
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  defaultView: 'personal' | 'project';
  collapsedCards: string[];
  hiddenCards: string[];
  scheduleRange: 7 | 30;
  cardOrder: string[];
}

export type DashboardPreferenceDoc = HydratedDocument<IDashboardPreference>;

const schema = new Schema<IDashboardPreference>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    defaultView: { type: String, enum: ['personal', 'project'], default: 'personal' },
    collapsedCards: { type: [String], default: [] },
    hiddenCards: { type: [String], default: [] },
    scheduleRange: { type: Number, enum: [7, 30], default: 7 },
    cardOrder: { type: [String], default: [] },
  },
  { timestamps: true },
);
schema.index({ userId: 1, projectId: 1 }, { unique: true });

export const DashboardPreference: Model<IDashboardPreference> =
  models.DashboardPreference ?? model<IDashboardPreference>('DashboardPreference', schema);
