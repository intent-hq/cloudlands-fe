/**
 * Native quit-dialog copy (#440).
 *
 * The running-agent quit prompt only concerns agents on our spawned sidecar:
 * quitting shuts that daemon down, so they are "interrupted" and resumable on
 * next launch (destructive framing, Quit as the default). Agents on a daemon
 * we do not stop never reach this dialog.
 */

import { describe, expect, it } from 'vitest';

import {
  buildQuitDialogOptions,
  buildTabsOnlyQuitDialogOptions,
  formatAgentNameList,
  MAX_LISTED_AGENT_NAMES,
} from '../quit-dialog';
import type { RespondingAgent } from '../running-agents';

function agents(...names: string[]): RespondingAgent[] {
  return names.map((name, i) => ({
    agentId: `agent-${i + 1}`,
    name,
    workspaceId: 'ws-1',
  }));
}

describe('buildQuitDialogOptions — interrupted agents on the spawned sidecar', () => {
  it('keeps the exact destructive quit copy for a single agent', () => {
    const opts = buildQuitDialogOptions(agents('Refactor bot'));
    expect(opts).toEqual({
      type: 'info',
      title: 'Agents Still Working',
      message: '1 agent is still working.',
      detail:
        'Quitting will shut down running agents. You can resume them when the app reopens. Quit now?',
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
  });

  it('pluralizes the message for multiple agents', () => {
    const opts = buildQuitDialogOptions(agents('A', 'B', 'C'));
    expect(opts.message).toBe('3 agents are still working.');
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
  });

  it('always frames the action as a destructive Quit with Cancel as the escape', () => {
    const opts = buildQuitDialogOptions(agents('A', 'B'));
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
    expect(opts.defaultId).toBe(0);
    expect(opts.cancelId).toBe(1);
  });
});

describe('formatAgentNameList', () => {
  it('joins all names when at or below the cap', () => {
    expect(formatAgentNameList(agents('A', 'B'))).toBe('A, B');
    expect(formatAgentNameList(agents('A1', 'A2', 'A3', 'A4', 'A5'))).toBe('A1, A2, A3, A4, A5');
  });

  it('caps at MAX_LISTED_AGENT_NAMES with an "and M more" suffix', () => {
    expect(MAX_LISTED_AGENT_NAMES).toBe(5);
    expect(formatAgentNameList(agents('A1', 'A2', 'A3', 'A4', 'A5', 'A6'))).toBe(
      'A1, A2, A3, A4, A5, and 1 more',
    );
  });
});

describe('buildTabsOnlyQuitDialogOptions — tabs disrupted, zero agents', () => {
  it('uses singular copy for one tab with Quit as the default and Cancel as cancel', () => {
    const opts = buildTabsOnlyQuitDialogOptions(1);
    expect(opts).toEqual({
      type: 'info',
      title: 'Browser Tabs Still Connected',
      message: '1 connected browser tab will be disconnected.',
      detail:
        'Agents and models lose access to these browser tabs while the app is closed. Quit now?',
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
  });

  it('pluralizes the message with the tab count', () => {
    const opts = buildTabsOnlyQuitDialogOptions(3);
    expect(opts.message).toBe('3 connected browser tabs will be disconnected.');
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
  });
});
