import { Schema, model, models, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface ICustomTool {
  projectId: Types.ObjectId;
  name: string;
  url: string;
  description: string;
  mode: 'embed' | 'link';
  passToken: boolean;
  scopes: string[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type CustomToolDoc = HydratedDocument<ICustomTool>;

const schema = new Schema<ICustomTool>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    description: { type: String, default: '' },
    mode: { type: String, enum: ['embed', 'link'], default: 'embed' },
    passToken: { type: Boolean, default: false },
    scopes: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
schema.index({ projectId: 1, createdAt: 1 });

export const CustomTool: Model<ICustomTool> =
  models.CustomTool ?? model<ICustomTool>('CustomTool', schema);
