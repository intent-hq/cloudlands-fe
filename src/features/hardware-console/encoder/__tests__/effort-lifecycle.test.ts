/** @vitest-environment jsdom */
import {
  useEncoderEffortHarness,
  heldReply,
  request,
  reply,
  mutations,
  ready,
  manager,
  effort,
  flush,
  mocks,
  state,
  tasks,
  listeners,
  publish,
} from './encoder-effort.fixture';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { AGENT_CHANNELS } from '$shared/ipc/channels';
import { updateSession } from '$store/renderer/slices/agent-session/agent-session-slice';
import { applyReasoningEffort } from '$features/agent/reasoning-effort';
import { consoleOwnerChanged } from '$store/renderer/slices/hardware-console/hardware-console-slice';
import EffortPicker from '$lib/components/chat/input/EffortPicker.svelte';

useEncoderEffortHarness();

type EffortProtocol = 'modern' | 'legacy';

/** Hold only the transport boundary; the writer, clients, reducers and sagas stay real. */
function effortWire(protocol: EffortProtocol) {
  const modelId = (level: string | null) => (level === null ? 'model-a' : `model-a/${level}`);
  const legacy = vi.fn(async (params: { modelId: string }): Promise<unknown> => ({
    success: true,
    data: { success: true, modelId: params.modelId },
  }));
  if (protocol === 'legacy') {
    state.daemonHealth.stats.protocolVersion = '5.1';
    publish();
    registerMockIpcHandler(AGENT_CHANNELS.SET_MODEL, legacy);
  }
  return {
    hold() {
      const held = heldReply();
      if (protocol === 'legacy') legacy.mockImplementationOnce(() => held.promise);
      else request.mockImplementationOnce(() => held.promise);
      return {
        accept(level: string | null) {
          held.resolve(
            protocol === 'legacy'
              ? { success: true, data: { success: true, modelId: modelId(level) } }
              : reply(level),
          );
        },
        reject(error: string) {
          if (protocol === 'legacy')
            held.resolve({ success: true, data: { success: false, error } });
          else held.reject(new Error(error));
        },
      };
    },
    echo(level: string | null) {
      mocks.dispatch(
        updateSession('agent-1', {
          reasoningEffort: level,
          ...(protocol === 'legacy' ? { model: modelId(level) } : {}),
        }),
      );
    },
    expectWrites(levels: (string | null)[]) {
      if (protocol === 'legacy') {
        expect(legacy.mock.calls).toEqual(
          levels.map((level) => [
            {
              agentId: 'agent-1',
              workspaceId: 'ws-1',
              providerId: 'codex',
              modelId: modelId(level),
            },
          ]),
        );
        expect(mutations()).toEqual([]);
      } else {
        expect(mutations()).toEqual(
          levels.map((level) => [
            'agent.update',
            { agentId: 'agent-1', workspaceId: 'ws-1', changes: { reasoningEffort: level } },
          ]),
        );
        expect(legacy).not.toHaveBeenCalled();
      }
    },
  };
}

type Effort = 'low' | 'medium' | 'high' | null;

type OverlapScenario = {
  name: string;
  picked: 'low' | null;
  oldAccepted: boolean;
  pickerAccepted: boolean;
  order: 'old-first' | 'picker-ready-first';
  turns: 'none' | 'one' | 'return';
  stop: 'none' | 'before-old' | 'during-picker';
  writes: Effort[];
  displayed: Effort;
  errors: string[];
};

