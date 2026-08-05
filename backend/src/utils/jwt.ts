import jwt from 'jsonwebtoken';
import { config } from '../config';

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '15m' });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
