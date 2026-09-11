/**
 * Wiring tests for the dev-only switch-timing observer saga: t=0 triggers open
 * a record, gate actions mark it, and the reveal condition (hydration settled
 * + transcript snapshot gate clear) finalizes exactly one consolidated summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

import {
  chatLiveStreamPhaseChanged,
  initializeChatRequested,
  transcriptHydrationSettled,
  transcriptHydrationStarted,
} from '../chat-state-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import {
  setSubscriptionSnapshot,
  subscriptionSnapshotFetchFailed,
} from '../../agent-subscription-ui/agent-subscription-ui-slice';
import { backgroundHooksUpdated } from '../../background-hooks/background-hooks-slice';
import {
  finalizeAgentView,
  hasOpenAgentView,
  resetSwitchTiming,
} from '../../../utils/switch-timing';
import { switchTimingSaga } from './switch-timing-saga';

const AGENT = 'agent-timing';
const WS = 'ws-timing';

type ChatAgentTestState = {
  transcriptHydration?: 'loading' | 'settled';
  awaitingSwitchBackSnapshot?: boolean;
};

function harness(chatAgentState: () => ChatAgentTestState) {
  const channel = stdChannel();
  const getState = () => ({
    chatState: { byAgentId: { [AGENT]: chatAgentState() } },
    agentSessions: { byAgentId: { [AGENT]: { workspaceId: WS } } },
  });
  const task = runSaga({ channel, dispatch: () => {}, getState }, switchTimingSaga);
  return { channel, task };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('switchTimingSaga', () => {
  beforeEach(() => resetSwitchTiming());
  afterEach(() => {
    resetSwitchTiming();
    vi.restoreAllMocks();
  });

  it('opens a record at initializeChatRequested and finalizes when transcript hydration settles', async () => {
    const state: ChatAgentTestState = {
      transcriptHydration: 'loading',
    };
    const run = harness(() => state);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(true);

    run.channel.put(transcriptHydrationStarted(AGENT));
    state.transcriptHydration = 'settled';
    run.channel.put(transcriptHydrationSettled(AGENT));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const line = String(debugSpy.mock.calls[0][0]);
    expect(line).toContain(`workspace-switch ${AGENT} revealed`);

    run.task.cancel();
  });

  it('finalizes immediately on markAgentAsViewed when the reveal condition already holds', async () => {
    const run = harness(() => ({ transcriptHydration: 'settled' }));
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(markAgentAsViewed(AGENT));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);

    run.task.cancel();
  });

  it('records live-stream phase transitions as first-occurrence gates', async () => {
    const state: ChatAgentTestState = { transcriptHydration: 'loading' };
    const run = harness(() => state);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(chatLiveStreamPhaseChanged(AGENT, 'connecting'));
    run.channel.put(chatLiveStreamPhaseChanged(AGENT, 'awaiting-snapshot'));
    run.channel.put(chatLiveStreamPhaseChanged(AGENT, 'live'));
    state.transcriptHydration = 'settled';
    run.channel.put(transcriptHydrationSettled(AGENT));
    await settle();

    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const data = debugSpy.mock.calls[0][1] as { gates: Record<string, number> };
    expect(data.gates).toHaveProperty('phaseConnecting');
    expect(data.gates).toHaveProperty('phaseAwaitingSnapshot');
    expect(data.gates).toHaveProperty('phaseLive');

    run.task.cancel();
  });

  it('discards the open record when the live stream phase drops to null', async () => {
    const run = harness(() => ({ transcriptHydration: 'loading' }));

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(true);

    run.channel.put(chatLiveStreamPhaseChanged(AGENT, null));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(finalizeAgentView(AGENT)).toBeNull();

    run.task.cancel();
  });

  it('records a subscription snapshot without making reveal wait for it', async () => {
    const state: ChatAgentTestState = {
      transcriptHydration: 'loading',
    };
    const run = harness(() => state);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      }),
    );
    state.transcriptHydration = 'settled';
    run.channel.put(transcriptHydrationSettled(AGENT));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const data = debugSpy.mock.calls[0][1] as { gates: Record<string, number> };
    expect(data.gates).toHaveProperty('subscriptionsFetched');

    run.task.cancel();
  });

  it('records a subscription fetch failure without making reveal wait for it', async () => {
    const state: ChatAgentTestState = {
      transcriptHydration: 'loading',
    };
    const run = harness(() => state);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(subscriptionSnapshotFetchFailed(WS, AGENT));
    state.transcriptHydration = 'settled';
    run.channel.put(transcriptHydrationSettled(AGENT));
    await settle();
    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);

    run.task.cancel();
  });

  it('records workspace seed deltas into the finalized summary', async () => {
    const state: ChatAgentTestState = { transcriptHydration: 'loading' };
    const run = harness(() => state);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();
    run.channel.put(backgroundHooksUpdated(WS, []));
    state.transcriptHydration = 'settled';
    run.channel.put(transcriptHydrationSettled(AGENT));
    await settle();

    expect(hasOpenAgentView(AGENT)).toBe(false);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    const data = debugSpy.mock.calls[0][1] as { seeds: Record<string, number> };
    expect(data.seeds).toHaveProperty('hooksSeedDelivered');

    run.task.cancel();
  });
});