// These rows extend encoder-effort.test.ts's immediate picker responses and historical
// disconnect/reconnect regressions. Each row names a distinct ordering or ownership
// boundary; expected writes/values come from accepted edits, not writer internals.
const overlapScenarios: OverlapScenario[] = [
  {
    name: 'early Auto acceptance coalesces a return turn',
    picked: null,
    oldAccepted: true,
    pickerAccepted: true,
    order: 'picker-ready-first',
    turns: 'return',
    stop: 'none',
    writes: ['low', null],
    displayed: null,
    errors: [],
  },
  {
    name: 'early Auto failure preserves a newer Low turn after both rejections',
    picked: null,
    oldAccepted: false,
    pickerAccepted: false,
    order: 'picker-ready-first',
    turns: 'one',
    stop: 'none',
    writes: ['low', null, 'low'],
    displayed: 'low',
    errors: [],
  },
  {
    name: 'failed Low picker and return turn reuse an accepted leading Low',
    picked: 'low',
    oldAccepted: true,
    pickerAccepted: false,
    order: 'picker-ready-first',
    turns: 'return',
    stop: 'none',
    writes: ['low', 'low'],
    displayed: 'low',
    errors: [],
  },
  {
    name: 'failed Low picker and return turn retry a rejected leading Low',
    picked: 'low',
    oldAccepted: false,
    pickerAccepted: false,
    order: 'picker-ready-first',
    turns: 'return',
    stop: 'none',
    writes: ['low', 'low', 'low'],
    displayed: 'low',
    errors: [],
  },
  {
    name: 'disconnect during Low picker cancels a return turn but keeps picker success',
    picked: 'low',
    oldAccepted: true,
    pickerAccepted: true,
    order: 'old-first',
    turns: 'return',
    stop: 'during-picker',
    writes: ['low', 'low'],
    displayed: 'low',
    errors: [],
  },
  {
    name: 'disconnect during Auto picker restores accepted Low on failure',
    picked: null,
    oldAccepted: true,
    pickerAccepted: false,
    order: 'old-first',
    turns: 'one',
    stop: 'during-picker',
    writes: ['low', null],
    displayed: 'low',
    errors: ['picker rejected'],
  },
  {
    name: 'early Auto acceptance survives disconnect and leading rejection',
    picked: null,
    oldAccepted: false,
    pickerAccepted: true,
    order: 'picker-ready-first',
    turns: 'one',
    stop: 'before-old',
    writes: ['low', null],
    displayed: null,
    errors: [],
  },
  {
    name: 'early Low rejection cannot restore canceled Medium after disconnect',
    picked: 'low',
    oldAccepted: true,
    pickerAccepted: false,
    order: 'picker-ready-first',
    turns: 'one',
    stop: 'before-old',
    writes: ['low', 'low'],
    displayed: 'low',
    errors: ['picker rejected'],
  },
  {
    name: 'held Auto picker restores Auto when neither write is accepted',
    picked: null,
    oldAccepted: false,
    pickerAccepted: false,
    order: 'old-first',
    turns: 'none',
    stop: 'none',
    writes: ['low', null],
    displayed: null,
    errors: ['picker rejected'],
  },
  {
    name: 'held Low acceptance owns a return turn after leading rejection',
    picked: 'low',
    oldAccepted: false,
    pickerAccepted: true,
    order: 'old-first',
    turns: 'return',
    stop: 'none',
    writes: ['low', 'low'],
    displayed: 'low',
    errors: [],
  },
];

function expectDisplayed(level: Effort) {
  expect(effort()).toBe(level);
  const gauge = screen.queryByTestId('effort-gauge');
  if (level === null) expect(gauge).toBeNull();
  else
    expect(gauge?.getAttribute('data-gauge-value')).toBe(
      { low: '0', medium: '1', high: '2' }[level],
    );
}

