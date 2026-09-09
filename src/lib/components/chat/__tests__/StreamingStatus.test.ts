/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overwriteGetLocale } from '$shared/paraglide/runtime.js';

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('./mocks/Button.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/FaIcon.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faExclamationTriangle: { iconName: 'exclamation-triangle' },
  faRotateRight: { iconName: 'rotate-right' },
  faCopy: { iconName: 'copy' },
  faCheck: { iconName: 'check' },
  faStop: { iconName: 'stop' },
}));

import StreamingStatus from '../StreamingStatus.svelte';
import {
  formatDuration,
  formatElapsed,
  computeCompletedEvents,
  deriveErrorDisplay,
  getActiveStalledEvent,
  getLatestThinkingStatusEvent,
  latestMeaningfulStatusMessage,
  shouldAppendStreamingEvent,
  SESSION_CORRUPTED,
  STALLED_PHASE,
  type StatusEvent,
} from '../streaming-status-utils';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  overwriteGetLocale(() => 'en');
});

describe('StreamingStatus rendered UI', () => {
  it('renders one active 16px phase mark and the localized Thinking row', () => {
    const { container } = render(StreamingStatus, {
      props: {
        isProcessing: true,
        seed: 'agent-1',
        statusEvents: [
          { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
        ],
      },
    });

    const row = container.firstElementChild as HTMLElement;
    const mark = screen.getByRole('status', { name: 'Loading' });
    const label = screen.getByTestId('streaming-status-thinking-label');
    const lifecycle = screen.getByTestId('streaming-status-phase');

    expect(row.className).toContain('h-7');
    expect(row.className).toContain('px-[var(--operational-row-inline-padding)]');
    expect(row.className).toContain(
      'grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto]',
    );
    expect(row.className).toContain('mt-2');
    expect(mark.getAttribute('data-variant')).toBe('pulse');
    expect(mark.getAttribute('data-playing')).toBe('true');
    expect(mark.getAttribute('width')).toBe('16');
    expect(mark.parentElement?.className).toContain('size-[var(--operational-leading-slot-size)]');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(label.textContent).toBe('Thinking');
    expect(label.className).toContain('text-foreground');
    expect(lifecycle.textContent).toBe('Sent prompt…');
    expect(lifecycle.className).toContain('text-muted-foreground');
    expect(lifecycle.className).toContain('truncate');
    expect(row.textContent).not.toContain('·');
    expect(lifecycle.closest('[role="status"]')).toBeNull();
    expect(lifecycle.closest('[aria-live]')).toBeNull();
  });

  it('shows the newest daemon message and maps all lifecycle phases to mark variants', async () => {
    const { container, rerender } = render(StreamingStatus, {
      props: {
        isStreaming: true,
        statusEvents: [
          { phase: 'prompt', message: 'Exact daemon prompt', level: 'info', timestamp: 2000 },
          { phase: 'launch', message: 'Older event', level: 'info', timestamp: 1000 },
        ],
      },
    });

    expect(screen.getByTestId('streaming-status-phase').textContent).toBe('Exact daemon prompt');
    expect(
      container.querySelector('[data-slot="intent-mark-loader"]')?.getAttribute('data-variant'),
    ).toBe('pulse');

    for (const [phase, variant] of [
      ['session-create', 'pulse'],
      ['session-load', 'pulse'],
      ['init', 'pulse'],
      ['tool-call', 'twist'],
      ['tool-waiting', 'twist'],
      ['streaming', 'bloom'],
      ['future-phase', 'bloom'],
    ] as const) {
      await rerender({
        isStreaming: true,
        statusEvents: [
          { phase, message: `Daemon message for ${phase}`, level: 'info', timestamp: 3000 },
        ],
      });
      expect(screen.getByTestId('streaming-status-phase').textContent).toBe(
        `Daemon message for ${phase}`,
      );
      expect(
        container.querySelector('[data-slot="intent-mark-loader"]')?.getAttribute('data-variant'),
      ).toBe(variant);
    }
  });

  it('keeps the Thinking label when lifecycle phase text is missing', () => {
    render(StreamingStatus, { props: { isProcessing: true, statusEvents: [] } });

    expect(screen.getByTestId('streaming-status-thinking').textContent).toBe('Thinking');
    expect(screen.queryByTestId('streaming-status-phase')).toBeNull();
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Loading');
  });

  it('uses the active locale for Thinking and preserves an already-localized lifecycle phrase', () => {
    overwriteGetLocale(() => 'es');
    render(StreamingStatus, {
      props: {
        isProcessing: true,
        statusEvents: [
          { phase: 'prompt', message: 'Solicitud enviada…', level: 'info', timestamp: 1000 },
        ],
      },
    });

    expect(screen.getByTestId('streaming-status-thinking-label').textContent).toBe('Pensando');
    expect(screen.getByTestId('streaming-status-phase').textContent).toBe('Solicitud enviada…');
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Cargando');
  });

  it('shows live elapsed detail only on row hover and keeps it non-live and non-focusable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    render(StreamingStatus, {
      props: {
        isProcessing: true,
        statusEvents: [
          {
            phase: 'streaming',
            message: 'Streaming the response',
            level: 'info',
            timestamp: 7_800,
          },
        ],
      },
    });

    const row = screen
      .getByTestId('streaming-status-thinking')
      .closest('[data-streaming-typing-row]')!;
    const elapsed = screen.getByTestId('streaming-status-elapsed');
    expect(row.className).toContain('group');
    expect(elapsed.textContent).toBe('2s ago');
    expect(elapsed.className).toContain('opacity-0');
    expect(elapsed.className).toContain('group-hover:opacity-100');
    expect(elapsed.getAttribute('aria-live')).toBe('off');
    expect(elapsed.getAttribute('tabindex')).toBeNull();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.getByTestId('streaming-status-elapsed').textContent).toBe('3s ago');
  });

  it('renders explicit failed response copy, alert semantics, and retry action for inactive errors', async () => {
    const onRetry = vi.fn();
    const { container } = render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
        onRetry,
      },
    });

    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.getByTestId('error-message').textContent).toBe('Stream timeout after 10 minutes');
    expect(screen.getByTestId('error-message').className).toContain('truncate');
    expect(screen.getByTestId('error-message').parentElement?.className).toContain(
      'text-muted-foreground',
    );
    expect(screen.getByTestId('error-message').parentElement?.className).toContain('type-caption');
    expect(container.firstElementChild?.className).not.toContain('pl-2');
    expect(container.firstElementChild?.className).toContain('mt-2');

    const copyButton = screen.getByRole('button', { name: /copy error details/i });
    expect(copyButton).toBeTruthy();
    expect(copyButton.className).toContain('text-muted-foreground');
    expect(copyButton.className).toContain('absolute');
    expect(copyButton.className).toContain('top-3');
    expect(copyButton.className).toContain('-translate-y-1/2');
    expect(copyButton.getAttribute('data-variant')).toBe('ghost-light');
    expect(copyButton.getAttribute('data-size')).toBe('icon-sm');
    expect(copyButton.querySelector('[data-icon="copy"]')).toBeTruthy();
    expect(copyButton.parentElement?.className).toContain('gap-x-1.5');
    expect(copyButton.parentElement?.className).toContain('min-h-5');
    expect(copyButton.parentElement?.className).toContain('grid-cols-[1.75rem_minmax(0,1fr)]');
    expect(copyButton.nextElementSibling?.className).toContain('col-start-2');
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry.textContent?.trim()).toBe('');
    expect(retry.className).toContain('shrink-0');
    expect(retry.className).toContain('text-muted-foreground');
    await fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('copies the full error to clipboard when copy button is clicked', async () => {
    const writeTextMock = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
      },
    });

    const copyButton = screen.getByRole('button', { name: /copy error details/i });
    const stableClassName = copyButton.className;
    copyButton.focus();
    expect(document.activeElement).toBe(copyButton);
    expect(copyButton.tabIndex).toBe(0);
    await fireEvent.click(copyButton);
    expect(writeTextMock).toHaveBeenCalledOnce();
    expect(writeTextMock).toHaveBeenCalledWith(
      'Response failed\n\nStream timeout after 10 minutes',
    );
    await waitFor(() => expect(copyButton.querySelector('[data-icon="check"]')).toBeTruthy());
    expect(copyButton.className).toBe(stableClassName);
    expect(copyButton.getAttribute('aria-label')).toBe('Copy error details to clipboard');
  });

  it('removes the failure top step only when its caller marks it as the first row', () => {
    const { container } = render(StreamingStatus, {
      props: { error: 'Stream timeout', class: 'mt-0' },
    });

    expect(container.firstElementChild?.className).toContain('mt-0');
    expect(container.firstElementChild?.className).not.toContain('mt-2');
  });

  it('renders recreate-aware corrupted-session copy with the raw error as secondary detail (monorepo#940)', async () => {
    const onRetry = vi.fn();
    render(StreamingStatus, {
      props: {
        error: 'JSON-RPC error -32603: prompt rejected by provider',
        sessionCorrupted: true,
        onRetry,
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Agent session corrupted');
    expect(screen.getByTestId('error-message').textContent).toBe(
      'Try again will start a fresh session and carry over the conversation history',
    );
    expect(screen.queryByTestId('error-detail')).toBeNull();
    await fireEvent.click(screen.getByTestId('error-message'));
    expect(screen.getByTestId('error-message').className).toContain('whitespace-pre-wrap');
    expect(screen.getByTestId('error-detail').textContent).toBe(
      'JSON-RPC error -32603: prompt rejected by provider',
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders ordinary error copy without secondary detail when the flag is absent (older daemons)', () => {
    render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.getByTestId('error-message').textContent).toBe('Stream timeout after 10 minutes');
    expect(screen.queryByTestId('error-detail')).toBeNull();
  });

  it('keeps terminal failure visible even if a stale permission request flag remains set', () => {
    render(StreamingStatus, {
      props: {
        error: 'The agent response timed out before it finished.',
        hasPendingPermission: true,
      },
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
  });

  it('shows failure copy without retry while active flags are still clearing', () => {
    const onRetry = vi.fn();
    render(StreamingStatus, {
      props: {
        isStreaming: true,
        error: 'Provider crashed while finalizing the stream',
        onRetry,
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('prioritizes model-unavailable recovery over generic failure copy', async () => {
    const onRetryWithModel = vi.fn();
    const { container } = render(StreamingStatus, {
      props: {
        error: 'Model failed to start',
        modelUnavailable: {
          failedModel: 'gpt5.5',
          nextAvailableModel: 'gpt5.5-fast',
        },
        onRetryWithModel,
      },
    });

    expect(screen.queryByTestId('error-title')).toBeNull();
    expect(container.textContent).toContain('gpt5.5');
    expect(container.textContent).toContain('is not available');
    expect(container.firstElementChild?.className).not.toContain('mt-2');

    await fireEvent.click(screen.getByRole('button', { name: /retry with gpt5\.5-fast/i }));
    expect(onRetryWithModel).toHaveBeenCalledWith('gpt5.5-fast');
  });

  it('stays hidden when nothing is streaming/processing (IDLE-1: coordinator waiting on children)', () => {
    // A coordinator whose own turn has ended but is still waiting on delegated
    // children clears `isStreaming` / `isProcessing` in the agent-session slice
    // (PROTOCOL §5.5 isWaitingForOtherAgents is a separate BE-authoritative flag,
    // no longer plumbed into this component). The Thinking spinner must not
    // render for that idle-wait — the "waiting on N agents" affordance lives on
    // separate sidebar/list surfaces.
    const { container } = render(StreamingStatus, {
      props: {
        isStreaming: false,
        isProcessing: false,
        seed: 'agent-1',
      },
    });

    expect(screen.queryByTestId('streaming-status-thinking')).toBeNull();
    expect(container.firstElementChild).toBeNull();
  });

  it('clears failed presentation when a new stream starts', async () => {
    const { rerender } = render(StreamingStatus, {
      props: {
        error: 'Previous response failed',
      },
    });

    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');

    await rerender({
      error: null,
      isProcessing: true,
      seed: 'agent-1',
    });

    await waitFor(() => expect(screen.queryByTestId('error-title')).toBeNull());
    expect(screen.getByTestId('streaming-status-thinking').textContent).toBe('Thinking');
  });

  it('renders a live "failed X ago" span next to the error title when failedAt is set', () => {
    render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
        failedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    });

    const failedAtEl = screen.getByTestId('error-failed-at');
    expect(failedAtEl).toBeTruthy();
    expect(failedAtEl.className).toContain('text-muted-foreground');
    expect(failedAtEl.className).toContain('type-caption');
    expect(failedAtEl.className).toContain('leading-4');
    expect(screen.getByTestId('error-title').textContent).not.toContain('·');
    expect(screen.getByTestId('error-title').textContent).toContain('Response failed');
  });

  it('omits the failed-X-ago span when failedAt is absent (older daemons / transient chat errors)', () => {
    render(StreamingStatus, {
      props: {
        error: 'Stream timeout after 10 minutes',
      },
    });

    expect(screen.queryByTestId('error-failed-at')).toBeNull();
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
  });

  it('renders login guidance (copyable command + claude desktop caveat) on provider auth failures', () => {
    render(StreamingStatus, {
      props: {
        error: 'JSON-RPC error -32000: Authentication required',
        authGuidance: {
          loginCommandHint: 'claude /login',
          showClaudeDesktopNote: true,
        },
      },
    });

    expect(screen.getByTestId('error-auth-guidance')).toBeTruthy();
    expect(screen.getByTestId('error-auth-login-command').textContent).toBe('claude /login');
    expect(screen.getByTestId('error-auth-claude-desktop-note')).toBeTruthy();
    // The raw error message stays visible alongside the guidance.
    expect(screen.getByTestId('error-message').textContent).toContain('Authentication required');
  });

  it('hides the desktop caveat for non-claude providers and omits guidance entirely without it', () => {
    const { rerender, unmount } = render(StreamingStatus, {
      props: {
        error: 'JSON-RPC error -32000: Authentication required',
        authGuidance: {
          loginCommandHint: 'codex login',
          showClaudeDesktopNote: false,
        },
      },
    });

    expect(screen.getByTestId('error-auth-login-command').textContent).toBe('codex login');
    expect(screen.queryByTestId('error-auth-claude-desktop-note')).toBeNull();
    unmount();

    render(StreamingStatus, {
      props: { error: 'spawn failed: EPERM' },
    });
    expect(screen.queryByTestId('error-auth-guidance')).toBeNull();
    void rerender;
  });
});

describe('StreamingStatus stalled state (monorepo#3402)', () => {
  const stalledEvent = (timestamp: number): StatusEvent => ({
    phase: STALLED_PHASE,
    message: 'No model activity for 90s',
    level: 'warn',
    timestamp,
  });

  it('renders the warn-styled stalled row with live elapsed copy and hides the thinking indicator', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { container } = render(StreamingStatus, {
      props: {
        isStreaming: true,
        onStop: vi.fn(),
        statusEvents: [
          { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 5_000 },
          stalledEvent(95_000),
        ],
      },
    });

    const row = container.querySelector('[data-stream-stalled="true"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.className).toContain('border-warning/20');
    expect(row.className).toContain('bg-warning/5');
    expect(screen.getByTestId('stalled-message').textContent).toBe('No model activity for 5s');
    expect(screen.queryByTestId('streaming-status-thinking')).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByTestId('stalled-message').textContent).toBe('No model activity for 7s');
  });

  it('anchors the duration at timestamp - silentMs so the measured silence is included', async () => {
    // The daemon only emits the stalled event after `silentMs` of measured
    // silence, so the first render must already report that silence instead
    // of starting the counter at the emission time.
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    render(StreamingStatus, {
      props: {
        isStreaming: true,
        statusEvents: [{ ...stalledEvent(95_000), silentMs: 90_000 }],
      },
    });

    expect(screen.getByTestId('stalled-message').textContent).toBe('No model activity for 1m 35s');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(screen.getByTestId('stalled-message').textContent).toBe('No model activity for 1m 37s');
  });

  it('announces the stall once via a static live region, keeping the ticking duration non-live', async () => {
    // The visible label updates every second; if it lived in an aria-live
    // region, assistive tech would re-announce it for the entire stall.
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), statusEvents: [stalledEvent(95_000)] },
    });

    const announcement = screen.getByTestId('stalled-announcement');
    expect(announcement.getAttribute('role')).toBe('status');
    const announcedText = announcement.textContent;
    expect(announcedText).toBe('No model activity detected. You can retry or cancel the response.');

    const message = screen.getByTestId('stalled-message');
    expect(message.getAttribute('aria-live')).toBeNull();
    expect(message.getAttribute('role')).toBeNull();
    expect(message.closest('[aria-live]')).toBeNull();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(announcement.textContent).toBe(announcedText);
    expect(message.textContent).toBe('No model activity for 8s');
  });

  it('dispatches the stop action when Cancel is clicked', async () => {
    const onStop = vi.fn();
    render(StreamingStatus, {
      props: {
        isStreaming: true,
        onStop,
        statusEvents: [stalledEvent(1_000)],
      },
    });

    await fireEvent.click(screen.getByTestId('stalled-cancel'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('renders the Retry button in the stalled row and invokes the callback on click', async () => {
    const onStalledRetry = vi.fn();
    render(StreamingStatus, {
      props: {
        isStreaming: true,
        onStop: vi.fn(),
        onStalledRetry,
        statusEvents: [stalledEvent(1_000)],
      },
    });

    await fireEvent.click(screen.getByTestId('stalled-retry'));
    expect(onStalledRetry).toHaveBeenCalledOnce();
  });

  it('omits the Retry button when no onStalledRetry callback is provided', () => {
    render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), statusEvents: [stalledEvent(1_000)] },
    });

    expect(screen.queryByTestId('stalled-retry')).toBeNull();
  });

  it('does not render the Retry button outside the stalled state', () => {
    const { container } = render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), onStalledRetry: vi.fn(), statusEvents: [] },
    });

    expect(container.querySelector('[data-stream-stalled="true"]')).toBeNull();
    expect(screen.queryByTestId('stalled-retry')).toBeNull();
  });

  it('clears on a resumed event and falls back to the thinking indicator', async () => {
    const events: StatusEvent[] = [stalledEvent(1_000)];
    const { container, rerender } = render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), statusEvents: events },
    });

    expect(container.querySelector('[data-stream-stalled="true"]')).toBeTruthy();

    await rerender({
      isStreaming: true,
      onStop: vi.fn(),
      statusEvents: [
        ...events,
        { phase: 'resumed', message: 'Model activity resumed', level: 'info', timestamp: 2_000 },
      ],
    });

    await waitFor(() => expect(container.querySelector('[data-stream-stalled="true"]')).toBeNull());
    expect(screen.getByTestId('streaming-status-thinking')).toBeTruthy();
  });

  it('clears when a new stream delta arrives after the stalled event', async () => {
    const events: StatusEvent[] = [stalledEvent(1_000)];
    const { container, rerender } = render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), statusEvents: events, lastChunkTime: 500 },
    });

    expect(container.querySelector('[data-stream-stalled="true"]')).toBeTruthy();

    await rerender({
      isStreaming: true,
      onStop: vi.fn(),
      statusEvents: events,
      lastChunkTime: 2_000,
    });

    await waitFor(() => expect(container.querySelector('[data-stream-stalled="true"]')).toBeNull());
    expect(screen.getByTestId('streaming-status-thinking')).toBeTruthy();
  });

  it('never leaks the stalled message into the returning thinking indicator after a delta clears it', async () => {
    // A stream delta clears the stall via lastChunkTime without appending a
    // new status event, so the stalled event stays the newest entry — the
    // thinking indicator must fall back to the last non-stalled lifecycle
    // message instead of showing stale "No model activity…" copy.
    const events: StatusEvent[] = [
      { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 500 },
      stalledEvent(1_000),
    ];
    const { container, rerender } = render(StreamingStatus, {
      props: { isStreaming: true, onStop: vi.fn(), statusEvents: events, lastChunkTime: 600 },
    });

    expect(container.querySelector('[data-stream-stalled="true"]')).toBeTruthy();

    await rerender({
      isStreaming: true,
      onStop: vi.fn(),
      statusEvents: events,
      lastChunkTime: 2_000,
    });

    await waitFor(() => expect(container.querySelector('[data-stream-stalled="true"]')).toBeNull());
    expect(screen.getByTestId('streaming-status-phase').textContent).toBe('Streaming response…');
    expect(screen.getByTestId('streaming-status-phase').textContent).not.toContain(
      'No model activity',
    );
    expect(
      container.querySelector('[data-slot="intent-mark-loader"]')?.getAttribute('data-variant'),
    ).toBe('bloom');
  });

  it('does not render the stalled row once the turn has ended or failed', () => {
    const events: StatusEvent[] = [stalledEvent(1_000)];
    const idle = render(StreamingStatus, {
      props: { isStreaming: false, isProcessing: false, statusEvents: events },
    });
    expect(idle.container.querySelector('[data-stream-stalled="true"]')).toBeNull();
    cleanup();

    const failed = render(StreamingStatus, {
      props: { isStreaming: true, error: 'Stream timeout', statusEvents: events },
    });
    expect(failed.container.querySelector('[data-stream-stalled="true"]')).toBeNull();
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
  });

  it('omits the Cancel button when no onStop handler is provided', () => {
    const { container } = render(StreamingStatus, {
      props: { isStreaming: true, statusEvents: [stalledEvent(1_000)] },
    });

    expect(container.querySelector('[data-stream-stalled="true"]')).toBeTruthy();
    expect(screen.queryByTestId('stalled-cancel')).toBeNull();
  });
});

