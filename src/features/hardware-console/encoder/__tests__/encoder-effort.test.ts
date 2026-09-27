/** @vitest-environment jsdom */
import { initialState as principalInitialState } from '$store/renderer/slices/principal/principal-slice';
import {
  useEncoderEffortHarness,
  mocks,
  request,
  tasks,
  listeners,
  state,
  bag,
  publish,
  start,
  manager,
  deferred,
  flush,
  effort,
  mutations,
  reply,
  ready,
} from './encoder-effort.fixture';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { getItem, updateItem } from '@augmentcode/themis/utils/collections/collection-utils';
import type { HardwareDeviceModel } from '../../input/types';
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { applyReasoningEffort } from '$features/agent/reasoning-effort';
import {
  hydrateHardwareConsoleEncoderBehavior,
  setHardwareConsoleEncoderBehavior,
  consoleOwnerChanged,
} from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { encoderPreferenceSaga } from '$store/renderer/slices/hardware-console/sagas/encoder-preference-saga';
import { selectEncoderEffortFeedback } from '$store/renderer/slices/hardware-console/hardware-console-selectors';
import { ENCODER_HUD_HIDE_MS } from '../encoder-service';
import EncoderCycleHud from '../EncoderCycleHud.svelte';
import EffortPicker from '$lib/components/chat/input/EffortPicker.svelte';

useEncoderEffortHarness();

