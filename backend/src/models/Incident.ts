import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export const INCIDENT_CATEGORIES = ['equipment', 'staff', 'material', 'venue', 'safety', 'other'] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export interface IIncident {
  projectId: Types.ObjectId;
  moduleId?: Types.ObjectId;
  category: IncidentCategory;
  note: string;
  reporterId: Types.ObjectId;
  status: 'open' | 'resolved';
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
}

export type IncidentDoc = HydratedDocument<IIncident>;

const schema = new Schema<IIncident>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'WorkModule' },
    category: { type: String, enum: INCIDENT_CATEGORIES, required: true },
    note: { type: String, required: true, trim: true, maxlength: 500 },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, status: 1, createdAt: -1 });

export const Incident: Model<IIncident> = models.Incident ?? model<IIncident>('Incident', schema);
