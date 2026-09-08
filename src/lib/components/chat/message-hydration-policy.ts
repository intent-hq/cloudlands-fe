/**
 * Transient message-level hydration policy for long chat transcripts.
 *
 * The input order is the composed chronological order. Rows hydrate only when
 * forced, intersecting the preload band, or eagerly appended at the tail — a
 * displayport frontier (the oldest currently adjacent row) is purely a
 * retention barrier: once known, hydrated rows newer than it are retained
 * even after they leave the preload band, but rows never seen are never
 * hydrated by it. Only older, non-user, non-forced rows may dehydrate. Every
 * row — user rows included — starts as a placeholder so a workspace switch
 * mounts only the displayport; user rows differ solely in that once hydrated
 * they never dehydrate (their DOM anchors pinned-prompt tracking and prompt
 * navigation). DOM observation and geometry stay with the component; this
 * module only reports deterministic transitions.
 */

import { observeLazyTurnVisibility, scheduleLazyTurnDeliveryFlush } from './lazy-turn-observer';

export interface HydrationMessage {
  id: string;
  role?: string | null;
  isUser?: boolean;
}

interface MessageHydrationPolicyOptions {
  onHydrate?: (id: string) => void;
  onDehydrate?: (id: string) => void;
  /**
   * Fired once at the end of any policy call (updateMessages,
   * reportVisibility via the observer, setForced) that changed at least one
   * row's hydration. Consumers rebuilding derived state (e.g. a hydrated-id
   * Set) should use this instead of the per-row callbacks so a mass
   * transition costs one rebuild, not one per row.
   */
  onHydrationChange?: () => void;
  frameBudgetMs?: number;
  maxRowsPerFrame?: number;
  scheduleFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

export const CHAT_HYDRATION_FRAME_BUDGET_MS = 6;
export const CHAT_HYDRATION_MAX_ROWS_PER_FRAME = 4;

export interface MessageHydrationPolicy {
  /**
   * Registers a mounted row element for visibility observation. The returned
   * cleanup is the ONLY way a registration is released before dispose() —
   * updateMessages() never releases registrations (ids transiently absent
   * from the list stay observed) — so callers MUST invoke it on unmount, and
   * boundedness relies on every observed id being a row rendered from the
   * same composed message list.
   */
  observe(id: string, element: Element, root: HTMLElement | null): () => void;
  setActive(active: boolean): void;
  setScope(scope: string): void;
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
  isVisible: boolean;
  hydrated: boolean;
}

function isUserHydrationMessage(message: HydrationMessage): boolean {
  return message.role === 'user' || message.isUser === true;
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
    pendingReport: { isIntersecting: boolean; isVisible: boolean } | null;
  }
  const registrations = new Map<string, Registration>();
  let frontierId: string | undefined;
  let disposed = false;
  let active = true;
  let scope: string | undefined;
  let generation = 0;
  const pendingHydrations = new Set<string>();
  let scheduledFrame: number | null = null;
  const staged = options.frameBudgetMs !== undefined;
  const frameBudgetMs = options.frameBudgetMs ?? CHAT_HYDRATION_FRAME_BUDGET_MS;
  const maxRowsPerFrame = options.maxRowsPerFrame ?? CHAT_HYDRATION_MAX_ROWS_PER_FRAME;
  const now = options.now ?? (() => performance.now());
  const scheduleFrame =
    options.scheduleFrame ?? ((callback: FrameRequestCallback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));

  /**
   * At most this many appended rows hydrate eagerly per update. A single send
   * or streaming turn appends only a handful of rows, so the "sends never
   * flash" property is unaffected; a large batch append (an inactive panel
   * reactivating after heavy background chatter delivers the whole backlog as
   * one append) must not mount synchronously — rows beyond the tail window
   * stay placeholders for the observer/frontier to hydrate on demand.
   */
  const MAX_EAGER_APPEND_ROWS = 8;