describe('decoded Micro encoder effort and wire behavior', () => {
  it.each<HardwareDeviceModel>(['codex-micro', 'creator-micro-2'])(
    'defaults %s to effort after successful missing-preference hydration',
    async (model) => {
      const device = manager(model);
      start(encoderPreferenceSaga);
      device.turn();
      expect(mutations()).toHaveLength(0);
      expect(device.navigate).not.toHaveBeenCalled();
      await flush();
      device.turn();
      await flush();
      expect(mutations()).toEqual([
        [
          'agent.update',
          { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: 'low' } },
        ],
      ]);
      expect(effort()).toBe('low');
      expect(effort('agent-2')).toBeNull();
      expect(effort('agent-3')).toBeNull();
      expect(device.navigate).not.toHaveBeenCalled();
    },
  );

  it('suppresses rotation through a failed startup read and resumes the recovered opt-out', async () => {
    bag.encoderBehavior = 'workspace-switch';
    request.mockRejectedValueOnce(new Error('daemon unavailable'));
    const device = manager();
    start(encoderPreferenceSaga);
    await flush();
    device.turn();
    expect(state.hardwareConsole.encoderBehaviorHydrated).toBe(false);
    expect(mutations()).toHaveLength(0);
    expect(device.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(state.hardwareConsole.encoderBehavior).toBe('workspace-switch');
    expect(device.navigate).toHaveBeenCalledExactlyOnceWith('/workspace/ws-2');
    expect(mutations()).toHaveLength(0);
    mocks.dispatch(setHardwareConsoleEncoderBehavior('agent-effort'));
    device.turn();
    await flush();
    expect(effort()).toBe('low');
  });

  it('follows advertised order and clamps both endpoints, including explicit Auto null', async () => {
    ready();
    const device = manager();
    device.turn('ccw');
    await flush();
    expect(mutations()).toHaveLength(0);
    for (let n = 0; n < 5; n++) {
      device.turn();
      await flush();
    }
    expect(mutations().map(([, params]) => (params as { changes: unknown }).changes)).toEqual([
      { reasoningEffort: 'low' },
      { reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
    ]);
    for (let n = 0; n < 5; n++) {
      device.turn('ccw');
      await flush();
    }
    expect(effort()).toBeNull();
    expect(mutations()).toHaveLength(6);
    expect(mutations().at(-1)).toEqual([
      'agent.update',
      { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: null } },
    ]);
  });

  it('uses session-discovered levels, not a hardcoded effort vocabulary', async () => {
    ready();
    mocks.dispatch(updateSession('agent-1', { effortLevels: ['off', 'turbo'] }));
    const device = manager();
    device.turn();
    await flush();
    device.turn();
    await flush();
    expect(effort()).toBe('turbo');
  });

  it.each([false, true])(
    'coalesces rapid turns without concurrent or stale saves (leading failure: %s)',
    async (fails) => {
      ready();
      const device = manager();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      device.turn();
      device.turn();
      device.turn();
      device.turn('ccw');
      device.turn();
      expect(mutations()).toHaveLength(1);
      expect(effort()).toBe('high');
      if (fails) first.reject(new Error('offline'));
      else first.resolve(reply());
      await flush();
      expect(mutations()).toHaveLength(2);
      expect(mutations().at(-1)).toEqual([
        'agent.update',
        { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: 'high' } },
      ]);
      expect(effort()).toBe('high');
    },
  );

  it('restores the last accepted effort and removes feedback if the final save fails', async () => {
    ready();
    const device = manager();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    request.mockRejectedValueOnce(new Error('final save rejected'));
    device.turn();
    device.turn();
    device.turn();
    first.resolve(reply());
    await flush();
    expect(effort()).toBe('low');
    expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
    expect(mocks.notify).toHaveBeenCalledWith('final save rejected');
    device.turn();
    await flush();
    expect(effort()).toBe('medium');
  });

  it.each(['agent', 'workspace', 'model', 'owner', 'role', 'mode'])(
    'discards queued intent when %s changes mid-save',
    async (change) => {
      ready();
      const device = manager();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      device.turn();
      device.turn();
      if (change === 'agent') state.workspaceAgents.byWorkspaceId['ws-1'].activeAgentId = 'agent-2';
      if (change === 'workspace') state.tabState.currentTabId = 'ws-2';
      if (change === 'model')
        mocks.dispatch(updateSession('agent-1', { model: 'model-b', reasoningEffort: 'ultra' }));
      if (change === 'owner') mocks.dispatch(consoleOwnerChanged(false));
      if (change === 'role')
        state.workspace.workspaces = updateItem(state.workspace.workspaces, {
          ...getItem(state.workspace.workspaces, 'ws-1')!,
          myRole: 'collaborator',
        });
      if (change === 'mode') mocks.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
      publish();
      first.resolve(reply());
      await flush();
      expect(mutations()).toHaveLength(1);
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
      if (change === 'model') expect(effort()).toBe('ultra');
      expect(effort('agent-2')).toBeNull();
      expect(effort('agent-3')).toBeNull();
    },
  );

  it.each([false, true])(
    'handles reversals back to Auto while a save is pending (failure: %s)',
    async (fails) => {
      ready();
      const device = manager();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      device.turn();
      device.turn('ccw');
      expect(effort()).toBeNull();
      if (fails) first.reject(new Error('offline'));
      else first.resolve(reply());
      await flush();
      expect(effort()).toBeNull();
      expect(mutations()).toHaveLength(fails ? 1 : 2);
      if (!fails)
        expect(mutations().at(-1)).toEqual([
          'agent.update',
          { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: null } },
        ]);
    },
  );

  it('does not let an older failed save roll back an ABA sequence', async () => {
    ready();
    const device = manager();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    device.turn();
    device.turn();
    device.turn('ccw');
    expect(effort()).toBe('low');
    first.reject(new Error('old save failed'));
    await flush();
    expect(effort()).toBe('low');
    expect(mutations()).toHaveLength(2);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('drops pending effort when another control changes the session during the save', async () => {
    ready();
    const device = manager();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    device.turn();
    device.turn();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
    first.resolve(reply());
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(1);
    expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
  });

  it.each(
    [
      { picked: null, turnAgain: false },
      { picked: null, turnAgain: true },
      { picked: 'low', turnAgain: false },
      { picked: 'low', turnAgain: true },
    ].flatMap((choice) => [false, true].map((oldAccepted) => ({ ...choice, oldAccepted }))),
  )(
    'honors an accepted explicit picker edit matching an older value ($picked, turn again: $turnAgain, old accepted: $oldAccepted)',
    async ({ picked, turnAgain, oldAccepted }) => {
      ready();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      const device = manager();
      device.turn();
      device.turn();
      expect(effort()).toBe('medium');
      const editing = applyReasoningEffort('agent-1', 'ws-1', picked, 'medium');
      expect(effort()).toBe(picked);
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
      if (turnAgain) device.turn();
      if (oldAccepted) first.resolve(reply('low'));
      else first.reject(new Error('old encoder save rejected'));
      expect(await editing).toBe(true);
      await flush();
      const expected = turnAgain ? (picked === null ? 'low' : 'medium') : picked;
      expect(effort()).toBe(expected);
      expect(
        mutations().map(
          ([, params]) =>
            (params as { changes: { reasoningEffort: string | null } }).changes.reasoningEffort,
        ),
      ).toEqual(turnAgain ? ['low', picked, expected] : ['low', picked]);
      expect(mocks.notify).not.toHaveBeenCalled();
    },
  );

  it.each(
    (['modern', 'legacy'] as const).flatMap((protocol) =>
      [false, true].flatMap((oldAccepted) =>
        ['none', 'disconnect', 'cancel'].map((stop) => ({ protocol, oldAccepted, stop })),
      ),
    ),
  )(
    'never restores canceled unsent effort after picker failure ($protocol, old accepted: $oldAccepted, stop: $stop)',
    async ({ protocol, oldAccepted, stop }) => {
      ready();
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const first = deferred<unknown>();
      const legacy = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue({
          success: true,
          data: { success: false, error: 'picker save rejected' },
        });
      if (protocol === 'legacy') {
        state.daemonHealth.stats.protocolVersion = '5.1';
        publish();
        registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
      } else {
        request.mockImplementationOnce(() => first.promise);
        request.mockRejectedValueOnce(new Error('picker save rejected'));
      }
      const device = manager(protocol === 'legacy' ? 'creator-micro-2' : 'codex-micro');
      device.turn();
      device.turn();
      const editing = applyReasoningEffort('agent-1', 'ws-1', 'high', 'medium');
      if (stop === 'disconnect') device.statusChanged('disconnected');
      if (stop === 'cancel') tasks[0].cancel();
      if (protocol === 'legacy') {
        first.resolve({
          success: true,
          data: {
            success: oldAccepted,
            modelId: 'model-a/low',
            error: 'old encoder save rejected',
          },
        });
      } else if (oldAccepted) first.resolve(reply('low'));
      else first.reject(new Error('old encoder save rejected'));
      expect(await editing).toBe(false);
      await flush();
      expect(protocol === 'legacy' ? legacy.mock.calls : mutations()).toHaveLength(2);
      expect(effort()).toBe(oldAccepted ? 'low' : null);
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
      if (oldAccepted)
        expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('0');
      else expect(screen.queryByTestId('effort-gauge')).toBeNull();
    },
  );

  it('does not discard encoder work when a picker edits another agent', async () => {
    ready();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    const device = manager();
    device.turn();
    device.turn();
    expect(await applyReasoningEffort('agent-2', 'ws-1', 'high', null)).toBe(true);
    first.resolve(reply('low'));
    await flush();
    expect(effort()).toBe('medium');
    expect(effort('agent-2')).toBe('high');
    expect(mutations()).toHaveLength(3);
  });

  it.each([false, true])(
    'keeps a later coalesced turn across a failed picker save (final accepted: %s)',
    async (accepted) => {
      ready();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      request.mockRejectedValueOnce(new Error('picker failed'));
      if (!accepted) request.mockRejectedValueOnce(new Error('latest encoder failed'));
      const device = manager();
      device.turn();
      device.turn();
      const editing = applyReasoningEffort('agent-1', 'ws-1', 'high', 'medium');
      device.turn('ccw');
      device.turn();
      first.resolve(reply('low'));
      expect(await editing).toBe(false);
      await flush();
      expect(mutations()).toHaveLength(3);
      expect(effort()).toBe(accepted ? 'high' : 'low');
      expect(mocks.notify.mock.calls).toEqual(accepted ? [] : [['latest encoder failed']]);
    },
  );

  it.each([false, true])(
    'discards only device work queued behind a picker on teardown (picker accepted: %s)',
    async (accepted) => {
      ready();
      const first = deferred<unknown>();
      const picker = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      request.mockImplementationOnce(() => picker.promise);
      const device = manager();
      device.turn();
      device.turn();
      const editing = applyReasoningEffort('agent-1', 'ws-1', 'high', 'medium');
      device.turn('ccw');
      first.resolve(reply('low'));
      await flush();
      expect(mutations()).toHaveLength(2);
      tasks[0].cancel();
      if (accepted) picker.resolve(reply('high'));
      else picker.reject(new Error('picker failed'));
      expect(await editing).toBe(accepted);
      await flush();
      expect(mutations()).toHaveLength(2);
      expect(effort()).toBe(accepted ? 'high' : 'low');
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
    },
  );

  it('starts the next detent from an independent edit instead of discarded queued intent', async () => {
    ready();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    const device = manager();
    device.turn();
    device.turn();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
    device.turn();
    first.resolve(reply('low'));
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(1);
  });

  it.each([
    { acceptsOld: false, turns: 1 },
    { acceptsOld: true, turns: 1 },
    { acceptsOld: false, turns: 2 },
    { acceptsOld: true, turns: 2 },
  ])(
    'keeps an independent edit as the new rollback baseline (old accepted: $acceptsOld, turns: $turns)',
    async ({ acceptsOld, turns }) => {
      ready();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      request.mockRejectedValueOnce(new Error('new save rejected'));
      const device = manager();
      device.turn();
      device.turn();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
      for (let n = 0; n < turns; n++) device.turn('ccw');
      if (acceptsOld) first.resolve(reply('low'));
      else first.reject(new Error('old save rejected'));
      await flush();
      expect(mutations()).toHaveLength(2);
      expect(effort()).toBe('high');
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('new save rejected');
    },
  );

  it('keeps an independent rollback baseline when a new sequence is torn down', async () => {
    ready();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    const device = manager();
    device.turn();
    device.turn();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
    device.turn('ccw');
    device.statusChanged('disconnected');
    first.reject(new Error('old save rejected'));
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(1);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('keeps trailing intent across the daemon echo of the leading save', async () => {
    ready();
    const device = manager();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    device.turn();
    device.turn();
    device.turn();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
    first.resolve(reply());
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(2);
  });

  it.each([1, 2])(
    'restores confirmed state after role loss and rejection (%s turns)',
    async (turns) => {
      ready();
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      const device = manager();
      for (let n = 0; n < turns; n++) device.turn();
      state.workspace.workspaces = updateItem(state.workspace.workspaces, {
        ...getItem(state.workspace.workspaces, 'ws-1')!,
        myRole: 'collaborator',
      });
      publish();
      first.reject(new Error('permission changed'));
      await flush();
      expect(mutations()).toHaveLength(1);
      expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
      expect(effort()).toBeNull();
      expect(screen.getByTestId('effort-picker-trigger').getAttribute('aria-label')).toBe(
        m.chat_effortPicker_trigger_ariaLabel({ level: m.chat_effortPicker_level_auto() }),
      );
      expect(screen.queryByTestId('effort-gauge')).toBeNull();
    },
  );

  it.each(['cw', 'ccw', 'none'] as const)(
    'keeps latest intent across a leading echo during the trailing save (%s)',
    async (direction) => {
      ready();
      const first = deferred<unknown>();
      const second = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      request.mockImplementationOnce(() => second.promise);
      const device = manager();
      device.turn();
      device.turn();
      device.turn();
      first.resolve(reply('low'));
      await flush();
      expect(mutations()).toHaveLength(2);
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
      if (direction !== 'none') device.turn(direction);
      second.resolve(reply('high'));
      await flush();
      expect(effort()).toBe(direction === 'ccw' ? 'medium' : 'high');
      expect(mutations()).toHaveLength(direction === 'ccw' ? 3 : 2);
    },
  );

  it('preserves independent effort edits during a trailing save', async () => {
    ready();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    request.mockImplementationOnce(() => second.promise);
    const device = manager();
    device.turn();
    device.turn();
    device.turn();
    first.resolve(reply('low'));
    await flush();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'medium' }));
    second.resolve(reply('high'));
    await flush();
    expect(effort()).toBe('medium');
    expect(mutations()).toHaveLength(2);
    expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
  });

  it('restores the last accepted value after an older echo and trailing failure', async () => {
    ready();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    request.mockImplementationOnce(() => second.promise);
    const device = manager();
    device.turn();
    device.turn();
    device.turn();
    first.resolve(reply('low'));
    await flush();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: null }));
    second.reject(new Error('trailing save rejected'));
    await flush();
    expect(effort()).toBe('low');
    expect(mutations()).toHaveLength(2);
    expect(selectEncoderEffortFeedback.select(state as never)).toBeNull();
  });

  it('recognizes an echo older than the immediately previous accepted save', async () => {
    ready();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    request.mockImplementationOnce(() => second.promise);
    request.mockImplementationOnce(() => third.promise);
    const device = manager();
    device.turn();
    device.turn();
    first.resolve(reply('low'));
    await flush();
    device.turn();
    second.resolve(reply('medium'));
    await flush();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
    device.turn();
    third.resolve(reply('high'));
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(3);
  });

  it('restores confirmed state on teardown after an old echo during a trailing save', async () => {
    ready();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    request.mockImplementationOnce(() => second.promise);
    const device = manager();
    device.turn();
    device.turn();
    device.turn();
    first.resolve(reply('low'));
    await flush();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: null }));
    device.statusChanged('disconnected');
    expect(effort()).toBe('low');
    second.reject(new Error('late rejection'));
    await flush();
    expect(effort()).toBe('low');
    expect(mutations()).toHaveLength(2);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('captures the new selected agent while an old-agent save is pending', async () => {
    ready();
    const device = manager();
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    device.turn();
    state.workspaceAgents.byWorkspaceId['ws-1'].activeAgentId = 'agent-2';
    publish();
    device.turn();
    first.resolve(reply());
    await flush();
    expect(mutations().at(-1)).toEqual([
      'agent.update',
      { agentId: 'agent-2', workspaceId: 'ws-1', changes: { reasoningEffort: 'low' } },
    ]);
    expect(effort()).toBe('low');
    expect(effort('agent-2')).toBe('low');
  });

  it.each([
    'no-workspace',
    'chief',
    'no-agent',
    'missing-session',
    'other-workspace',
    'unsupported',
    'guest-boot',
    'collaborator',
    'non-owner',
  ])('does nothing for %s', async (context) => {
    ready();
    const device = manager();
    if (context === 'no-workspace') state.tabState.currentTabId = null;
    if (context === 'chief') state.tabState.currentTabId = CHIEF_WORKSPACE_ID;
    if (context === 'no-agent') state.workspaceAgents.byWorkspaceId['ws-1'].activeAgentId = null;
    if (context === 'missing-session') delete state.agentSessions.byAgentId['agent-1'];
    if (context === 'other-workspace')
      state.agentSessions.byAgentId['agent-1'].workspaceId = 'ws-2';
    if (context === 'unsupported') state.agentSessions.byAgentId['agent-1'].model = 'no-effort';
    if (context === 'guest-boot') state.principal = principalInitialState;
    if (context === 'collaborator')
      state.workspace.workspaces = updateItem(state.workspace.workspaces, {
        ...getItem(state.workspace.workspaces, 'ws-1')!,
        myRole: 'collaborator',
      });
    if (context === 'non-owner') mocks.dispatch(consoleOwnerChanged(false));
    publish();
    device.turn();
    await flush();
    expect(mutations()).toHaveLength(0);
    expect(device.navigate).not.toHaveBeenCalled();
  });

  it('preserves legacy model-variant request and response handling', async () => {
    ready();
    state.daemonHealth.stats.protocolVersion = '5.1';
    publish();
    const legacy = vi.fn(async () => ({
      success: true,
      data: { success: true, modelId: 'model-a/low' },
    }));
    registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
    const device = manager('creator-micro-2');
    device.turn();
    await flush();
    expect(legacy).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agent-1',
      modelId: 'model-a/low',
      workspaceId: 'ws-1',
      providerId: 'codex',
    });
    expect(mutations()).toHaveLength(0);
    expect(effort()).toBe('low');
  });

  it('keeps rapid legacy turns across the leading model-variant echo', async () => {
    ready();
    state.daemonHealth.stats.protocolVersion = '5.1';
    publish();
    const first = deferred<unknown>();
    const legacy = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ success: true, data: { success: true, modelId: 'model-a/high' } });
    registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
    const device = manager('creator-micro-2');
    device.turn();
    device.turn();
    device.turn();
    mocks.dispatch(updateSession('agent-1', { model: 'model-a/low', reasoningEffort: 'low' }));
    first.resolve({ success: true, data: { success: true, modelId: 'model-a/low' } });
    await flush();
    expect(legacy).toHaveBeenCalledTimes(2);
    expect(legacy).toHaveBeenLastCalledWith({
      agentId: 'agent-1',
      modelId: 'model-a/high',
      workspaceId: 'ws-1',
      providerId: 'codex',
    });
    expect(effort()).toBe('high');
  });

  it('preserves workspace cycling and pressing without waiting for effort hydration', async () => {
    const device = manager();
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(state.sidebarNav.panelItem).toBe('all-workspaces');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(state.sidebarNav.allSpacesViewMode).toBe('repo');
    mocks.dispatch(hydrateHardwareConsoleEncoderBehavior('workspace-switch'));
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(device.navigate).toHaveBeenCalledTimes(1);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } });
    expect(device.navigate).toHaveBeenLastCalledWith('/workspace/ws-1');
    expect(mutations()).toHaveLength(0);
  });

  it.each(['modern', 'legacy'].flatMap((protocol) => [1, 2].map((turns) => ({ protocol, turns }))))(
    'keeps the accepted baseline across reconnect and a failed later turn ($protocol, $turns turns)',
    async ({ protocol, turns }) => {
      ready();
      const first = deferred<unknown>();
      const legacy = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue({ success: true, data: { success: false, error: 'new save rejected' } });
      if (protocol === 'legacy') {
        state.daemonHealth.stats.protocolVersion = '5.1';
        publish();
        registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
      } else {
        request.mockImplementationOnce(() => first.promise);
        request.mockRejectedValueOnce(new Error('new save rejected'));
      }
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager(protocol === 'legacy' ? 'creator-micro-2' : 'codex-micro');
      device.turn();
      mocks.dispatch(
        updateSession('agent-1', {
          reasoningEffort: 'low',
          ...(protocol === 'legacy' ? { model: 'model-a/low' } : {}),
        }),
      );
      device.statusChanged('disconnected');
      device.statusChanged('connected');
      for (let n = 0; n < turns; n++) device.turn();
      expect(effort()).toBe(turns === 1 ? 'low' : 'medium');
      first.resolve(
        protocol === 'legacy'
          ? { success: true, data: { success: true, modelId: 'model-a/low' } }
          : reply('low'),
      );
      await flush();
      expect(effort()).toBe('low');
      expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('0');
      expect(protocol === 'legacy' ? legacy.mock.calls : mutations()).toHaveLength(turns);
      if (turns === 2) {
        expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
        expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('new save rejected');
      } else expect(mocks.notify).not.toHaveBeenCalled();
    },
  );

  it.each(['disconnect', 'cancel'])(
    'discards reconnected unsent work on %s and releases the completed baseline',
    async (stop) => {
      ready();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      const device = manager();
      device.turn();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
      device.statusChanged('disconnected');
      device.statusChanged('connected');
      device.turn();
      device.turn();
      if (stop === 'disconnect') device.statusChanged('disconnected');
      else {
        device.dispose();
        for (const task of tasks) task.cancel();
      }
      first.resolve(reply('low'));
      await flush();
      expect(effort()).toBe('low');
      expect(mutations()).toHaveLength(1);
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(device.raw.size).toBe(0);
      if (stop === 'cancel') expect(listeners.size).toBe(0);
      expect(mocks.notify).not.toHaveBeenCalled();

      // A later sequence must use its own accepted field, not a retained queue.
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
      request.mockRejectedValueOnce(new Error('later picker rejected'));
      expect(await applyReasoningEffort('agent-1', 'ws-1', 'medium', 'high')).toBe(false);
      expect(effort()).toBe('high');
      expect(mutations()).toHaveLength(2);
    },
  );

  it.each(
    ['modern', 'legacy'].flatMap((protocol) =>
      [false, true].map((accepted) => ({ protocol, accepted })),
    ),
  )(
    'settles reconnected intent after the first write fails ($protocol, latest accepted: $accepted)',
    async ({ protocol, accepted }) => {
      ready();
      const first = deferred<unknown>();
      const legacy = vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValue({
          success: true,
          data: { success: accepted, modelId: 'model-a/medium', error: 'new save rejected' },
        });
      if (protocol === 'legacy') {
        state.daemonHealth.stats.protocolVersion = '5.1';
        publish();
        registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
      } else {
        request.mockImplementationOnce(() => first.promise);
        if (!accepted) request.mockRejectedValueOnce(new Error('new save rejected'));
      }
      const device = manager(protocol === 'legacy' ? 'creator-micro-2' : 'codex-micro');
      device.turn();
      device.statusChanged('disconnected');
      device.statusChanged('connected');
      device.turn();
      device.turn();
      if (protocol === 'legacy')
        first.resolve({ success: true, data: { success: false, error: 'old save rejected' } });
      else first.reject(new Error('old save rejected'));
      await flush();
      expect(effort()).toBe(accepted ? 'medium' : null);
      expect(protocol === 'legacy' ? legacy.mock.calls : mutations()).toHaveLength(2);
      expect(mocks.notify.mock.calls).toEqual(accepted ? [] : [['new save rejected']]);
      if (!accepted) expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
    },
  );

  it.each(['picker', 'independent', 'model', 'other-agent'])(
    'preserves a newer %s choice after reconnect while the old response is pending',
    async (edit) => {
      ready();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      const device = manager();
      device.turn();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
      device.statusChanged('disconnected');
      device.statusChanged('connected');
      device.turn();
      device.turn();
      let editing: Promise<boolean> | undefined;
      if (edit === 'picker') editing = applyReasoningEffort('agent-1', 'ws-1', 'high', 'medium');
      else if (edit === 'independent') {
        mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
        request.mockRejectedValueOnce(new Error('new save rejected'));
        device.turn('ccw');
      } else if (edit === 'model')
        mocks.dispatch(updateSession('agent-1', { model: 'model-b', reasoningEffort: 'minimal' }));
      else {
        state.workspaceAgents.byWorkspaceId['ws-1'].activeAgentId = 'agent-2';
        publish();
        device.turn();
      }
      first.resolve(reply('low'));
      if (editing) expect(await editing).toBe(true);
      await flush();
      expect(effort()).toBe(edit === 'other-agent' ? 'low' : edit === 'model' ? 'minimal' : 'high');
      expect(effort('agent-2')).toBe(edit === 'other-agent' ? 'low' : null);
      expect(mutations()).toHaveLength(edit === 'model' ? 1 : 2);
    },
  );

  it.each(
    ['modern', 'legacy'].flatMap((protocol) =>
      ['disconnect', 'cancel'].flatMap((stop) =>
        [1, 2].map((turns) => ({ protocol, stop, turns })),
      ),
    ),
  )(
    'reconciles an accepted issued write after its echo and $stop ($protocol, $turns turns)',
    async ({ protocol, stop, turns }) => {
      ready();
      const first = deferred<unknown>();
      const legacy = vi.fn(() => first.promise);
      if (protocol === 'legacy') {
        state.daemonHealth.stats.protocolVersion = '5.1';
        publish();
        registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
      } else request.mockImplementationOnce(() => first.promise);
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager(protocol === 'legacy' ? 'creator-micro-2' : 'codex-micro');
      for (let n = 0; n < turns; n++) device.turn();
      // The authoritative echo can precede the RPC response, with no later echo.
      mocks.dispatch(
        updateSession('agent-1', {
          reasoningEffort: 'low',
          ...(protocol === 'legacy' ? { model: 'model-a/low' } : {}),
        }),
      );
      if (stop === 'disconnect') device.statusChanged('disconnected');
      else {
        device.dispose();
        for (const task of tasks) task.cancel();
      }
      first.resolve(
        protocol === 'legacy'
          ? { success: true, data: { success: true, modelId: 'model-a/low' } }
          : reply('low'),
      );
      await flush();
      expect(effort()).toBe('low');
      expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('0');
      expect(protocol === 'legacy' ? legacy.mock.calls : mutations()).toHaveLength(1);
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(device.raw.size).toBe(0);
      if (stop === 'cancel') expect(listeners.size).toBe(0);
    },
  );

  it.each(
    ['disconnect', 'cancel'].flatMap((stop) =>
      ['picker', 'model', 'independent', 'other-agent'].map((edit) => ({ stop, edit })),
    ),
  )(
    'scopes accepted teardown reconciliation around a later $edit edit ($stop)',
    async ({ stop, edit }) => {
      ready();
      const first = deferred<unknown>();
      const picked = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      const device = manager();
      device.turn();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
      if (stop === 'disconnect') device.statusChanged('disconnected');
      else {
        device.dispose();
        for (const task of tasks) task.cancel();
      }
      let editing: Promise<boolean> | undefined;
      if (edit === 'picker') {
        request.mockImplementationOnce(() => picked.promise);
        editing = applyReasoningEffort('agent-1', 'ws-1', null, effort());
      } else if (edit === 'model') {
        mocks.dispatch(updateSession('agent-1', { model: 'model-b', reasoningEffort: 'minimal' }));
      } else if (edit === 'independent') {
        mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high' }));
      } else {
        state.workspaceAgents.byWorkspaceId['ws-1'].activeAgentId = 'agent-2';
        publish();
        expect(await applyReasoningEffort('agent-2', 'ws-1', 'high', null)).toBe(true);
      }
      first.resolve(reply('low'));
      await flush();
      const expected =
        edit === 'picker'
          ? null
          : edit === 'model'
            ? 'minimal'
            : edit === 'independent'
              ? 'high'
              : 'low';
      expect(effort()).toBe(expected);
      if (editing) {
        picked.resolve(reply(null));
        expect(await editing).toBe(true);
        await flush();
        expect(effort()).toBeNull();
      }
      expect(effort('agent-2')).toBe(edit === 'other-agent' ? 'high' : null);
      expect(mutations()).toHaveLength(edit === 'picker' || edit === 'other-agent' ? 2 : 1);
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(mocks.notify).not.toHaveBeenCalled();
    },
  );

  it.each(['disconnect', 'cancel'])(
    'cleans up pending work, feedback and subscriptions on %s',
    async (how) => {
      ready();
      const device = manager();
      const first = deferred<unknown>();
      request.mockImplementationOnce(() => first.promise);
      device.turn();
      device.turn();
      if (how === 'disconnect') device.statusChanged('disconnected');
      else {
        device.dispose();
        for (const task of tasks) task.cancel();
      }
      first.reject(new Error('late failure'));
      await flush();
      await vi.advanceTimersByTimeAsync(5000);
      device.turn();
      expect(mutations()).toHaveLength(1);
      expect(effort()).toBeNull();
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(device.raw.size).toBe(0);
      if (how === 'cancel') {
        expect(listeners.size).toBe(0);
        expect(device.statuses.size).toBe(0);
      }
    },
  );
});

