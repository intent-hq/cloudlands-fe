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
  setActive(active: boolean): void;
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
  interface Registration {
    element: Element;
    root: HTMLElement | null;
    release: (() => void) | null;
    /** Last visibility report seen before a matching record existed. */
    pendingReport: boolean | null;
  }
  const registrations = new Map<string, Registration>();
  let frontierId: string | undefined;
  let disposed = false;
  let active = true;

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
    if (!record) {
      // Rows can report before updateMessages() installs their record, and
      // IntersectionObserver only re-fires on boundary crossings — retain the
      // report so updateMessages() can replay it instead of dropping it.
      const registration = registrations.get(id);
      if (registration) registration.pendingReport = isIntersecting;
      return;
    }
    record.isIntersecting = isIntersecting;
    recomputeFrontier();
    reconcile();
  }

  function attachRegistration(id: string, registration: Registration) {
    if (!active || disposed || registration.release) return;
    registration.release = observeLazyTurnVisibility(
      registration.element,
      registration.root,
      (isIntersecting) => reportVisibility(id, isIntersecting),
    );
  }

  return {
    observe(id, element, root) {
      // Child rows may mount before the parent effect publishes the composed
      // message list. Keep that stable registration; visibility reports are
      // retained until updateMessages() installs the matching record.
      if (disposed) return () => {};
      registrations.get(id)?.release?.();
      const registration: Registration = { element, root, release: null, pendingReport: null };
      registrations.set(id, registration);
      attachRegistration(id, registration);
      return () => {
        if (registrations.get(id) !== registration) return;
        registrations.delete(id);
        registration.release?.();
      };
    },
    setActive(nextActive) {
      if (disposed || active === nextActive) return;
      active = nextActive;
      if (active) {
        for (const [id, registration] of registrations) attachRegistration(id, registration);
      } else {
        for (const registration of registrations.values()) {
          registration.release?.();
          registration.release = null;
          // A retained pre-record report is stale once observation stops; the
          // re-attached observer reports fresh visibility on activation.
          registration.pendingReport = null;
        }
      }
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
      for (const [id, registration] of registrations) {
        if (!nextIds.has(id)) {
          registration.release?.();
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
      for (const [id, registration] of registrations) {
        if (registration.pendingReport === null) continue;
        const record = records.get(id);
        if (!record) continue;
        record.isIntersecting = registration.pendingReport;
        registration.pendingReport = null;
      }
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
      for (const registration of registrations.values()) registration.release?.();
      registrations.clear();
      records.clear();
      frontierId = undefined;
    },
  };
}
