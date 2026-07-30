import { type Types } from 'mongoose';
import { Activity } from '../models/Activity';

export interface LogActivityOpts {
  projectId: Types.ObjectId | string;
  actorId: Types.ObjectId | string;
  type: string;
  message: string;
  sourceType: string;
  sourceId?: Types.ObjectId | string;
  metadata?: Record<string, unknown>;
  permissionGate?: string;
}

export function logActivity(opts: LogActivityOpts): void {
  Activity.create({
    projectId: opts.projectId,
    actorId: opts.actorId,
    type: opts.type,
    message: opts.message,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    metadata: opts.metadata,
    permissionGate: opts.permissionGate,
  }).catch(() => {});
}