describe('encoder feedback and existing gauge', () => {
  it('updates one live status in place with the session gauge and dismisses after inactivity', async () => {
    ready();
    render(EncoderCycleHud);
    render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
    const device = manager();
    device.turn();
    await flush();
    const status = screen.getByRole('status', { name: m.chat_effortPicker_title_label() });
    expect(status.textContent).toContain(m.chat_effortPicker_level_low());
    expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('0');
    await vi.advanceTimersByTimeAsync(700);
    device.turn();
    await flush();
    expect(screen.getByRole('status', { name: m.chat_effortPicker_title_label() })).toBe(status);
    expect(status.textContent).toContain(m.chat_effortPicker_level_medium());
    expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('1');
    await vi.advanceTimersByTimeAsync(ENCODER_HUD_HIDE_MS - 1);
    await tick();
    expect(state.hardwareConsole.encoderEffortFeedback).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('1');
  });

  it('updates the tooltip and gauge on every rapid turn while the first save is delayed', async () => {
    ready();
    render(EncoderCycleHud);
    render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
    const first = deferred<unknown>();
    request.mockImplementationOnce(() => first.promise);
    const device = manager();
    device.turn();
    await flush();
    const status = screen.getByRole('status');
    device.turn();
    device.turn();
    await flush();
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toContain(m.chat_effortPicker_level_high());
    expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('2');
    expect(mutations()).toHaveLength(1);
    first.resolve(reply());
    await flush();
    expect(effort()).toBe('high');
    expect(mutations()).toHaveLength(2);
  });

  it('rolls the gauge back and removes an unsuccessful tooltip', async () => {
    ready();
    mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'low' }));
    render(EncoderCycleHud);
    render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
    request.mockRejectedValueOnce(new Error('write refused'));
    manager().turn();
    await flush();
    expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe('0');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
