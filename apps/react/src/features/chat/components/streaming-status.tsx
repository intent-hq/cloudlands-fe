// Source: src/lib/components/chat/StreamingStatus.svelte.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { RelativeTime } from '@/components/ui/relative-time';
import {
  crispOut,
  fade,
  usePresence,
  usePresenceTransition,
  type TransitionFactory,
} from '@/lib/motion';
import { cn } from '@/lib/utils';
import { faRotateRight, faExclamationTriangle, faStop } from '$lib/icons/phosphor-icon-definitions';
import type { FeOwnedSessionState } from '../../../../../../src/store/renderer/slices/agent-session/agent-session-types';
import {
  deriveErrorDisplay,
  formatElapsed,
  getActiveStalledEvent,
  getLatestThinkingStatusEvent,
  getStatusMarkVariant,
} from '$lib/components/chat/streaming-status-utils';
import { m } from '$shared/paraglide/messages.js';
import { FailureDetails } from './failure-details';
import { StreamingTypingIndicator } from './streaming-typing-indicator';

export interface StreamingStatusProps {
  /** Whether streaming is active */
  isStreaming?: boolean;
  /** Whether processing (waiting for response) */
  isProcessing?: boolean;
  /** When the last streaming chunk was received (timestamp in ms) */
  lastChunkTime?: number | null;
  /** Whether we've received the first real chunk (distinct from lastChunkTime which is set on 'start') */
  receivedFirstChunk?: boolean;
  /** Current streaming content length (to know if we've received anything) */
  streamingContentLength?: number;
  /** Error message if connection failed */
  error?: string | null;
  recoveryState?: 'attempting' | 'queued' | 'action-needed' | 'inactive';
  /**
   * Daemon-derived corrupted-session flag (monorepo#940) — when true, the
   * error surface shows recreate-aware copy instead of the raw error.
   */
  sessionCorrupted?: boolean;
  /** ISO timestamp of when the failure occurred - renders a live "failed X ago" */
  failedAt?: string | null;
  /**
   * Provider auth-failure login guidance: when the error matches the
   * provider's auth-error patterns, shows the copyable login command (and
   * the claude-code desktop-app caveat) instead of just the raw error.
   */
  authGuidance?: {
    loginCommandHint: string;
    showClaudeDesktopNote: boolean;
  } | null;
  /** Model unavailable info - when set, shows retry with suggested model */
  modelUnavailable?: {
    failedModel: string;
    nextAvailableModel: string;
  } | null;
  /**
   * Provider usage-limit recovery (#4455): set when the daemon reported
   * `errorCode: "quota-exceeded"` for the failed turn. `providerId` is the
   * provider that ran out (already excluded from `quotaRetryProviders`).
   * Retrying the same provider cannot succeed, so the banner offers the
   * available alternatives instead of a bare "Try again".
   */
  quotaExceeded?: { providerId: string; displayName?: string } | null;
  /**
   * Alternative providers offerable for a quota retry — enabled, installed
   * and authenticated, minus the exhausted one. Empty means no alternative
   * is usable, so the banner falls back to the plain error surface rather
   * than dangling an action that cannot work.
   */
  quotaRetryProviders?: Array<{ id: string; displayName: string }>;
  /** Transient lifecycle status events from the backend */
  statusEvents?: Array<{
    phase: string;
    message: string;
    level: 'info' | 'warn' | 'error';
    timestamp: number;
  }>;
  /** When streaming/processing started (timestamp ms) - used to calculate reveal delay */
  streamingStartTime?: number | null;
  /** Whether a permission request is pending - if true, hide the thinking indicator */
  hasPendingPermission?: boolean;
  /**
   * Daemon admission hint (PROTOCOL §6.5): while `waiting` is true the turn
   * is parked for a free agent slot or memory headroom, so the row explains
   * the wait instead of leaving a bare "Thinking" that looks stalled.
   */
  processQueueHint?: FeOwnedSessionState['processQueueHint'];
  /** Guarded retry callback; queued input may still need terminal session recovery. */
  onRetry?: () => void;
  /** Callback to retry with a specific model */
  onRetryWithModel?: (model: string) => void;
  /**
   * Callback to retry the failed turn on a different provider (#4455).
   * Switches the live session to `providerId` and redrives the turn.
   */
  onRetryWithProvider?: (providerId: string) => void;
  /** Callback to stop streaming */
  onStop?: () => void;
  /** Callback to cancel the stalled turn and re-send the last input (monorepo#3402) */
  onStalledRetry?: () => void;
  /** Additional class names */
  class?: string;
  /** React spelling of the source class prop; overrides class when both are supplied. */
  className?: string;
  /** Host-owned navigation to agent-backend settings. */
  onOpenAgentBackendSettings: () => void | Promise<void>;
}

