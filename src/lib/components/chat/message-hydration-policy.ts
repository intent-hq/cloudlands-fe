/**
 * Transient message-level hydration policy for long chat transcripts.
 *
 * The input order is the composed chronological order. A displayport frontier
 * is the oldest currently adjacent row; once known, hydrated rows newer than
 * it are retained even after they leave the preload band. Only older,
 * non-user, non-forced rows may dehydrate. DOM observation and geometry stay
 * with the component; this module only reports deterministic transitions.
 */

import { LAZY_TURN_PRELOAD_ROOT_MARGIN, observeLazyTurnVisibility } from './lazy-turn-observer';

export interface HydrationMessage {
  id: string;
  role?: string | null;
  isUser?: boolean;
}

export interface VisibilityReport {
  id: string;
  isIntersecting: boolean;
}

export interface HydrationTransition {
  id: string;
  hydrated: boolean;
  reason: 'displayport' | 'frontier' | 'dehydrate' | 'force';
}

export interface MessageHydrationState {
  id: string;
  index: number;
  isUser: boolean;
  forced: boolean;
  isIntersecting: boolean;
  hydrated: boolean;
  canDehydrate: boolean;
}

export interface MessageHydrationPolicyOptions {
  forcedMessageIds?: Iterable<string>;
  forceHydrate?: (message: HydrationMessage, index: number) => boolean;
  onHydrate?: (id: string) => void;
  onDehydrate?: (id: string) => void;
}

export interface MessageHydrationPolicy {
  observe(id: string, element: Element, root: HTMLElement | null): () => void;
  reportVisibility(id: string, isIntersecting: boolean): HydrationTransition[];
  reportObserverEntries(entries: Iterable<VisibilityReport>): HydrationTransition[];
  setForced(id: string, forced: boolean): HydrationTransition[];
  updateMessages(messages: readonly HydrationMessage[]): HydrationTransition[];
  removeMessage(id: string): HydrationTransition[];
  getFrontier(): string | undefined;
  getState(id: string): MessageHydrationState | undefined;
  getStates(): MessageHydrationState[];
  getHydratedIds(): string[];
  isHydrated(id: string): boolean;
  dispose(): void;
}

interface MessageRecord extends HydrationMessage {
  index: number;
  isUser: boolean;
  forced: boolean;
  isIntersecting: boolean;
  hydrated: boolean;
}

export const DEFAULT_MESSAGE_HYDRATION_ROOT_MARGIN = LAZY_TURN_PRELOAD_ROOT_MARGIN;

export function isUserHydrationMessage(message: HydrationMessage): boolean {
  return message.role === 'user' || message.isUser === true;
}

export function shouldStartAsMessagePlaceholder(
  message: HydrationMessage,
  forced = false,
): boolean {
  return !isUserHydrationMessage(message) && !forced;
}

export function deriveMessageHydrationFrontier(
  messages: readonly HydrationMessage[],
  adjacentMessageIds: Iterable<string>,
): string | undefined {
  const adjacent = new Set(adjacentMessageIds);
  let frontier: HydrationMessage | undefined;
  let frontierIndex = Number.POSITIVE_INFINITY;
  messages.forEach((message, index) => {
    if (adjacent.has(message.id) && index < frontierIndex) {
      frontier = message;
      frontierIndex = index;
    }
  });
  return frontier?.id;
}

function sortByIndex(records: Iterable<MessageRecord>): MessageRecord[] {
  return [...records].sort((a, b) => a.index - b.index);
}

export function createMessageHydrationPolicy(
  messages: readonly HydrationMessage[],
  options: MessageHydrationPolicyOptions = {},
): MessageHydrationPolicy {
  const forcedIds = new Set(options.forcedMessageIds ?? []);
  const records = new Map<string, MessageRecord>();
  const registrations = new Map<string, () => void>();
  let frontierId: string | undefined;
  let disposed = false;

  function makeRecord(message: HydrationMessage, index: number): MessageRecord {
    const forced = forcedIds.has(message.id) || Boolean(options.forceHydrate?.(message, index));
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

  function reconcile(reason: HydrationTransition['reason']): HydrationTransition[] {
    const transitions: HydrationTransition[] = [];
    for (const record of sortByIndex(records.values())) {
      const shouldHydrate = record.isUser || record.forced || record.isIntersecting;
      if (shouldHydrate && !record.hydrated) {
        record.hydrated = true;
        transitions.push({ id: record.id, hydrated: true, reason });
        options.onHydrate?.(record.id);
      } else if (!shouldHydrate && record.hydrated && canDehydrate(record)) {
        record.hydrated = false;
        transitions.push({ id: record.id, hydrated: false, reason: 'dehydrate' });
        options.onDehydrate?.(record.id);
      }
    }
    return transitions;
  }

  function reportObserverEntries(entries: Iterable<VisibilityReport>): HydrationTransition[] {
    if (disposed) return [];
    const reports = new Map<string, boolean>();
    for (const entry of entries) {
      if (!records.has(entry.id)) continue;
      // An entry is retained when a batch contains both sides of a boundary;
      // this makes delivery independent of browser entry ordering.
      reports.set(entry.id, Boolean(entry.isIntersecting) || reports.get(entry.id) === true);
    }
    for (const record of sortByIndex(records.values())) {
      const next = reports.get(record.id);
      if (next !== undefined) record.isIntersecting = next;
    }
    recomputeFrontier();
    return reconcile('displayport');
  }

  function reportVisibility(id: string, isIntersecting: boolean): HydrationTransition[] {
    return reportObserverEntries([{ id, isIntersecting }]);
  }

  return {
    observe(id, element, root) {
      if (disposed || !records.has(id)) return () => {};
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
    reportVisibility(id, isIntersecting) {
      return reportVisibility(id, isIntersecting);
    },
    reportObserverEntries,
    setForced(id, forced) {
      if (disposed) return [];
      const record = records.get(id);
      if (!record || record.forced === forced) return [];
      record.forced = forced;
      return reconcile('force');
    },
    updateMessages(nextMessages) {
      if (disposed) return [];
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
      return reconcile('frontier');
    },
    removeMessage(id) {
      if (disposed || !records.delete(id)) return [];
      registrations.get(id)?.();
      registrations.delete(id);
      recomputeFrontier();
      return reconcile('frontier');
    },
    getFrontier() {
      return frontierId;
    },
    getState(id) {
      const record = records.get(id);
      if (!record) return undefined;
      return {
        id: record.id,
        index: record.index,
        isUser: record.isUser,
        forced: record.forced,
        isIntersecting: record.isIntersecting,
        hydrated: record.hydrated,
        canDehydrate: canDehydrate(record),
      };
    },
    getStates() {
      return sortByIndex(records.values()).map((record) => ({
        id: record.id,
        index: record.index,
        isUser: record.isUser,
        forced: record.forced,
        isIntersecting: record.isIntersecting,
        hydrated: record.hydrated,
        canDehydrate: canDehydrate(record),
      }));
    },
    getHydratedIds() {
      return sortByIndex(records.values())
        .filter((record) => record.hydrated)
        .map((record) => record.id);
    },
    isHydrated(id) {
      return records.get(id)?.hydrated ?? false;
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

export const createMessageHydrationController = createMessageHydrationPolicy;