  function makeRecord(message: HydrationMessage, index: number): MessageRecord {
    return {
      ...message,
      index,
      isUser: isUserHydrationMessage(message),
      forced: false,
      isIntersecting: false,
      isVisible: false,
      hydrated: false,
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

  /** True while the current policy call has transitioned at least one row. */
  let batchChanged = false;

  function hydrateRecord(record: MessageRecord): void {
    record.hydrated = true;
    batchChanged = true;
    options.onHydrate?.(record.id);
  }

  function dehydrateRecord(record: MessageRecord): void {
    record.hydrated = false;
    batchChanged = true;
    options.onDehydrate?.(record.id);
  }

  function cancelScheduledHydration(): void {
    generation += 1;
    pendingHydrations.clear();
    if (scheduledFrame === null) return;
    if (scheduledFrame >= 0) cancelFrame(scheduledFrame);
    scheduledFrame = null;
  }

  function prunePendingHydrations(liveIds: ReadonlySet<string>): void {
    for (const id of pendingHydrations) {
      if (!liveIds.has(id)) pendingHydrations.delete(id);
    }
    if (pendingHydrations.size === 0 && scheduledFrame !== null) cancelScheduledHydration();
  }

  function hydrationPriority(record: MessageRecord): number {
    if (record.forced) return 0;
    return record.isVisible ? 1 : 2;
  }

  function hasPendingPromotedHydration(): boolean {
    return [...pendingHydrations].some((id) => {
      const record = records.get(id);
      return record?.forced === true || record?.isVisible === true;
    });
  }

  function dehydrateEligibleRows(): void {
    if (staged && hasPendingPromotedHydration()) return;
    for (const record of sortByIndex(records.values())) {
      if (record.hydrated && canDehydrate(record)) dehydrateRecord(record);
    }
  }

  function schedulePendingHydration(): void {
    if (!staged || disposed || !active || scheduledFrame !== null || pendingHydrations.size === 0)
      return;
    const scheduledGeneration = generation;
    scheduledFrame = -1;
    const handle = scheduleFrame(() => {
      scheduledFrame = null;
      if (disposed || !active || generation !== scheduledGeneration) return;
      const startedAt = now();
      let hydratedCount = 0;
      const candidates = sortByIndex(records.values())
        .filter((record) => pendingHydrations.has(record.id))
        .sort((a, b) => hydrationPriority(a) - hydrationPriority(b) || a.index - b.index);
      for (const record of candidates) {
        if (
          hydratedCount >= maxRowsPerFrame ||
          (hydratedCount > 0 && now() - startedAt >= frameBudgetMs)
        )
          break;
        pendingHydrations.delete(record.id);
        if (!record.hydrated && (record.forced || record.isIntersecting)) {
          hydrateRecord(record);
          hydratedCount += 1;
        }
      }
      dehydrateEligibleRows();
      flushBatch();
      schedulePendingHydration();
    });
    if (scheduledFrame !== null) scheduledFrame = handle;
  }

  /** Coalesces a call's transitions into one onHydrationChange notification. */
  function flushBatch(): void {
    if (disposed || !batchChanged) return;
    batchChanged = false;
    options.onHydrationChange?.();
  }

  function reconcile(): void {
    for (const record of sortByIndex(records.values())) {
      // The frontier never hydrates: rows hydrate only when forced,
      // intersecting the preload band, or eagerly appended (updateMessages).
      // It only blocks dehydration — canDehydrate() rejects rows at or newer
      // than it — so hydrated rows newer than the frontier are retained.
      const shouldHydrate = record.forced || record.isIntersecting;
      if (shouldHydrate && !record.hydrated) {
        if (!staged || record.forced) hydrateRecord(record);
        else pendingHydrations.add(record.id);
      } else if (!shouldHydrate) {
        pendingHydrations.delete(record.id);
      }
    }
    dehydrateEligibleRows();
    schedulePendingHydration();
  }

  function finishVisibilityDelivery(): void {
    recomputeFrontier();
    reconcile();
    flushBatch();
  }

  function reportVisibility(id: string, isIntersecting: boolean, isVisible: boolean): void {
    if (disposed) return;
    const record = records.get(id);
    if (!record) {
      // Rows can report before updateMessages() installs their record, and
      // IntersectionObserver only re-fires on boundary crossings — retain the
      // report so updateMessages() can replay it instead of dropping it.
      const registration = registrations.get(id);
      if (registration) registration.pendingReport = { isIntersecting, isVisible };
      return;
    }
    record.isIntersecting = isIntersecting;
    record.isVisible = isVisible;
    // One observer delivery invokes this once per entry. Reconcile only after
    // all reports land so an initial k-row delivery performs one transcript
    // pass, and entering rows are queued before older rows may dehydrate.
    if (!scheduleLazyTurnDeliveryFlush(finishVisibilityDelivery)) finishVisibilityDelivery();
  }

  function attachRegistration(id: string, registration: Registration) {
    if (!active || disposed || registration.release) return;
    registration.release = observeLazyTurnVisibility(
      registration.element,
      registration.root,
      (isIntersecting, isVisible) => reportVisibility(id, isIntersecting, isVisible),
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
        cancelScheduledHydration();
        for (const registration of registrations.values()) {
          registration.release?.();
          registration.release = null;
          // A retained pre-record report is stale once observation stops; the
          // re-attached observer reports fresh visibility on activation.
          registration.pendingReport = null;
        }
      }
    },
    setScope(nextScope) {
      if (disposed || scope === nextScope) return;
      if (scope === undefined) {
        scope = nextScope;
        return;
      }
      scope = nextScope;
      const hadHydratedRows = [...records.values()].some((record) => record.hydrated);
      cancelScheduledHydration();
      records.clear();
      frontierId = undefined;
      for (const registration of registrations.values()) {
        registration.release?.();
        registration.release = null;
        registration.pendingReport = null;
      }
      if (active) {
        for (const [id, registration] of registrations) attachRegistration(id, registration);
      }
      if (hadHydratedRows) {
        batchChanged = true;
        flushBatch();
      }
    },
    setForced(id, forced) {
      if (disposed) return;
      const record = records.get(id);
      if (!record || record.forced === forced) return;
      record.forced = forced;
      reconcile();
      flushBatch();
    },
    updateMessages(nextMessages) {
      if (disposed) return;
      const previous = new Map(records);
      const nextIds = new Set(nextMessages.map((message) => message.id));
      prunePendingHydrations(nextIds);
      // Appended rows (newer than every previously known row) hydrate eagerly:
      // a just-sent user message or a fresh streaming row must not paint as a
      // placeholder while waiting for an intersection report. Interior
      // insertions and older-history prepends stay placeholders. Eagerness
      // requires a surviving previous row (lastKnownIndex >= 0): both an
      // initial install AND a full transcript replacement (a rebound panel
      // publishing a disjoint id set on workspace/agent switch) start fully
      // dehydrated so only what the observer reports visible mounts. Eagerness
      // is also capped to the trailing MAX_EAGER_APPEND_ROWS of the list so a
      // reactivation backlog (every row a background agent appended while the
      // panel was inactive, delivered as one large append) cannot mount
      // synchronously either.
      let lastKnownIndex = -1;
      nextMessages.forEach((message, index) => {
        if (previous.has(message.id)) lastKnownIndex = index;
      });
      const eagerTailStart = nextMessages.length - MAX_EAGER_APPEND_ROWS;
      for (const [id, registration] of registrations) {
        if (nextIds.has(id)) continue;
        // The component owns the registration lifecycle (observe()'s cleanup
        // runs on unmount). A mounted row whose message transiently leaves
        // the composed list must keep its observation — IntersectionObserver
        // only re-fires on boundary crossings, so a released registration
        // goes permanently silent and the republished row stays a blank
        // placeholder. Retain the dropped record's last visibility so the
        // replay below restores it when the message returns.
        const dropped = previous.get(id);
        if (dropped) {
          registration.pendingReport = {
            isIntersecting: dropped.isIntersecting,
            isVisible: dropped.isVisible,
          };
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
          const record = makeRecord(message, index);
          records.set(message.id, record);
          if (lastKnownIndex >= 0 && index > lastKnownIndex && index >= eagerTailStart) {
            hydrateRecord(record);
          }
        }
      });
      for (const [id, registration] of registrations) {
        if (registration.pendingReport === null) continue;
        const record = records.get(id);
        if (!record) continue;
        record.isIntersecting = registration.pendingReport.isIntersecting;
        record.isVisible = registration.pendingReport.isVisible;
        registration.pendingReport = null;
      }
      recomputeFrontier();
      reconcile();
      flushBatch();
    },
    getHydratedIds() {
      return sortByIndex(records.values())
        .filter((record) => record.hydrated)
        .map((record) => record.id);
    },
    dispose() {
      disposed = true;
      cancelScheduledHydration();
      for (const registration of registrations.values()) registration.release?.();
      registrations.clear();
      records.clear();
      frontierId = undefined;
    },
  };
}
