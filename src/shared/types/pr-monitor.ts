import { z } from 'zod';
import { ReviewTargetSchema, type ReviewTarget } from './repository-context';

export const MonitorResourceSchema = ReviewTargetSchema.refine(
  (value) =>
    (value.repository.provider === 'github' && value.kind === 'pull-request') ||
    (value.repository.provider === 'gitlab' && value.kind === 'merge-request'),
);
export const MonitorAvailabilitySchema = z
  .union([
    z.object({
      state: z.enum([
        'available',
        'pending',
        'reconnect-required',
        'restricted',
        'disabled',
        'unsupported',
        'unavailable',
        'unknown',
      ]),
    }),
    z.object({ state: z.literal('backoff'), retryAt: z.string() }),
    z.object({
      state: z.literal('unresolved'),
      reason: z
        .enum([
          'missing-provenance',
          'unverified-import',
          'invalid-target',
          'missing-authority',
          'unknown',
        ])
        .catch('unknown'),
    }),
  ])
  .catch({ state: 'unknown' });
type MonitorAvailability = z.infer<typeof MonitorAvailabilitySchema>;
export interface ReviewMonitorExtension {
  resource?: ReviewTarget;
  monitorAvailability?: MonitorAvailability;
}

/** Local IPC correlation only. Private daemon/account authority stays on the host. */
export const PrMonitorOriginSchema = z
  .object({
    backendId: z.string().min(1),
    sessionId: z.string().min(1),
    workspaceId: z.string().min(1),
  })
  .strict();
export type PrMonitorOrigin = z.infer<typeof PrMonitorOriginSchema>;
export type ReviewMonitoringSupport = 'supported' | 'unsupported' | 'consumer-pending';
export function supportsReviewMonitoring(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/** `lastSnapshot` merge-requirements projection (`prMonitor.list` rows). */
export interface PrMonitorSnapshot {
  state: string;
  isDraft: boolean;
  hasConflicts: boolean;
  isBehind: boolean;
  mergeable?: boolean | null;
  mergeBlockedReason?: string | null;
  checks: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
    failingRequired: number;
    pendingRequired: number;
    /** "required" flags are only meaningful when true. */
    requiredKnown: boolean;
  };
  approvals: {
    decision: string;
    have: number;
    needed?: number | null;
    changesRequested: number;
  };
  threads: {
    /** Absent (never `null`) when the host could not read thread resolution
     * state — the count is unknown, not zero. */
    unresolved?: number;
    resolutionRequired?: boolean | null;
  };
  /** Additive: present (true) when the host reports the PR queued to merge;
   * absent when not queued or unknown. */
  isInMergeQueue?: boolean;
  rulesKnown: boolean;
}

/** Wire `prMonitor.list` row. Cancelled monitors are excluded server-side;
 * `title`/`url`/`lastSnapshot` are absent until the first successful poll. */
export interface PrMonitorRow extends ReviewMonitorExtension {
  /** Main-owned destination evidence; never sent as daemon authority. */
  origin?: PrMonitorOrigin;
  monitorId: string;
  workspaceId: string;
  agentId: string;
  /** `<owner>/<name>`. */
  repo: string;
  prNumber: number;
  state: 'active' | 'completed';
  pendingChanges: string[];
  hasPendingChanges: boolean;
  createdAt: string;
  updatedAt: string;
  pendingSince?: string;
  lastChangeAt?: string;
  lastPolledAt?: string;
  lastError?: string;
  /** RFC 3339 deadline of the daemon's forge rate-limit pause; present on
   * ACTIVE rows only while polling is suspended (`lastSnapshot` is stale
   * until the first post-pause poll clears it). */
  pausedUntil?: string;
  title?: string;
  url?: string;
  lastSnapshot?: PrMonitorSnapshot;
}

/** `prMonitor:*` event payload (§6.5): canonical identity fields plus
 * per-type extras (`changes` on `prMonitor:changed`). */
export interface PrMonitorEventData extends ReviewMonitorExtension {
  workspaceId?: string;
  agentId?: string;
  monitorId?: string;
  repo?: string;
  prNumber?: number;
  state?: string;
  changes?: string[];
}

type ReviewSignalAvailability =
  'available' | 'restricted' | 'unavailable' | 'transient' | 'rate-limited' | 'unknown';
interface QualifiedPrMonitorSnapshot extends Omit<
  PrMonitorSnapshot,
  'isDraft' | 'hasConflicts' | 'isBehind' | 'checks' | 'approvals'
> {
  isDraft: boolean | null;
  hasConflicts: boolean | null;
  isBehind: boolean | null;
  checks: {
    [K in keyof PrMonitorSnapshot['checks']]: K extends 'requiredKnown' ? boolean : number | null;
  };
  approvals: {
    decision: string | null;
    have: number | null;
    needed?: number | null;
    changesRequested: number | null;
  };
  availability?: Record<
    'policy' | 'approvals' | 'checks' | 'discussions',
    ReviewSignalAvailability
  >;
}
/** The same shared row, retaining qualified nullable facts without legacy defaults. */
export interface ReviewMonitorRow extends Omit<PrMonitorRow, 'lastSnapshot' | 'title' | 'url'> {
  title?: string | null;
  url?: string | null;
  lastSnapshot?: QualifiedPrMonitorSnapshot | null;
}
/** Temporary guard for existing consumers. This is NOT provider or authority inference. */
export function isLegacyMonitorPresentation(row: ReviewMonitorRow): row is PrMonitorRow {
  if (
    row.resource ||
    row.monitorAvailability ||
    row.title === null ||
    row.url === null ||
    row.lastSnapshot === null
  )
    return false;
  const snapshot = row.lastSnapshot;
  return (
    !snapshot ||
    (!snapshot.availability &&
      snapshot.isDraft !== null &&
      snapshot.hasConflicts !== null &&
      snapshot.isBehind !== null &&
      Object.values(snapshot.checks).every((value) => value !== null) &&
      snapshot.approvals.decision !== null &&
      snapshot.approvals.have !== null &&
      snapshot.approvals.changesRequested !== null)
  );
}

export interface PrMonitorSession {
  readonly origin: PrMonitorOrigin;
  readonly support: ReviewMonitoringSupport;
  request<T>(
    method:
      | 'prMonitor.list'
      | 'prMonitor.cancel'
      | 'prMonitor.flush'
      | 'events.subscribe'
      | 'events.unsubscribe',
    params: Record<string, unknown>,
  ): Promise<T>;
  onNotification(handler: (notification: { method: string; params?: unknown }) => void): () => void;
  onRetired(handler: () => void): () => void;
  release(): Promise<void>;
}

/** History consumers admitted by the document's monitor recipient receipt. */
export const REVIEW_MONITOR_HISTORY_METHODS: ReadonlySet<string> = new Set([
  'agent.getConversation',
  'agent.listUserMessages',
  'agent.getMessageBlock',
  'chat.subscribe',
  'chat.unsubscribe',
]);
