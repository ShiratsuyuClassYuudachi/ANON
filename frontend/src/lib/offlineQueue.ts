import { api } from '@/api/client';

export interface QueuedRequest {
  id: string;
  url: string;
  body?: unknown;
  queuedAt: number;
}

const STORAGE_KEY = 'anon-offline-queue';

function load(): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedRequest[]) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedRequest[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // 存储满等异常：静默忽略，避免影响主流程
  }
}

export function enqueueOffline(url: string, body?: unknown): void {
  const queue = load();
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  queue.push({ id, url, body, queuedAt: Date.now() });
  save(queue);
}

export function pendingCount(): number {
  return load().length;
}

export function isOfflineError(e: unknown): boolean {
  return !navigator.onLine || e instanceof TypeError;
}

let flushing = false;

export async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  try {
    const queue = load();
    if (queue.length === 0) return 0;
    const remaining: QueuedRequest[] = [];
    let succeeded = 0;
    for (let i = 0; i < queue.length; i++) {
      const req = queue[i];
      try {
        await api(req.url, { method: 'POST', body: req.body });
        succeeded++;
      } catch (e) {
        // 失败保留待重试；若已断网，后续请求一并保留，不再逐个打
        remaining.push(req);
        if (isOfflineError(e)) {
          remaining.push(...queue.slice(i + 1));
          break;
        }
      }
    }
    save(remaining);
    return succeeded;
  } finally {
    flushing = false;
  }
}