type Status = 'normal' | 'error' | 'model-unavailable' | 'quota-exceeded';

const statusFade: TransitionFactory = (node) =>
  fade(node, { tier: 'moderate' }, { direction: 'both' });
const queueTransition: TransitionFactory = (node) => {
  const enter = fade(node, { tier: 'moderate' }, { direction: 'in' });
  return ({ direction = 'in' } = {}) =>
    direction === 'out'
      ? crispOut(node, { tier: 'moderate' })
      : typeof enter === 'function'
        ? enter({ direction: 'in' })
        : enter;
};

type StatusElement = ReactElement<ComponentProps<'div'>>;

/** Keep the source branch's last content through its outro without adding a wrapper. */
function StatusPresence({
  children,
  transition = statusFade,
}: {
  children: StatusElement | null;
  transition?: TransitionFactory;
}) {
  const items = useMemo(() => (children ? [children] : []), [children]);
  const { entries, remove } = usePresence(items, () => 'status');
  return entries.map(({ key, value, present }) => (
    <StatusSurface
      key={key}
      element={value}
      present={present}
      onExit={() => remove(key)}
      transition={transition}
    />
  ));
}

function StatusSurface({
  element,
  present,
  onExit,
  transition,
}: {
  element: StatusElement;
  present: boolean;
  onExit: () => void;
  transition: TransitionFactory;
}) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, transition);
  return <div {...element.props} ref={root} inert={!present} />;
}

