/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

import LiveStreamPhaseIndicator from '../LiveStreamPhaseIndicator.svelte';
import {
  LIVE_STREAM_PHASE_GRACE_MS,
  isPreLivePhase,
  liveStreamPhaseMessage,
  shouldShowLiveStreamPhaseIndicator,
} from '../live-stream-phase';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const indicator = () => screen.queryByTestId('live-stream-phase-indicator');

async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await tick();
}

describe('live-stream-phase utils', () => {
  it('isPreLivePhase covers exactly the four pre-live phases', () => {
    expect(isPreLivePhase('connecting')).toBe(true);
    expect(isPreLivePhase('awaiting-snapshot')).toBe(true);
    expect(isPreLivePhase('resyncing')).toBe(true);
    expect(isPreLivePhase('delayed')).toBe(true);
    expect(isPreLivePhase('live')).toBe(false);
    expect(isPreLivePhase(null)).toBe(false);
  });

  it('shouldShowLiveStreamPhaseIndicator gates on turn-in-flight AND a pre-live phase', () => {
    expect(
      shouldShowLiveStreamPhaseIndicator({ phase: 'connecting', turnInFlight: true }),
    ).toBe(true);
    // Idle agent: never show, whatever the phase.
    expect(
      shouldShowLiveStreamPhaseIndicator({ phase: 'connecting', turnInFlight: false }),
    ).toBe(false);
    expect(shouldShowLiveStreamPhaseIndicator({ phase: 'delayed', turnInFlight: false })).toBe(
      false,
    );
    // Hydrated or torn-down stream: never show, even mid-turn.
    expect(shouldShowLiveStreamPhaseIndicator({ phase: 'live', turnInFlight: true })).toBe(false);
    expect(shouldShowLiveStreamPhaseIndicator({ phase: null, turnInFlight: true })).toBe(false);
  });

  it('liveStreamPhaseMessage maps each pre-live phase to its staged copy', () => {
    expect(liveStreamPhaseMessage('connecting')).toBe('Connecting live stream...');
    expect(liveStreamPhaseMessage('awaiting-snapshot')).toBe('Reticulating splines...');
    expect(liveStreamPhaseMessage('resyncing')).toBe('Re-syncing live stream...');
    expect(liveStreamPhaseMessage('delayed')).toBe('Live updates delayed — retrying...');
  });
});

describe('LiveStreamPhaseIndicator (500ms grace + visibility gating)', () => {
  it('renders nothing before the grace period elapses, then shows the staged copy', async () => {
    render(LiveStreamPhaseIndicator, {
      props: { phase: 'connecting', turnInFlight: true },
    });
    await tick();
    expect(indicator()).toBeNull();

    await advance(LIVE_STREAM_PHASE_GRACE_MS - 1);
    expect(indicator()).toBeNull();

    await advance(1);
    expect(indicator()).not.toBeNull();
    expect(screen.getByTestId('live-stream-phase-message').textContent).toBe(
      'Connecting live stream...',
    );
  });

  it('renders nothing when the snapshot arrives within the grace period (no flash)', async () => {
    const { rerender } = render(LiveStreamPhaseIndicator, {
      props: { phase: 'connecting', turnInFlight: true },
    });
    await advance(200);
    await rerender({ phase: 'live', turnInFlight: true });
    await advance(LIVE_STREAM_PHASE_GRACE_MS * 2);
    expect(indicator()).toBeNull();
  });

  it('switches copy instantly once visible (no second grace period)', async () => {
    const { rerender } = render(LiveStreamPhaseIndicator, {
      props: { phase: 'awaiting-snapshot', turnInFlight: true },
    });
    await advance(LIVE_STREAM_PHASE_GRACE_MS);
    expect(screen.getByTestId('live-stream-phase-message').textContent).toBe(
      'Reticulating splines...',
    );

    await rerender({ phase: 'resyncing', turnInFlight: true });
    expect(screen.getByTestId('live-stream-phase-message').textContent).toBe(
      'Re-syncing live stream...',
    );
    await rerender({ phase: 'delayed', turnInFlight: true });
    expect(screen.getByTestId('live-stream-phase-message').textContent).toBe(
      'Live updates delayed — retrying...',
    );
  });

  it('hides as soon as the phase reaches live or the turn ends', async () => {
    const { rerender } = render(LiveStreamPhaseIndicator, {
      props: { phase: 'connecting', turnInFlight: true },
    });
    await advance(LIVE_STREAM_PHASE_GRACE_MS);
    expect(indicator()).not.toBeNull();

    await rerender({ phase: 'live', turnInFlight: true });
    await advance(500);
    expect(indicator()).toBeNull();

    // Re-eligibility restarts the grace period from zero.
    await rerender({ phase: 'resyncing', turnInFlight: true });
    await advance(LIVE_STREAM_PHASE_GRACE_MS - 1);
    expect(indicator()).toBeNull();
    await advance(1);
    expect(indicator()).not.toBeNull();

    // Turn end hides immediately.
    await rerender({ phase: 'resyncing', turnInFlight: false });
    await advance(500);
    expect(indicator()).toBeNull();
  });

  it('never renders for an idle agent, regardless of phase persistence', async () => {
    render(LiveStreamPhaseIndicator, {
      props: { phase: 'delayed', turnInFlight: false },
    });
    await advance(LIVE_STREAM_PHASE_GRACE_MS * 4);
    expect(indicator()).toBeNull();
  });
});
