import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IExternalMember {
  projectId: Types.ObjectId;
  name: string;
  duty: string;
  contacts: { platform: string; value: string }[];
  archivedAt: Date | null;
  linkedUserId: Types.ObjectId | null;
  linkedAt: Date | null;
  linkedBy: Types.ObjectId | null;
  createdBy: Types.ObjectId;
}

const schema = new Schema<IExternalMember>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true, trim: true },
  duty: { type: String, default: '' },
  contacts: { type: [{ platform: String, value: String, _id: false }], default: [] },
  archivedAt: { type: Date, default: null },
  linkedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  linkedAt: { type: Date, default: null },
  linkedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
schema.index({ projectId: 1 });

export const ExternalMember: Model<IExternalMember> = models.ExternalMember ?? model<IExternalMember>('ExternalMember', schema);
