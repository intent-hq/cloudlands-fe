import { describe, expect, it } from 'vitest';
import {
  AGENT_KEY_COUNT,
  AGENT_KEY_IDS,
  agentKeyToSlot,
  isKeyAssignableWorkspace,
  keyPinsEqual,
  normalizeExcludedWorkspaceIds,
  normalizeKeyPins,
  reconcileKeyPins,
  resolveKeySlots,
  UNASSIGNED_KEY_PIN,
} from '../key-assignment';
import { WorkspaceStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

function ws(id: string, lastActivity: string) {
  return { id, lastActivity, createdAt: '2026-01-01T00:00:00Z', updatedAt: lastActivity };
}

describe('agentKeyToSlot', () => {
  it('maps second-row keys to slots 0–3 and top-row keys to slots 4–5', () => {
    expect(AGENT_KEY_IDS).toHaveLength(AGENT_KEY_COUNT);
    expect(agentKeyToSlot('AG02')).toBe(0);
    expect(agentKeyToSlot('AG05')).toBe(3);
    expect(agentKeyToSlot('AG00')).toBe(4);
    expect(agentKeyToSlot('AG01')).toBe(5);
  });

  it('returns null for non-agent keys', () => {
    expect(agentKeyToSlot('ACT06')).toBeNull();
    expect(agentKeyToSlot('ENC_CLK')).toBeNull();
    expect(agentKeyToSlot('ACT11')).toBeNull();
  });
});

describe('isKeyAssignableWorkspace', () => {
  it('accepts active workspaces', () => {
    expect(isKeyAssignableWorkspace({ id: 'a', status: WorkspaceStatus.Active })).toBe(true);
  });

  it('rejects the chief virtual workspace', () => {
    expect(isKeyAssignableWorkspace({ id: CHIEF_WORKSPACE_ID })).toBe(false);
  });

  it('rejects archived and deleted workspaces', () => {
    expect(isKeyAssignableWorkspace({ id: 'a', status: WorkspaceStatus.Archived })).toBe(false);
    expect(isKeyAssignableWorkspace({ id: 'a', status: WorkspaceStatus.Deleted })).toBe(false);
    expect(isKeyAssignableWorkspace({ id: 'a', archived: true })).toBe(false);
  });
});

describe('normalizeKeyPins', () => {
  it('pads short input and truncates long input to 6 slots', () => {
    expect(normalizeKeyPins(['a'])).toEqual(['a', null, null, null, null, null]);
    expect(normalizeKeyPins(new Array(8).fill('x'))).toHaveLength(AGENT_KEY_COUNT);
  });

  it('coerces non-string entries to null', () => {
    expect(normalizeKeyPins([undefined as unknown as string, '', 'b'])).toEqual([
      null,
      null,
      'b',
      null,
      null,
      null,
    ]);
  });

  it('returns all-null for undefined', () => {
    expect(normalizeKeyPins(undefined)).toEqual(new Array(AGENT_KEY_COUNT).fill(null));
  });

  it('preserves the sticky-unassigned sentinel', () => {
    expect(normalizeKeyPins([UNASSIGNED_KEY_PIN, 'a'])).toEqual([
      UNASSIGNED_KEY_PIN,
      'a',
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('resolveKeySlots', () => {
  const noPins = new Array<string | null>(AGENT_KEY_COUNT).fill(null);

  it('auto-fills unpinned slots by lastActivity, most recent first', () => {
    const workspaces = [
      ws('old', '2026-07-01T00:00:00Z'),
      ws('new', '2026-07-30T00:00:00Z'),
      ws('mid', '2026-07-15T00:00:00Z'),
    ];
    expect(resolveKeySlots(noPins, workspaces)).toEqual(['new', 'mid', 'old', null, null, null]);
  });

  it('keeps pinned slots stable and fills the rest around them', () => {
    const workspaces = [
      ws('a', '2026-07-30T00:00:00Z'),
      ws('b', '2026-07-29T00:00:00Z'),
      ws('c', '2026-07-28T00:00:00Z'),
    ];
    const pins = [null, null, null, 'c', null, null];
    expect(resolveKeySlots(pins, workspaces)).toEqual(['a', 'b', null, 'c', null, null]);
  });

  it('does not auto-fill a pinned workspace onto another slot', () => {
    const workspaces = [ws('a', '2026-07-30T00:00:00Z'), ws('b', '2026-07-29T00:00:00Z')];
    const pins = ['a', null, null, null, null, null];
    expect(resolveKeySlots(pins, workspaces)).toEqual(['a', 'b', null, null, null, null]);
  });

  it('leaves a slot to auto-fill when its pin references a missing workspace', () => {
    const workspaces = [ws('a', '2026-07-30T00:00:00Z')];
    const pins = [null, 'gone', null, null, null, null];
    expect(resolveKeySlots(pins, workspaces)).toEqual(['a', null, null, null, null, null]);
  });

  it('places a workspace pinned to multiple slots only on the lowest one', () => {
    const workspaces = [ws('a', '2026-07-30T00:00:00Z'), ws('b', '2026-07-29T00:00:00Z')];
    const pins = ['a', 'a', null, null, null, null];
    expect(resolveKeySlots(pins, workspaces)).toEqual(['a', 'b', null, null, null, null]);
  });

  it('caps auto-fill at 6 workspaces', () => {
    const workspaces = Array.from({ length: 9 }, (_, i) =>
      ws(`w${i}`, `2026-07-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
    );
    const slots = resolveKeySlots(noPins, workspaces);
    expect(slots).toEqual(['w8', 'w7', 'w6', 'w5', 'w4', 'w3']);
  });

  it('falls back to createdAt when lastActivity is absent', () => {
    const workspaces = [
      { id: 'no-activity', createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z' },
      ws('recent', '2026-07-20T00:00:00Z'),
    ];
    expect(resolveKeySlots(noPins, workspaces)[0]).toBe('no-activity');
  });

  it('never auto-fills a sticky-unassigned slot', () => {
    const workspaces = [
      ws('a', '2026-07-30T00:00:00Z'),
      ws('b', '2026-07-29T00:00:00Z'),
      ws('c', '2026-07-28T00:00:00Z'),
    ];
    const pins = [UNASSIGNED_KEY_PIN, null, null, null, null, null];
    expect(resolveKeySlots(pins, workspaces)).toEqual([null, 'a', 'b', 'c', null, null]);
  });

  it('keeps sticky-unassigned slots empty even at full capacity', () => {
    const workspaces = Array.from({ length: 7 }, (_, i) =>
      ws(`w${i}`, `2026-07-${String(10 + i).padStart(2, '0')}T00:00:00Z`),
    );
    const pins = [null, null, UNASSIGNED_KEY_PIN, null, null, null];
    const slots = resolveKeySlots(pins, workspaces);
    expect(slots[2]).toBeNull();
    expect(slots.filter((slot) => slot !== null)).toHaveLength(5);
  });

  it('backfills a slot immediately when its workspace disappears', () => {
    const pins = [null, 'gone', null, null, null, null];
    const workspaces = [ws('a', '2026-07-30T00:00:00Z'), ws('b', '2026-07-29T00:00:00Z')];
    expect(resolveKeySlots(pins, workspaces)).toEqual(['a', 'b', null, null, null, null]);
  });

  it('never auto-fills an excluded workspace', () => {
    const workspaces = [ws('a', '2026-07-30T00:00:00Z'), ws('b', '2026-07-29T00:00:00Z')];
    expect(resolveKeySlots(noPins, workspaces, ['a'])).toEqual([
      'b',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('an explicit pin still wins over exclusion', () => {
    const workspaces = [ws('a', '2026-07-30T00:00:00Z')];
    const pins = ['a', null, null, null, null, null];
    expect(resolveKeySlots(pins, workspaces, ['a'])).toEqual(['a', null, null, null, null, null]);
  });
});

describe('normalizeExcludedWorkspaceIds', () => {
  it('keeps non-empty strings, deduplicated, rejecting the sentinel', () => {
    expect(normalizeExcludedWorkspaceIds(['a', 'a', '', UNASSIGNED_KEY_PIN, 'b', 7])).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeExcludedWorkspaceIds(undefined)).toEqual([]);
    expect(normalizeExcludedWorkspaceIds('a')).toEqual([]);
    expect(normalizeExcludedWorkspaceIds({ 0: 'a' })).toEqual([]);
  });
});

describe('keyPinsEqual', () => {
  it('compares 6-slot arrays entry-wise, tolerating short input', () => {
    expect(keyPinsEqual(['a', null, null, null, null, null], ['a'])).toBe(true);
    expect(keyPinsEqual(['a', null, null, null, null, null], ['b'])).toBe(false);
    expect(keyPinsEqual([], [])).toBe(true);
  });
});

describe('reconcileKeyPins', () => {
  const noPins = new Array<string | null>(AGENT_KEY_COUNT).fill(null);

  it('promotes auto-filled slots into pins (sticky snapshot)', () => {
    const workspaces = [ws('old', '2026-07-01T00:00:00Z'), ws('new', '2026-07-30T00:00:00Z')];
    expect(reconcileKeyPins(noPins, workspaces)).toEqual(['new', 'old', null, null, null, null]);
  });

  it('keeps existing pins on their slots regardless of activity', () => {
    const pins = ['old', 'new', null, null, null, null];
    const workspaces = [ws('old', '2026-07-01T00:00:00Z'), ws('new', '2026-07-30T00:00:00Z')];
    expect(reconcileKeyPins(pins, workspaces)).toEqual(['old', 'new', null, null, null, null]);
  });

  it('releases a pin whose workspace disappeared and backfills it', () => {
    const pins = ['gone', 'kept', null, null, null, null];
    const workspaces = [ws('kept', '2026-07-01T00:00:00Z'), ws('next', '2026-07-30T00:00:00Z')];
    expect(reconcileKeyPins(pins, workspaces)).toEqual(['next', 'kept', null, null, null, null]);
  });

  it('preserves sticky-unassigned sentinels', () => {
    const pins = [UNASSIGNED_KEY_PIN, null, null, null, null, null];
    const workspaces = [ws('a', '2026-07-30T00:00:00Z')];
    expect(reconcileKeyPins(pins, workspaces)).toEqual([
      UNASSIGNED_KEY_PIN,
      'a',
      null,
      null,
      null,
      null,
    ]);
  });

  it('does not fill excluded workspaces into freed slots', () => {
    const pins = ['gone', null, null, null, null, null];
    const workspaces = [ws('excluded', '2026-07-30T00:00:00Z'), ws('ok', '2026-07-01T00:00:00Z')];
    expect(reconcileKeyPins(pins, workspaces, ['excluded'])).toEqual([
      'ok',
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
