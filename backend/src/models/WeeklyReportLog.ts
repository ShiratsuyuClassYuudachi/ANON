import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IWeeklyReportLog {
  projectId: Types.ObjectId;
  weekStart: Date;
  sentAt: Date;
}

export type WeeklyReportLogDoc = HydratedDocument<IWeeklyReportLog>;

const schema = new Schema<IWeeklyReportLog>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    weekStart: { type: Date, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, weekStart: 1 }, { unique: true });

export const WeeklyReportLog: Model<IWeeklyReportLog> =
  models.WeeklyReportLog ?? model<IWeeklyReportLog>('WeeklyReportLog', schema);
