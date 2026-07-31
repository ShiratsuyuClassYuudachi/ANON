import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IAnnouncementConfirmation {
  announcementId: Types.ObjectId;
  projectId: Types.ObjectId;
  userId: Types.ObjectId;
  confirmedAt: Date;
}

export type AnnouncementConfirmationDoc = HydratedDocument<IAnnouncementConfirmation>;

const schema = new Schema<IAnnouncementConfirmation>(
  {
    announcementId: { type: Schema.Types.ObjectId, ref: 'Announcement', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ announcementId: 1, userId: 1 }, { unique: true });
schema.index({ projectId: 1, userId: 1 });

export const AnnouncementConfirmation: Model<IAnnouncementConfirmation> =
  models.AnnouncementConfirmation ?? model<IAnnouncementConfirmation>('AnnouncementConfirmation', schema);
