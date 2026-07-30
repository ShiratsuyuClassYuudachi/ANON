import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';
import { visibilitySchema, type IVisibility } from './ResourceType';

export interface IAnnouncement {
  projectId: Types.ObjectId;
  title: string;
  content: string;
  type: 'normal' | 'important' | 'emergency';
  isPinned: boolean;
  requireConfirmation: boolean;
  visibility: IVisibility;
  attachmentIds: Types.ObjectId[];
  publishedBy: Types.ObjectId;
  publishedAt: Date;
  expiresAt?: Date;
}

export type AnnouncementDoc = HydratedDocument<IAnnouncement>;

const schema = new Schema<IAnnouncement>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    title: { type: String, required: true },
    content: { type: String, default: '' },
    type: { type: String, enum: ['normal', 'important', 'emergency'], default: 'normal' },
    isPinned: { type: Boolean, default: false },
    requireConfirmation: { type: Boolean, default: false },
    visibility: { type: visibilitySchema, default: () => ({ userIds: [], roleNames: [] }) },
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: 'File' }],
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publishedAt: { type: Date, default: Date.now },
    expiresAt: Date,
  },
  { timestamps: true },
);
schema.index({ projectId: 1, isPinned: -1, publishedAt: -1 });

export const Announcement: Model<IAnnouncement> =
  models.Announcement ?? model<IAnnouncement>('Announcement', schema);
