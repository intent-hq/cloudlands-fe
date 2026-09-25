/** @vitest-environment jsdom */
import {
  useEncoderEffortHarness,
  mocks,
  state,
  manager,
  flush,
  effort,
  mutations,
  ready,
} from './encoder-effort.fixture';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { setHardwareConsoleEncoderBehavior } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import { m } from '$shared/paraglide/messages.js';
import EffortPicker from '$lib/components/chat/input/EffortPicker.svelte';
import EncoderCycleHud from '../EncoderCycleHud.svelte';

useEncoderEffortHarness();

// Captured from models.list(providerId: codex) and the active agent's
// effortLevels on 2026-09-25. This is ascending provider evidence, independent
// of stepEncoderEffort and the harness's symbolic turn helper.
const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

describe.each(['codex-micro', 'creator-micro-2'] as const)('%s raw encoder routing', (model) => {
  it.each([
    {
      key: 'ENC_CW',
      expected: 'xhigh',
      gauge: '3',
      label: () => m.chat_effortPicker_level_xhigh(),
    },
    {
      key: 'ENC_CC',
      expected: 'medium',
      gauge: '1',
      label: () => m.chat_effortPicker_level_medium(),
    },
  ])(
    'routes $key to $expected through the real decoder, writer, feedback and gauge',
    async ({ key, expected, gauge, label }) => {
      ready();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high', effortLevels: levels }));
      render(EncoderCycleHud);
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager(model);
      // Vendor channel-2 shape, not a predecoded direction. The protocol source
      // calls ENC_CW clockwise and ENC_CC counter-clockwise; this simulation
      // does not establish what an unobserved physical unit actually emits.
      device.emit({ m: 'v.oai.hid', p: { k: key, act: 2 } });
      await flush();
      expect(mutations()).toEqual([
        [
          'agent.update',
          { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: expected } },
        ],
      ]);
      expect(effort()).toBe(expected);
      expect(effort('agent-2')).toBeNull();
      expect(effort('agent-3')).toBeNull();
      expect(screen.getByRole('status').textContent).toContain(label());
      expect(screen.getByTestId('effort-gauge').getAttribute('data-gauge-value')).toBe(gauge);
      expect(device.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { current: null, key: 'ENC_CC', reverse: 'ENC_CW', next: 'low' },
    { current: 'ultra', key: 'ENC_CW', reverse: 'ENC_CC', next: 'max' },
  ])(
    'clamps $key at $current and accepts the reverse detent',
    async ({ current, key, reverse, next }) => {
      ready();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: current, effortLevels: levels }));
      const device = manager(model);
      device.emit({ m: 'v.oai.hid', p: { k: key, act: 2 } });
      await flush();
      expect(mutations()).toHaveLength(0);
      expect(effort()).toBe(current);
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      device.emit({ m: 'v.oai.hid', p: { k: reverse, act: 2 } });
      await flush();
      expect(effort()).toBe(next);
      expect(mutations()).toHaveLength(1);
    },
  );

  it('preserves workspace ordering, boundaries, and encoder presses after opting out', async () => {
    ready();
    mocks.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
    const device = manager(model);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(device.navigate).toHaveBeenLastCalledWith('/workspace/ws-2');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(device.navigate).toHaveBeenCalledTimes(1);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } });
    expect(device.navigate).toHaveBeenLastCalledWith('/workspace/ws-1');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(state.sidebarNav.panelItem).toBe('all-workspaces');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } });
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(state.sidebarNav.allSpacesViewMode).toBe('repo');
    await flush();
    expect(mutations()).toHaveLength(0);
  });
});
