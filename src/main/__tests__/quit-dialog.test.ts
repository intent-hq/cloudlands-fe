/**
 * Mode-branched quit-dialog copy (#440).
 *
 * The running-agent quit prompt frames quitting differently depending on who
 * owns the daemon: sidecar mode shuts the daemon down (destructive framing,
 * unchanged legacy copy), external mode leaves intentd and its agents running
 * (non-destructive "Close" framing with agent names listed, capped at 5).
 * `unknown` falls back to the conservative sidecar framing.
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

describe('buildQuitDialogOptions — sidecar mode (legacy copy unchanged)', () => {
  it('keeps the exact destructive quit copy for a single agent', () => {
    const opts = buildQuitDialogOptions('sidecar', agents('Refactor bot'));
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
    const opts = buildQuitDialogOptions('sidecar', agents('A', 'B', 'C'));
    expect(opts.message).toBe('3 agents are still working.');
    expect(opts.buttons).toEqual(['Quit', 'Cancel']);
  });

  it('treats unknown mode as sidecar (conservative destructive framing)', () => {
    const opts = buildQuitDialogOptions('unknown', agents('A'));
    expect(opts).toEqual(buildQuitDialogOptions('sidecar', agents('A')));
  });
});

describe('buildQuitDialogOptions — external mode (non-destructive close)', () => {
  it('frames closing as safe: daemon and agents keep running, reconnect on relaunch', () => {
    const opts = buildQuitDialogOptions('external', agents('Refactor bot', 'Test runner'));
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
    const opts = buildQuitDialogOptions('external', agents('Refactor bot'));
    expect(opts.message).toBe('1 agent is still working.');
    expect(opts.detail).toContain('your 1 running agent (Refactor bot) continue in the background');
  });

  it('caps the listed names at 5 and summarizes the remainder', () => {
    const opts = buildQuitDialogOptions(
      'external',
      agents('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'),
    );
    expect(opts.detail).toContain('(A1, A2, A3, A4, A5, and 2 more)');
    expect(opts.detail).not.toContain('A6');
  });

  it('never uses the destructive "shut down" framing', () => {
    const opts = buildQuitDialogOptions('external', agents('A', 'B'));
    expect(opts.detail).not.toContain('shut down');
    expect(opts.buttons).not.toContain('Quit');
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