export function StreamingStatus({
  isStreaming = false,
  isProcessing = false,
  lastChunkTime = null,
  receivedFirstChunk: _receivedFirstChunk = false,
  streamingContentLength: _streamingContentLength = 0,
  error = null,
  recoveryState,
  sessionCorrupted = false,
  failedAt = null,
  authGuidance = null,
  modelUnavailable = null,
  quotaExceeded = null,
  quotaRetryProviders = [],
  statusEvents = [],
  streamingStartTime: _streamingStartTime = null,
  hasPendingPermission = false,
  processQueueHint = undefined,
  onRetry,
  onRetryWithModel,
  onRetryWithProvider,
  onStop,
  onStalledRetry,
  class: sourceClass = '',
  className = sourceClass,
  onOpenAgentBackendSettings,
}: StreamingStatusProps) {
  const attempting = recoveryState ? recoveryState === 'attempting' : isStreaming || isProcessing;
  const status: Status = attempting
    ? 'normal'
    : modelUnavailable
      ? 'model-unavailable'
      : quotaExceeded && quotaRetryProviders.length > 0
        ? 'quota-exceeded'
        : error
          ? 'error'
          : 'normal';
  const quotaProviderLabel = quotaExceeded
    ? (quotaExceeded.displayName ?? quotaExceeded.providerId)
    : '';
  const visible =
    error || modelUnavailable || ((isStreaming || isProcessing) && !hasPendingPermission);
  const turnActive = status === 'normal' && (isStreaming || isProcessing) && !hasPendingPermission;
  // Admission waits accompany thinking and supersede a concurrent stall.
  const queueWait = turnActive && processQueueHint?.waiting ? processQueueHint : null;
  const stalledEvent =
    turnActive && !queueWait ? getActiveStalledEvent(statusEvents, lastChunkTime) : null;
  const thinkingVisible = turnActive && !stalledEvent;
  const queueWaitMessage = queueWait
    ? queueWait.reason === 'memory-budget'
      ? m.chat_streamingStatus_memoryWait_label({ used: queueWait.used, cap: queueWait.cap })
      : m.chat_streamingStatus_slotWait_label({ used: queueWait.used, cap: queueWait.cap })
    : null;
  const latestStatusEvent = getLatestThinkingStatusEvent(statusEvents);
  const markVariant = getStatusMarkVariant(latestStatusEvent?.phase);
  const [nowMs, setNowMs] = useState(Date.now);
  const [thinkingHovered, setThinkingHovered] = useState(false);
  const thinkingElapsedTicking = thinkingVisible && !!latestStatusEvent && thinkingHovered;

  useEffect(() => {
    if (!thinkingElapsedTicking && !stalledEvent) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Match the source's immediate refresh when hover or a stall acquires the local timer.
    setNowMs(Date.now());
    const elapsedInterval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(elapsedInterval);
  }, [thinkingElapsedTicking, stalledEvent]);

  const elapsedTime = latestStatusEvent
    ? m.chat_streamingStatus_elapsedAgo_label({
        duration: formatElapsed(nowMs - latestStatusEvent.timestamp),
      })
    : null;
  // Anchor silence at its actual start, before the daemon emitted the stalled event.
  const stalledElapsed = stalledEvent
    ? formatElapsed(nowMs - (stalledEvent.timestamp - (stalledEvent.silentMs ?? 0)))
    : null;
  const errorDisplay = deriveErrorDisplay(error, sessionCorrupted);

  return (
    <>
      <StreamingTypingIndicator
        visible={thinkingVisible}
        message={m.chat_streamingStatus_thinking_label()}
        showMessage={false}
        lifecycleMessage={latestStatusEvent?.message}
        elapsed={elapsedTime}
        onHoverChange={setThinkingHovered}
        variant={markVariant}
        className={`mt-[var(--space-3)] ${className}`}
      />

      <StatusPresence transition={queueTransition}>
        {queueWait && queueWaitMessage ? (
          <div
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source admission-wait live status container.
            role="status"
            aria-live="polite"
            data-stream-slot-wait="true"
            data-queue-reason={queueWait.reason}
            className={cn(
              'type-caption mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-danger/20 bg-danger/5 py-2 pl-2 pr-1 text-danger',
              className,
            )}
          >
            <IconDefinitionIcon icon={faExclamationTriangle} className="shrink-0 text-danger/70" />
            <span className="min-w-0 flex-1 break-words" data-testid="slot-wait-message">
              {queueWaitMessage}
            </span>
            <Button
              variant="link"
              size="sm"
              onClick={() => void onOpenAgentBackendSettings()}
              className="type-caption h-7 shrink-0 px-2 text-danger underline"
              data-testid="slot-wait-change-limit"
            >
              {m.chat_streamingStatus_changeLimit_label()}
            </Button>
          </div>
        ) : null}
      </StatusPresence>

      <StatusPresence>
        {stalledEvent ? (
          <div
            data-stream-stalled="true"
            className={cn(
              'type-caption mt-2 flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 py-2 pl-2 pr-1',
              className,
            )}
          >
            {/* Only the static announcement is live; the elapsed label must not repeat it. */}
            <span
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source's separate static announcement.
              role="status"
              className="sr-only"
              data-testid="stalled-announcement"
            >
              {m.chat_streamingStatus_stalledAnnouncement_label()}
            </span>
            <IconDefinitionIcon
              icon={faExclamationTriangle}
              className="shrink-0 text-warning-ink"
            />
            <span
              className="min-w-0 flex-1 truncate text-warning-ink"
              data-testid="stalled-message"
            >
              {m.chat_streamingStatus_stalled_label({ duration: stalledElapsed ?? '' })}
            </span>
            {onStalledRetry && (
              <Button
                variant="ghost-light"
                size="sm"
                onClick={onStalledRetry}
                className="type-caption h-7 shrink-0 gap-1.5 px-2 text-muted-foreground"
                data-testid="stalled-retry"
              >
                <IconDefinitionIcon icon={faRotateRight} className="size-3" />
                {m.chat_streamingStatus_stalledRetry_label()}
              </Button>
            )}
            {onStop && (
              <Button
                variant="ghost-light"
                size="sm"
                onClick={onStop}
                className="type-caption h-7 shrink-0 gap-1.5 px-2 text-muted-foreground"
                data-testid="stalled-cancel"
              >
                <IconDefinitionIcon icon={faStop} className="size-3" />
                {m.chat_streamingStatus_stalledCancel_label()}
              </Button>
            )}
          </div>
        ) : null}
      </StatusPresence>

      <StatusPresence>
        {visible && status !== 'normal' ? (
          <div
            role={status === 'error' ? 'alert' : undefined}
            aria-live={status === 'error' ? 'assertive' : undefined}
            data-stream-terminal-error="true"
            data-testid="failure-recovery-card"
            className={cn(
              'type-caption flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3',
              status === 'error' && 'mt-2',
              (status === 'model-unavailable' || status === 'quota-exceeded') &&
                'rounded-md border border-warning/20 bg-warning/5 pl-2 pr-3',
              className,
            )}
          >
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {status === 'model-unavailable' && modelUnavailable ? (
                  <>
                    <IconDefinitionIcon
                      icon={faExclamationTriangle}
                      className="shrink-0 text-warning-ink"
                    />
                    <span className="text-warning-ink">
                      {m.chat_streamingStatus_modelUnavailable_before()}{' '}
                      <code className="px-1 py-0.5 bg-muted rounded text-ui">
                        {modelUnavailable.failedModel}
                      </code>{' '}
                      {m.chat_streamingStatus_modelUnavailable_after()}
                    </span>
                  </>
                ) : status === 'quota-exceeded' && quotaExceeded ? (
                  <>
                    <IconDefinitionIcon
                      icon={faExclamationTriangle}
                      className="shrink-0 text-warning/70"
                    />
                    <span className="text-warning" data-testid="error-quota-exceeded">
                      {m.chat_streamingStatus_quotaExceeded_before()}{' '}
                      <code className="px-1 py-0.5 bg-muted rounded text-ui">
                        {quotaProviderLabel}
                      </code>{' '}
                      {m.chat_streamingStatus_quotaExceeded_after()}
                    </span>
                  </>
                ) : status === 'error' && errorDisplay ? (
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium text-danger" data-testid="error-title">
                      {errorDisplay.corrupted
                        ? errorDisplay.title
                        : m.chat_failureRecovery_title_label()}
                      {failedAt && (
                        <span
                          className="type-caption ml-1.5 leading-4 font-normal text-muted-foreground"
                          data-testid="error-failed-at"
                        >
                          <RelativeTime date={failedAt} />
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground" data-testid="error-message">
                      {errorDisplay.corrupted
                        ? errorDisplay.message
                        : recoveryState === 'queued'
                          ? m.chat_failureRecovery_queued_description()
                          : m.chat_failureRecovery_action_description()}
                    </span>
                    <span className="type-caption text-muted-foreground">
                      {recoveryState === 'queued'
                        ? m.chat_failureRecovery_queued_label()
                        : m.chat_failureRecovery_action_label()}
                    </span>
                    {authGuidance && (
                      <div className="mt-1.5 flex flex-col gap-1" data-testid="error-auth-guidance">
                        <span className="type-caption leading-4 text-muted-foreground">
                          {m.settings_providers_runToLogIn_label()}
                        </span>
                        <div className="flex items-center gap-1">
                          <code
                            className="rounded bg-muted px-1.5 py-0.5 text-ui"
                            data-testid="error-auth-login-command"
                          >
                            {authGuidance.loginCommandHint}
                          </code>
                          <CopyButton text={authGuidance.loginCommandHint} size="xs" />
                        </div>
                        {authGuidance.showClaudeDesktopNote && (
                          <span
                            className="type-caption leading-4 text-muted-foreground"
                            data-testid="error-auth-claude-desktop-note"
                          >
                            {m.settings_providers_claudeDesktopNote_label()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {status === 'quota-exceeded' && onRetryWithProvider ? (
                  quotaRetryProviders.map((alt) => (
                    <Button
                      key={alt.id}
                      variant="default"
                      size="sm"
                      onClick={() => onRetryWithProvider(alt.id)}
                      data-testid="retry-with-provider"
                      className="type-caption h-7 gap-1.5 px-2"
                    >
                      <IconDefinitionIcon icon={faRotateRight} className="size-3" />
                      {m.chat_streamingStatus_retryOnProvider_label({ provider: alt.displayName })}
                    </Button>
                  ))
                ) : status === 'model-unavailable' && modelUnavailable && onRetryWithModel ? (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onRetryWithModel(modelUnavailable.nextAvailableModel)}
                    className="type-caption h-7 gap-1.5 px-2"
                  >
                    <IconDefinitionIcon icon={faRotateRight} className="size-3" />
                    {m.chat_streamingStatus_retryWith_label({
                      model: modelUnavailable.nextAvailableModel,
                    })}
                  </Button>
                ) : status === 'error' && onRetry && !attempting ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onRetry}
                    className="shrink-0 text-muted-foreground"
                  >
                    <IconDefinitionIcon icon={faRotateRight} className="size-3" />
                    {m.chat_shared_retry_label()}
                  </Button>
                ) : null}
                {error && <FailureDetails text={error} />}
              </div>
            </div>
          </div>
        ) : null}
      </StatusPresence>
    </>
  );
}

export default StreamingStatus;
