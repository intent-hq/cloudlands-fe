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
import { HardwareInputDecoder } from '../../input/input-decoder';
import type { PhysicalKnobDirection } from '../../input/types';

useEncoderEffortHarness();

// Captured from models.list(providerId: codex) and the workspace coordinator's
// effortLevels on 2026-09-25. This is ascending provider evidence, independent
// of stepEncoderEffort and the harness's symbolic turn helper.
const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

// The one raw-to-physical mapping per model. The user confirmed on Creator
// Micro 2 that ENC_CW is a counter-clockwise turn (intent-hq/intent#5947).
// Codex Micro shares the mapping but still needs physical confirmation.
const physicalTurnByModel = {
  'creator-micro-2': { ENC_CW: 'counterclockwise', ENC_CC: 'clockwise' },
  'codex-micro': { ENC_CW: 'counterclockwise', ENC_CC: 'clockwise' },
} as const;

describe('raw encoder direction per device model', () => {
  it.each(Object.entries(physicalTurnByModel))('%s', (model, expected) => {
    const decoder = new HardwareInputDecoder({
      deviceModel: model as keyof typeof physicalTurnByModel,
    });
    const turns: PhysicalKnobDirection[] = [];
    decoder.on('encoderrotate', ({ direction }) => turns.push(direction));
    decoder.handleMessage({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    decoder.handleMessage({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } });
    expect(turns).toEqual([expected.ENC_CW, expected.ENC_CC]);
  });
});

describe.each(['codex-micro', 'creator-micro-2'] as const)('%s raw encoder routing', (model) => {
  // Raw packets through the production decoder: a physical clockwise turn
  // (ENC_CC) raises effort and moves workspace switching one tab right.
  it.each([
    {
      key: 'ENC_CW',
      expected: 'medium',
      gauge: '1',
      label: () => m.chat_effortPicker_level_medium(),
    },
    {
      key: 'ENC_CC',
      expected: 'xhigh',
      gauge: '3',
      label: () => m.chat_effortPicker_level_xhigh(),
    },
  ])(
    'routes $key to $expected through the real decoder, writer, feedback and gauge',
    async ({ key, expected, gauge, label }) => {
      ready();
      mocks.dispatch(updateSession('agent-1', { reasoningEffort: 'high', effortLevels: levels }));
      render(EncoderCycleHud);
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager(model);
      // Synthesized vendor channel-2 shape through the production decoder;
      // independent of the harness's symbolic turn helper.
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
      expect(device.showWorkspace).not.toHaveBeenCalled();
    },
  );

  it.each([
    { current: null, key: 'ENC_CW', reverse: 'ENC_CC', next: 'low' },
    { current: 'ultra', key: 'ENC_CC', reverse: 'ENC_CW', next: 'max' },
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

  it('steps across the tab strip without wrapping after opting out', async () => {
    ready();
    mocks.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
    const device = manager(model);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } });
    expect(device.showWorkspace).toHaveBeenLastCalledWith('ws-2');
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CC', act: 2 } });
    expect(device.showWorkspace).toHaveBeenCalledTimes(1);
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CW', act: 2 } });
    expect(device.showWorkspace).toHaveBeenLastCalledWith('ws-1');
    const homeView = state.homeWorkspaces;
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 0 } });
    device.emit({ m: 'v.oai.hid', p: { k: 'ENC_CLK', act: 1 } });
    expect(device.navigate.mock.calls).toEqual([['/'], ['/']]);
    expect(state.homeWorkspaces).toBe(homeView);
    device.navigate.mockClear();
    device.showWorkspace.mockClear();
    await flush();
    expect(mutations()).toHaveLength(0);
  });
});
