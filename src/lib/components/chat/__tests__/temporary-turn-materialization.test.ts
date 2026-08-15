import { describe, expect, it } from 'vitest';
import {
  EMPTY_TEMPORARY_TURN_MATERIALIZATION,
  isTurnTemporarilyMaterialized,
  materializeTurn,
  releaseMaterializedTurn,
} from '../temporary-turn-materialization';

describe('temporary turn materialization', () => {
  it('holds pinned and editing leases independently, then releases them', () => {
    const pinned = materializeTurn(EMPTY_TEMPORARY_TURN_MATERIALIZATION, 'pinned', 'turn-1');
    const editing = materializeTurn(pinned, 'editing', 'turn-2');
    expect(isTurnTemporarilyMaterialized(editing, 'turn-1')).toBe(true);
    expect(isTurnTemporarilyMaterialized(editing, 'turn-2')).toBe(true);
    const released = releaseMaterializedTurn(editing, 'pinned', 'turn-1');
    expect(isTurnTemporarilyMaterialized(released, 'turn-1')).toBe(false);
    expect(isTurnTemporarilyMaterialized(released, 'turn-2')).toBe(true);
  });
});
