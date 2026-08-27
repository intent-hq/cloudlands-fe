/**
 * Transient message-level hydration policy for long chat transcripts.
 *
 * The input order is the composed chronological order. A displayport frontier
 * is the oldest currently adjacent row; once known, hydrated rows newer than
 * it are retained even after they leave the preload band. Only older,
 * non-user, non-forced rows may dehydrate. DOM observation and geometry stay
 * with the component; this module only reports deterministic transitions.
 */

import { observeLazyTurnVisibility } from './lazy-turn-observer';

export interface HydrationMessage {
  id: string;
  role?: string | null;
  isUser?: boolean;
}

interface MessageHydrationPolicyOptions {
  onHydrate?: (id: string) => void;
  onDehydrate?: (id: string) => void;
}

export interface MessageHydrationPolicy {
  observe(id: string, element: Element, root: HTMLElement | null): () => void;
  setForced(id: string, forced: boolean): void;
  updateMessages(messages: readonly HydrationMessage[]): void;
  getHydratedIds(): string[];
  dispose(): void;
}

interface MessageRecord extends HydrationMessage {
  index: number;
  isUser: boolean;
  forced: boolean;
  isIntersecting: boolean;
  hydrated: boolean;
}

function isUserHydrationMessage(message: HydrationMessage): boolean {
  return message.role === 'user' || message.isUser === true;
}

function shouldStartAsMessagePlaceholder(message: HydrationMessage, forced = false): boolean {
  return !isUserHydrationMessage(message) && !forced;
}

function sortByIndex(records: Iterable<MessageRecord>): MessageRecord[] {
  return [...records].sort((a, b) => a.index - b.index);
}

export function createMessageHydrationPolicy(
  messages: readonly HydrationMessage[],
  options: MessageHydrationPolicyOptions = {},
): MessageHydrationPolicy {
  const records = new Map<string, MessageRecord>();
  const registrations = new Map<string, () => void>();
  let frontierId: string | undefined;
  let disposed = false;

  function makeRecord(message: HydrationMessage, index: number): MessageRecord {
    const forced = false;
    const isUser = isUserHydrationMessage(message);
    return {
      ...message,
      index,
      isUser,
      forced,
      isIntersecting: false,
      hydrated: !shouldStartAsMessagePlaceholder(message, forced),
    };
  }

  messages.forEach((message, index) => records.set(message.id, makeRecord(message, index)));

  function frontierIndex(): number | undefined {
    return frontierId === undefined ? undefined : records.get(frontierId)?.index;
  }

  function recomputeFrontier() {
    const adjacent = sortByIndex([...records.values()].filter((record) => record.isIntersecting));
    if (adjacent.length > 0) frontierId = adjacent[0].id;
    else if (frontierId !== undefined && !records.has(frontierId)) frontierId = undefined;
  }

  function canDehydrate(record: MessageRecord): boolean {
    const boundary = frontierIndex();
    return (
      !record.isUser &&
      !record.forced &&
      !record.isIntersecting &&
      boundary !== undefined &&
      record.index < boundary
    );
  }

  function reconcile(): void {
    const boundary = frontierIndex();
    for (const record of sortByIndex(records.values())) {
      const isAtOrNewerThanFrontier = boundary !== undefined && record.index >= boundary;
      const shouldHydrate =
        record.isUser || record.forced || record.isIntersecting || isAtOrNewerThanFrontier;
      if (shouldHydrate && !record.hydrated) {
        record.hydrated = true;
        options.onHydrate?.(record.id);
      } else if (!shouldHydrate && record.hydrated && canDehydrate(record)) {
        record.hydrated = false;
        options.onDehydrate?.(record.id);
      }
    }
  }

  function reportVisibility(id: string, isIntersecting: boolean): void {
    if (disposed) return;
    const record = records.get(id);
    if (!record) return;
    record.isIntersecting = isIntersecting;
    recomputeFrontier();
    reconcile();
  }

  return {
    observe(id, element, root) {
      // Child rows may mount before the parent effect publishes the composed
      // message list. Keep that stable registration; visibility reports are
      // safely ignored until updateMessages() installs the matching record.
      if (disposed) return () => {};
      registrations.get(id)?.();
      const release = observeLazyTurnVisibility(element, root, (isIntersecting) => {
        reportVisibility(id, isIntersecting);
      });
      registrations.set(id, release);
      return () => {
        if (registrations.get(id) !== release) return;
        registrations.delete(id);
        release();
      };
    },
    setForced(id, forced) {
      if (disposed) return;
      const record = records.get(id);
      if (!record || record.forced === forced) return;
      record.forced = forced;
      reconcile();
    },
    updateMessages(nextMessages) {
      if (disposed) return;
      const previous = new Map(records);
      const nextIds = new Set(nextMessages.map((message) => message.id));
      for (const [id, release] of registrations) {
        if (!nextIds.has(id)) {
          release();
          registrations.delete(id);
        }
      }
      records.clear();
      nextMessages.forEach((message, index) => {
        const existing = previous.get(message.id);
        if (existing) {
          records.set(message.id, {
            ...existing,
            ...message,
            index,
            isUser: isUserHydrationMessage(message),
          });
        } else {
          records.set(message.id, makeRecord(message, index));
        }
      });
      recomputeFrontier();
      reconcile();
    },
    getHydratedIds() {
      return sortByIndex(records.values())
        .filter((record) => record.hydrated)
        .map((record) => record.id);
    },
    dispose() {
      disposed = true;
      for (const release of registrations.values()) release();
      registrations.clear();
      records.clear();
      frontierId = undefined;
    },
  };
}
