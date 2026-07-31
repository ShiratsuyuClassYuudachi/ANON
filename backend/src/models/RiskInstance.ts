import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IRiskInstance {
  projectId: Types.ObjectId;
  ruleCode: string;
  level: 'info' | 'warning' | 'critical';
  sourceType: 'todo' | 'finance' | 'material' | 'work';
  sourceId?: Types.ObjectId;
  fingerprint: string;
  title: string;
  description: string;
  status: 'active' | 'resolved' | 'ignored' | 'expired';
  firstDetectedAt: Date;
  lastDetectedAt: Date;
  resolvedAt?: Date;
  ignoredBy?: Types.ObjectId;
  ignoredAt?: Date;
  ignoredUntil?: Date;
  ignoreReason?: string;
}

export type RiskInstanceDoc = HydratedDocument<IRiskInstance>;

const schema = new Schema<IRiskInstance>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    ruleCode: { type: String, required: true },
    level: { type: String, enum: ['info', 'warning', 'critical'], required: true },
    sourceType: { type: String, enum: ['todo', 'finance', 'material', 'work'], required: true },
    sourceId: { type: Schema.Types.ObjectId },
    fingerprint: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: ['active', 'resolved', 'ignored', 'expired'], default: 'active' },
    firstDetectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    ignoredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    ignoredAt: Date,
    ignoredUntil: Date,
    ignoreReason: String,
  },
  { timestamps: true },
);

schema.index({ projectId: 1, fingerprint: 1 }, { unique: true });
schema.index({ projectId: 1, status: 1, level: 1, lastDetectedAt: -1 });

export const RiskInstance: Model<IRiskInstance> =
  models.RiskInstance ?? model<IRiskInstance>('RiskInstance', schema);