describe('StreamingStatus utilities', () => {
  describe('latestMeaningfulStatusMessage', () => {
    it('selects the latest localized non-empty phase by timestamp', () => {
      expect(
        latestMeaningfulStatusMessage([
          { phase: 'streaming', message: '  Streaming response… ', level: 'info', timestamp: 30 },
          { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 20 },
          { phase: 'missing', message: '   ', level: 'info', timestamp: 40 },
        ]),
      ).toBe('Streaming response…');
    });

    it('returns null when no phase has display text', () => {
      expect(latestMeaningfulStatusMessage([])).toBeNull();
      expect(
        latestMeaningfulStatusMessage([
          { phase: 'missing', message: '', level: 'info', timestamp: 10 },
        ]),
      ).toBeNull();
    });
  });

  describe('formatDuration', () => {
    it('formats sub-10s with non-zero decimal', () => {
      expect(formatDuration(2300)).toBe('2.3s');
      expect(formatDuration(5700)).toBe('5.7s');
      expect(formatDuration(100)).toBe('0.1s');
    });

    it('formats sub-10s with zero decimal as whole number', () => {
      expect(formatDuration(2000)).toBe('2s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(0)).toBe('0s');
    });

    it('formats >=10s as whole number', () => {
      expect(formatDuration(10000)).toBe('10s');
      expect(formatDuration(15400)).toBe('15s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('formats minutes correctly', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(120000)).toBe('2m 0s');
      expect(formatDuration(3540000)).toBe('59m 0s');
    });

    it('formats hours correctly', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s');
      expect(formatDuration(3661000)).toBe('1h 1m 1s');
      expect(formatDuration(7322000)).toBe('2h 2m 2s');
    });
  });

  describe('formatElapsed', () => {
    it('clamps sub-second values to 1s (never "0s" or "0.Xs")', () => {
      expect(formatElapsed(0)).toBe('1s');
      expect(formatElapsed(100)).toBe('1s');
      expect(formatElapsed(400)).toBe('1s');
      expect(formatElapsed(999)).toBe('1s');
    });

    it('rounds to the nearest whole second (never a decimal)', () => {
      expect(formatElapsed(1400)).toBe('1s');
      expect(formatElapsed(1500)).toBe('2s');
      expect(formatElapsed(2300)).toBe('2s');
      expect(formatElapsed(5700)).toBe('6s');
      expect(formatElapsed(9999)).toBe('10s');
    });

    it('passes through to m/h formatting above 60s', () => {
      expect(formatElapsed(59400)).toBe('59s');
      expect(formatElapsed(60000)).toBe('1m 0s');
      expect(formatElapsed(90499)).toBe('1m 30s');
      expect(formatElapsed(3661000)).toBe('1h 1m 1s');
    });
  });

  describe('getActiveStalledEvent', () => {
    const stalled: StatusEvent = {
      phase: STALLED_PHASE,
      message: 'No model activity for 90s',
      level: 'warn',
      timestamp: 5_000,
    };

    it('returns the stalled event when it is the newest status event', () => {
      expect(getActiveStalledEvent([stalled], null)).toBe(stalled);
      expect(
        getActiveStalledEvent(
          [{ phase: 'streaming', message: 'Streaming…', level: 'info', timestamp: 1_000 }, stalled],
          null,
        ),
      ).toBe(stalled);
    });

    it('returns null when a later event supersedes the stall (e.g. resumed)', () => {
      expect(
        getActiveStalledEvent(
          [stalled, { phase: 'resumed', message: 'Resumed', level: 'info', timestamp: 6_000 }],
          null,
        ),
      ).toBeNull();
    });

    it('returns null when a stream delta arrived after the stall', () => {
      expect(getActiveStalledEvent([stalled], 6_000)).toBeNull();
      expect(getActiveStalledEvent([stalled], 4_000)).toBe(stalled);
    });

    it('returns null when there are no events or the latest is not stalled', () => {
      expect(getActiveStalledEvent([], null)).toBeNull();
      expect(
        getActiveStalledEvent(
          [{ phase: 'streaming', message: 'Streaming…', level: 'info', timestamp: 9_000 }],
          null,
        ),
      ).toBeNull();
    });

    it('re-triggers on a second stall in the same turn (newer stalled after delta)', () => {
      const second: StatusEvent = { ...stalled, timestamp: 20_000 };
      expect(getActiveStalledEvent([stalled, second], 10_000)).toBe(second);
    });
  });

  describe('getLatestThinkingStatusEvent', () => {
    const stalled: StatusEvent = {
      phase: STALLED_PHASE,
      message: 'No model activity for 90s',
      level: 'warn',
      timestamp: 5_000,
    };
    const streaming: StatusEvent = {
      phase: 'streaming',
      message: 'Streaming response…',
      level: 'info',
      timestamp: 1_000,
    };

    it('skips stalled events and returns the newest non-stalled event', () => {
      expect(getLatestThinkingStatusEvent([streaming, stalled])).toBe(streaming);
      expect(getLatestThinkingStatusEvent([stalled, streaming])).toBe(streaming);
    });

    it('returns null when only stalled events exist or the list is empty', () => {
      expect(getLatestThinkingStatusEvent([stalled])).toBeNull();
      expect(getLatestThinkingStatusEvent([])).toBeNull();
    });

    it('matches getLatestStatusEvent semantics when no stalled event is present', () => {
      const later: StatusEvent = { ...streaming, phase: 'tool-call', timestamp: 2_000 };
      expect(getLatestThinkingStatusEvent([streaming, later])).toBe(later);
    });
  });

  describe('deriveErrorDisplay', () => {
    it('returns null when there is no error', () => {
      expect(deriveErrorDisplay(null)).toBeNull();
      expect(deriveErrorDisplay(undefined)).toBeNull();
      expect(deriveErrorDisplay('', true)).toBeNull();
    });

    it('maps an ordinary error to the pre-existing rendering (flag absent or false)', () => {
      const expected = {
        corrupted: false,
        title: 'Response failed',
        message: 'Spawn timeout',
        detail: null,
      };
      expect(deriveErrorDisplay('Spawn timeout')).toEqual(expected);
      expect(deriveErrorDisplay('Spawn timeout', false)).toEqual(expected);
      expect(deriveErrorDisplay('Spawn timeout', undefined)).toEqual(expected);
    });

    it('maps a corrupted-session error to recreate-aware copy with the raw error as detail', () => {
      expect(deriveErrorDisplay('JSON-RPC error -32603: invalid argument', true)).toEqual({
        corrupted: true,
        title: SESSION_CORRUPTED.title,
        message: SESSION_CORRUPTED.message,
        detail: 'JSON-RPC error -32603: invalid argument',
      });
    });
  });

  describe('computeCompletedEvents', () => {
    const makeEvent = (
      phase: string,
      message: string,
      timestamp: number,
      level: 'info' | 'warn' | 'error' = 'info',
    ) => ({ phase, message, level, timestamp });

    it('returns empty for no events', () => {
      expect(computeCompletedEvents([], false, Date.now())).toEqual([]);
      expect(computeCompletedEvents([], true, Date.now())).toEqual([]);
    });

    it('returns empty for single event in pre-chunk mode (latest excluded)', () => {
      const events = [makeEvent('launch', 'Launching…', 1000)];
      expect(computeCompletedEvents(events, false, 5000)).toEqual([]);
    });

    it('returns single event in post-chunk mode (latest included)', () => {
      const events = [makeEvent('launch', 'Launching…', 1000)];
      const result = computeCompletedEvents(events, true, 3000);
      expect(result).toHaveLength(1);
      expect(result[0].event.message).toBe('Launching…');
      expect(result[0].duration).toBe('2s');
    });

    it('computes durations between consecutive events', () => {
      const events = [
        makeEvent('launch', 'Launching…', 1000),
        makeEvent('init', 'Initializing…', 3500),
        makeEvent('prompt', 'Sent prompt…', 5000),
      ];
      // Pre-chunk mode: exclude latest (prompt), show launch and init
      const result = computeCompletedEvents(events, false, 8000);
      expect(result).toHaveLength(2);
      // Reversed order (newest first)
      expect(result[0].event.message).toBe('Initializing…');
      expect(result[0].duration).toBe('1.5s');
      expect(result[1].event.message).toBe('Launching…');
      expect(result[1].duration).toBe('2.5s');
    });

    it('uses fallbackEndTime for last event in post-chunk mode', () => {
      const events = [
        makeEvent('launch', 'Launching…', 1000),
        makeEvent('prompt', 'Sent prompt…', 3000),
      ];
      const result = computeCompletedEvents(events, true, 15000);
      expect(result).toHaveLength(2);
      // Last event duration uses fallbackEndTime
      expect(result[0].event.message).toBe('Sent prompt…');
      expect(result[0].duration).toBe('12s'); // 15000 - 3000
    });

    it('preserves warn/error levels', () => {
      const events = [
        makeEvent('mcp-init', 'Waiting…', 1000),
        makeEvent('mcp-error', 'MCP failed', 3000, 'warn'),
        makeEvent('prompt', 'Sent prompt…', 4000),
      ];
      const result = computeCompletedEvents(events, false, 6000);
      expect(result[0].event.level).toBe('warn');
    });
  });

  describe('shouldAppendStreamingEvent', () => {
    const makeEvent = (
      phase: string,
      timestamp = 1000,
      level: 'info' | 'warn' | 'error' = 'info',
    ): StatusEvent => ({ phase, message: `${phase} msg`, level, timestamp });

    it('returns true on first chunk with status events, no streaming event, no tool phase', () => {
      const events = [makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns false when receivedFirstChunk is already true (not first chunk)', () => {
      const events = [makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(true, events)).toBe(false);
    });

    it('returns false when statusEvents is empty', () => {
      expect(shouldAppendStreamingEvent(false, [])).toBe(false);
    });

    it('returns false when latest event is already streaming (consecutive dedup)', () => {
      const events = [makeEvent('prompt'), makeEvent('streaming')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(false);
    });

    it('returns true when latest event has phase tool-call (transition allowed)', () => {
      const events = [makeEvent('prompt'), makeEvent('tool-call')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true when latest event has phase tool-waiting (transition allowed)', () => {
      const events = [makeEvent('prompt'), makeEvent('tool-waiting')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true when latest event has phase prompt (non-tool phase)', () => {
      const events = [makeEvent('launch'), makeEvent('prompt')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('returns true even when earlier events contain streaming (only latest matters)', () => {
      const events = [makeEvent('streaming'), makeEvent('tool-call')];
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });
  });

  describe('tool→streaming lifecycle (state transitions)', () => {
    it('full lifecycle: streaming → tool-call → tool-waiting → streaming again', () => {
      // Phase 1: Initial text chunk (receivedFirstChunk=false, has prompt event)
      const initialEvents: StatusEvent[] = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
      ];
      expect(shouldAppendStreamingEvent(false, initialEvents)).toBe(true);
      // After first chunk: receivedFirstChunk=true, events include streaming

      // Phase 2: More text chunks (receivedFirstChunk=true) — no more streaming events
      const afterFirstChunk: StatusEvent[] = [
        ...initialEvents,
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 },
      ];
      expect(shouldAppendStreamingEvent(true, afterFirstChunk)).toBe(false);

      // Phase 3: Tool-call arrives — receivedFirstChunk reset to false by status handler
      const afterToolCall: StatusEvent[] = [
        ...afterFirstChunk,
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 3000 },
      ];
      // receivedFirstChunk is now false (reset by status handler)
      expect(shouldAppendStreamingEvent(false, afterToolCall)).toBe(true);

      // Phase 4: Tool-waiting arrives — receivedFirstChunk stays false
      const afterToolWaiting: StatusEvent[] = [
        ...afterToolCall,
        {
          phase: 'tool-waiting',
          message: 'Awaiting tool response',
          level: 'info',
          timestamp: 4000,
        },
      ];
      expect(shouldAppendStreamingEvent(false, afterToolWaiting)).toBe(true);

      // Phase 5: Text resumes after tool — streaming event appended
      const afterToolComplete: StatusEvent[] = [
        ...afterToolWaiting,
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 5000 },
      ];
      // After this chunk: receivedFirstChunk=true again
      expect(shouldAppendStreamingEvent(true, afterToolComplete)).toBe(false);
    });

    it('multiple tool cycles produce correct streaming transitions', () => {
      const events: StatusEvent[] = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 },
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 3000 },
        {
          phase: 'tool-waiting',
          message: 'Awaiting tool response',
          level: 'info',
          timestamp: 4000,
        },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 5000 },
        // Second tool cycle
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 6000 },
        {
          phase: 'tool-waiting',
          message: 'Awaiting tool response',
          level: 'info',
          timestamp: 7000,
        },
      ];
      // After second tool-waiting, receivedFirstChunk is false (reset by status handler)
      // Should allow streaming transition
      expect(shouldAppendStreamingEvent(false, events)).toBe(true);
    });

    it('receivedFirstChunk is NOT reset for non-tool status phases', () => {
      // Simulate: prompt status arrives while receivedFirstChunk=true
      // The status handler should NOT reset receivedFirstChunk for non-tool phases
      const events: StatusEvent[] = [
        { phase: 'prompt', message: 'Sent prompt…', level: 'info', timestamp: 1000 },
        { phase: 'streaming', message: 'Streaming response…', level: 'info', timestamp: 2000 },
      ];
      // receivedFirstChunk stays true for non-tool phases
      expect(shouldAppendStreamingEvent(true, events)).toBe(false);
    });
  });
});
