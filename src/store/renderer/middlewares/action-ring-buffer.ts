import type { StoreMiddleware } from '@augmentcode/themis/types';

/**
 * Action-type ring buffer.
 *
 * Keeps the `type` of the last N dispatched actions so a diagnostic (the
 * long-task watchdog) can attach "what the store was doing just before" to a
 * report. Types only — payloads are never retained, so the buffer cannot leak
 * message bodies or grow with them.
 */

/** How many action types the renderer buffer retains. */
export const ACTION_RING_BUFFER_CAPACITY = 20;

export interface ActionTypeRingBuffer {
  push(type: string): void;
  /** Oldest first. */
  snapshot(): string[];
  clear(): void;
}

export function createActionTypeRingBuffer(capacity: number): ActionTypeRingBuffer {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(`Action ring buffer capacity must be a positive integer, got ${capacity}`);
  }
  const slots: string[] = new Array<string>(capacity);
  let writeIndex = 0;
  let size = 0;

  return {
    push(type) {
      slots[writeIndex] = type;
      writeIndex = (writeIndex + 1) % capacity;
      if (size < capacity) size += 1;
    },
    snapshot() {
      const out: string[] = [];
      const start = size < capacity ? 0 : writeIndex;
      for (let i = 0; i < size; i++) {
        out.push(slots[(start + i) % capacity]);
      }
      return out;
    },
    clear() {
      writeIndex = 0;
      size = 0;
    },
  };
}

/** The renderer store's shared buffer, read by the long-task watchdog. */
export const rendererActionTypeRingBuffer = createActionTypeRingBuffer(ACTION_RING_BUFFER_CAPACITY);

/**
 * Records each dispatched action's `type` into `buffer` before passing it on.
 * Actions without a string `type` (thunks, malformed objects) are skipped.
 */
export function createActionRingBufferMiddleware(
  buffer: ActionTypeRingBuffer = rendererActionTypeRingBuffer,
): StoreMiddleware {
  return (_store) => (next) => (action) => {
    const type = (action as { type?: unknown } | null | undefined)?.type;
    if (typeof type === 'string') buffer.push(type);
    return next(action);
  };
}
