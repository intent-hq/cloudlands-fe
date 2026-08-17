import { describe, expect, it } from 'vitest';
import {
  EMPTY_TEMPORARY_TURN_MATERIALIZATION,
  isTurnTemporarilyMaterialized,
  materializeTurn,
  releaseMaterializedTurn,
} from '../temporary-turn-materialization';

describe('temporary turn materialization', () => {
  it('holds an edited turn until editing ends', () => {
    const editing = materializeTurn(EMPTY_TEMPORARY_TURN_MATERIALIZATION, 'editing', 'turn-2');
    expect(isTurnTemporarilyMaterialized(editing, 'turn-2')).toBe(true);
    const released = releaseMaterializedTurn(editing, 'editing', 'turn-2');
    expect(isTurnTemporarilyMaterialized(released, 'turn-2')).toBe(false);
  });
});
