import type { StatusEvent } from './chat-state-types';

type StatusLevel = StatusEvent['level'];

const DEFAULT_STATUS_EVENT: StatusEvent = {
  phase: 'status',
  message: 'Status update',
  level: 'info',
  timestamp: 0,
};

function readField(value: unknown, field: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }

  try {
    return (value as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

function isErrorLike(value: unknown): boolean {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false;
  }

  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

function toSafeString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'symbol') return String(value);
  if (isErrorLike(value)) {
    const message = readField(value, 'message');
    const name = readField(value, 'name');
    return toSafeString(message, toSafeString(name, fallback));
  }
  return fallback;
}

function toSafeStatusLevel(value: unknown, fallback: StatusLevel): StatusLevel {
  return value === 'info' || value === 'warn' || value === 'error' ? value : fallback;
}

function toSafeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return fallback;
}

export function sanitizeStatusEvent(
  statusEvent: unknown,
  fallbackTimestamp = DEFAULT_STATUS_EVENT.timestamp,
): StatusEvent {
  const fallbackLevel: StatusLevel = isErrorLike(statusEvent) ? 'error' : DEFAULT_STATUS_EVENT.level;

  return {
    phase: toSafeString(readField(statusEvent, 'phase'), DEFAULT_STATUS_EVENT.phase),
    message: toSafeString(readField(statusEvent, 'message'), DEFAULT_STATUS_EVENT.message),
    level: toSafeStatusLevel(readField(statusEvent, 'level'), fallbackLevel),
    timestamp: toSafeTimestamp(readField(statusEvent, 'timestamp'), fallbackTimestamp),
  };
}

export function sanitizeStatusEvents(statusEvents: unknown): StatusEvent[] {
  if (!Array.isArray(statusEvents)) {
    return [];
  }

  return statusEvents.map((statusEvent) => sanitizeStatusEvent(statusEvent));
}