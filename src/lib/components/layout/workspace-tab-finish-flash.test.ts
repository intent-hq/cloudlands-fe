import { describe, expect, it } from 'vitest';
import {
  EMPTY_WORKSPACE_TAB_FINISH_FLASHES,
  WORKSPACE_TAB_FINISH_FLASH_MS,
  nextWorkspaceTabFinishFlashExpiry,
  nextWorkspaceTabFinishFlashes,
  type WorkspaceTabFinishObservation,
} from './workspace-tab-finish-flash';

const tab = (
  state: WorkspaceTabFinishObservation['state'],
  isCurrent = false,
  workspaceId = 'ws-1',
): WorkspaceTabFinishObservation => ({ workspaceId, state, isCurrent });

function run(steps: Array<[WorkspaceTabFinishObservation[], number]>) {
  return steps.reduce(
    (flashes, [observations, now]) => nextWorkspaceTabFinishFlashes(flashes, observations, now),
    EMPTY_WORKSPACE_TAB_FINISH_FLASHES,
  );
}

describe('nextWorkspaceTabFinishFlashes', () => {
  it('flashes a background tab that goes from working to unread', () => {
    const flashes = run([
      [[tab('in_progress')], 0],
      [[tab('unread')], 1000],
    ]);
    expect(flashes.expiresAt.get('ws-1')).toBe(1000 + WORKSPACE_TAB_FINISH_FLASH_MS);
  });

  it('does not flash a tab first seen as unread', () => {
    expect(run([[[tab('unread')], 0]]).expiresAt.size).toBe(0);
  });

  it('does not flash the current tab', () => {
    const flashes = run([
      [[tab('in_progress', true)], 0],
      [[tab('unread', true)], 1000],
    ]);
    expect(flashes.expiresAt.size).toBe(0);
  });

  it('does not flash when work ends in a failure or a question', () => {
    for (const end of ['failed', 'needs_attention', 'blocked', 'idle'] as const) {
      const flashes = run([
        [[tab('in_progress')], 0],
        [[tab(end)], 1000],
      ]);
      expect(flashes.expiresAt.size).toBe(0);
    }
  });

  it('keeps the flash on later updates until it expires', () => {
    const start = run([
      [[tab('in_progress')], 0],
      [[tab('unread')], 0],
    ]);
    const kept = nextWorkspaceTabFinishFlashes(start, [tab('unread')], 29_999);
    expect(kept.expiresAt.get('ws-1')).toBe(WORKSPACE_TAB_FINISH_FLASH_MS);
    const expired = nextWorkspaceTabFinishFlashes(kept, [tab('unread')], 30_000);
    expect(expired.expiresAt.size).toBe(0);
  });

  it('clears the flash when the tab becomes current or starts working again', () => {
    const start = run([
      [[tab('in_progress')], 0],
      [[tab('unread')], 0],
    ]);
    expect(nextWorkspaceTabFinishFlashes(start, [tab('unread', true)], 1).expiresAt.size).toBe(0);
    expect(nextWorkspaceTabFinishFlashes(start, [tab('in_progress')], 1).expiresAt.size).toBe(0);
  });

  it('forgets closed tabs', () => {
    const start = run([
      [[tab('in_progress')], 0],
      [[tab('unread')], 0],
    ]);
    const closed = nextWorkspaceTabFinishFlashes(start, [], 1);
    expect(closed.expiresAt.size).toBe(0);
    expect(closed.previous.size).toBe(0);
  });

  it('restarts the timer when the tab finishes again', () => {
    const flashes = run([
      [[tab('in_progress')], 0],
      [[tab('unread')], 0],
      [[tab('in_progress')], 10_000],
      [[tab('unread')], 20_000],
    ]);
    expect(flashes.expiresAt.get('ws-1')).toBe(20_000 + WORKSPACE_TAB_FINISH_FLASH_MS);
  });
});

describe('nextWorkspaceTabFinishFlashExpiry', () => {
  it('returns the earliest expiry across tabs', () => {
    const flashes = run([
      [[tab('in_progress', false, 'a'), tab('unread', false, 'b')], 0],
      [[tab('unread', false, 'a'), tab('in_progress', false, 'b')], 5000],
      [[tab('unread', false, 'a'), tab('unread', false, 'b')], 9000],
    ]);
    expect(nextWorkspaceTabFinishFlashExpiry(flashes)).toBe(5000 + WORKSPACE_TAB_FINISH_FLASH_MS);
    expect(nextWorkspaceTabFinishFlashExpiry(EMPTY_WORKSPACE_TAB_FINISH_FLASHES)).toBeNull();
  });
});
