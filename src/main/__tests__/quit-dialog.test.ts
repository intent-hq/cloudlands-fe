/**
 * Ownership-branched quit-dialog copy (#440, remote-aware follow-up).
 *
 * The running-agent quit prompt frames each agent by whether quitting shuts
 * down its daemon: agents on a daemon we do not stop (a remote backend or an
 * adopted external local daemon) "keep running" (non-destructive "Close"
 * framing with names listed, capped at 5), agents on our spawned sidecar are
 * "interrupted" and resumable on next launch (destructive framing, unchanged
 * legacy copy). When both groups are present one combined dialog lists them.
 */

import { describe, expect, it } from 'vitest';

import {
  buildQuitDialogOptions,
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

describe('buildQuitDialogOptions — interrupted only (spawned sidecar)', () => {
  it('keeps the exact destructive quit copy for a single agent', () => {
    const opts = buildQuitDialogOptions({ keepRunning: [], interrupted: agents('Refactor bot') });
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
    const opts = buildQuitDialogOptions({ keepRunning: [], interrupted: agents('A', 'B', 'C') });
    expect(opts.message).toBe('3 agents are still working.');
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
  });
});

describe('buildQuitDialogOptions — keep-running only (remote / external daemon)', () => {
  it('frames closing as safe: daemon and agents keep running, reconnect on relaunch', () => {
    const opts = buildQuitDialogOptions({
      keepRunning: agents('Refactor bot', 'Test runner'),
      interrupted: [],
    });
    expect(opts.title).toBe('Agents Keep Running');
    expect(opts.message).toBe('2 agents are still working.');
    expect(opts.detail).toBe(
      'Intent will close, but intentd and your 2 running agents (Refactor bot, Test runner) continue in the background. Reconnect anytime by reopening the app.',
    );
    expect(opts.buttons).toEqual(['Close', 'Cancel']);
    expect(opts.defaultId).toBe(0);
    expect(opts.cancelId).toBe(1);
  });

  it('uses singular phrasing and the agent name for one agent', () => {
    const opts = buildQuitDialogOptions({ keepRunning: agents('Refactor bot'), interrupted: [] });
    expect(opts.message).toBe('1 agent is still working.');
    expect(opts.detail).toContain(
      'your 1 running agent (Refactor bot) continues in the background',
    );
  });

  it('caps the listed names at 5 and summarizes the remainder', () => {
    const opts = buildQuitDialogOptions({
      keepRunning: agents('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'),
      interrupted: [],
    });
    expect(opts.detail).toContain('(A1, A2, A3, A4, A5, and 2 more)');
    expect(opts.detail).not.toContain('A6');
  });

  it('never uses the destructive "shut down" framing', () => {
    const opts = buildQuitDialogOptions({ keepRunning: agents('A', 'B'), interrupted: [] });
    expect(opts.detail).not.toContain('shut down');
    expect(opts.buttons).not.toContain('Quit');
  });
});

describe('buildQuitDialogOptions — combined (both groups)', () => {
  it('lists the keep-running and the interrupted agents separately', () => {
    const opts = buildQuitDialogOptions({
      keepRunning: agents('Remote one', 'Remote two'),
      interrupted: agents('Local one'),
    });
    expect(opts.title).toBe('Agents Still Working');
    // The headline counts every still-working agent, across both groups.
    expect(opts.message).toBe('3 agents are still working.');
    expect(opts.detail).toContain(
      'Your 2 running agents (Remote one, Remote two) keep working in the background on the daemon they run on.',
    );
    expect(opts.detail).toContain(
      '1 agent on the local daemon (Local one) will be stopped mid-turn. You can resume it when the app reopens.',
    );
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
    expect(opts.defaultId).toBe(0);
    expect(opts.cancelId).toBe(1);
  });

  it('uses singular keep-running phrasing and plural interrupted phrasing', () => {
    const opts = buildQuitDialogOptions({
      keepRunning: agents('Remote one'),
      interrupted: agents('Local one', 'Local two'),
    });
    expect(opts.message).toBe('3 agents are still working.');
    expect(opts.detail).toContain(
      'Your 1 running agent (Remote one) keeps working in the background on the daemon it runs on.',
    );
    expect(opts.detail).toContain(
      '2 agents on the local daemon (Local one, Local two) will be stopped mid-turn. You can resume them when the app reopens.',
    );
  });

  it('caps each group independently at MAX_LISTED_AGENT_NAMES', () => {
    const opts = buildQuitDialogOptions({
      keepRunning: agents('R1', 'R2', 'R3', 'R4', 'R5', 'R6'),
      interrupted: agents('L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'),
    });
    expect(opts.detail).toContain('(R1, R2, R3, R4, R5, and 1 more)');
    expect(opts.detail).toContain('(L1, L2, L3, L4, L5, and 2 more)');
    expect(opts.detail).not.toContain('R6');
    expect(opts.detail).not.toContain('L6');
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