describe.each<EffortProtocol>(['modern', 'legacy'])('%s effort lifecycle', (protocol) => {
  for (const scenario of overlapScenarios) {
    it(scenario.name, async () => {
      ready();
      const wire = effortWire(protocol);
      const old = wire.hold();
      const picker = wire.hold();
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager();
      device.turn();
      device.turn();
      const editing = applyReasoningEffort('agent-1', 'ws-1', scenario.picked, 'medium');
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      if (scenario.turns !== 'none') device.turn();
      if (scenario.turns === 'return') device.turn('ccw');
      if (scenario.stop === 'before-old') device.statusChanged('disconnected');
      wire.expectWrites(['low']);

      const settlePicker = () =>
        scenario.pickerAccepted ? picker.accept(scenario.picked) : picker.reject('picker rejected');
      if (scenario.order === 'picker-ready-first') {
        settlePicker();
        await flush();
        // Even an already-settled queued response cannot bypass the old request.
        wire.expectWrites(['low']);
      }
      if (scenario.oldAccepted) old.accept('low');
      else old.reject('old rejected');
      await flush();
      if (scenario.order === 'old-first') {
        wire.expectWrites(['low', scenario.picked]);
        if (scenario.stop === 'during-picker') device.statusChanged('disconnected');
        settlePicker();
      }
      expect(await editing).toBe(scenario.pickerAccepted);
      await flush();
      wire.expectWrites(scenario.writes);
      expectDisplayed(scenario.displayed);
      expect(mocks.notify.mock.calls).toEqual(scenario.errors.map((error) => [error]));
      if (scenario.stop !== 'none') {
        expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
        expect(device.raw.size).toBe(0);
        device.turn();
      }
      // Drain UI timers too: no queued device RPC can reappear after quiescence.
      await vi.runAllTimersAsync();
      await flush();
      wire.expectWrites(scenario.writes);
      expectDisplayed(scenario.displayed);
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
    });
  }

  it.each(['before-response', 'after-response'] as const)(
    'accepts an echo arriving while disconnected (%s), then releases the completed baseline',
    async (echoOrder) => {
      ready();
      const wire = effortWire(protocol);
      const old = wire.hold();
      const next = wire.hold();
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager();
      device.turn();
      device.turn();
      device.statusChanged('disconnected');
      if (echoOrder === 'after-response') {
        old.accept('low');
        await flush();
        expectDisplayed('low');
      }
      wire.echo('low');
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(device.raw.size).toBe(0);
      device.statusChanged('connected');
      device.turn();
      if (echoOrder === 'before-response') {
        wire.expectWrites(['low']);
        old.accept('low');
      }
      await flush();
      wire.expectWrites(['low', 'medium']);
      next.reject('reconnected write rejected');
      await flush();
      expectDisplayed('low');
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(mocks.notify).toHaveBeenCalledExactlyOnceWith('reconnected write rejected');

      // A new accepted external edit starts its own sequence after the queue drains.
      wire.echo('high');
      const independent = wire.hold();
      const editing = applyReasoningEffort('agent-1', 'ws-1', 'medium', 'high');
      independent.reject('independent write rejected');
      expect(await editing).toBe(false);
      await flush();
      expectDisplayed('high');
      wire.expectWrites(['low', 'medium', 'medium']);
    },
  );

  it.each(['owner', 'workspace', 'cancel'] as const)(
    'abandons reconnected work after %s loss without reviving input',
    async (boundary) => {
      ready();
      const wire = effortWire(protocol);
      const old = wire.hold();
      render(EffortPicker, { agentId: 'agent-1', workspaceId: 'ws-1' });
      const device = manager();
      device.turn();
      device.statusChanged('disconnected');
      device.statusChanged('connected');
      device.turn();
      device.turn();
      if (boundary === 'owner') mocks.dispatch(consoleOwnerChanged(false));
      else if (boundary === 'workspace') {
        state.tabState.currentTabId = 'ws-2';
        publish();
      } else {
        device.dispose();
        for (const task of tasks) task.cancel();
      }
      // Echo after abandonment, before the already-issued success settles.
      wire.echo('low');
      old.accept('low');
      await flush();
      await vi.runAllTimersAsync();
      wire.expectWrites(['low']);
      expectDisplayed('low');
      expect(effort('agent-3')).toBeNull();
      expect(state.hardwareConsole.encoderEffortFeedback).toBeNull();
      expect(mocks.notify).not.toHaveBeenCalled();
      if (boundary === 'cancel') {
        expect(device.raw.size).toBe(0);
        expect(device.statuses.size).toBe(0);
        expect(listeners.size).toBe(0);
      }

      wire.echo('high');
      const independent = wire.hold();
      const editing = applyReasoningEffort('agent-1', 'ws-1', 'medium', 'high');
      independent.reject('independent write rejected');
      expect(await editing).toBe(false);
      await flush();
      expectDisplayed('high');
      wire.expectWrites(['low', 'medium']);
    },
  );
});
