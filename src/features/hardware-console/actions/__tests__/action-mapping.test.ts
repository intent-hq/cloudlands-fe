import { describe, expect, it } from 'vitest';
import {
  ACTION_KEY_COUNT,
  ACTION_KEY_IDS,
  CODEX_MIC_LINKED_SLOT,
  DEFAULT_ACTION_MAPPING,
  DEFAULT_ACTION_MAPPINGS,
  LEGACY_CM2_DEFAULT_ACTION_MAPPING,
  PREVIOUS_CM2_DEFAULT_ACTION_MAPPING,
  actionKeyToSlot,
  getDefaultActionMapping,
  isActionKeyActionId,
  migrateLegacyCm2DefaultActionMapping,
  normalizeActionMapping,
  normalizeActionMappingsByModel,
} from '../action-mapping';

describe('actionKeyToSlot', () => {
  it('maps ACT06..ACT12 to slots 0..6', () => {
    expect(ACTION_KEY_IDS.map(actionKeyToSlot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps the Codex Mic pair as separate slots (ACT10=4, ACT11=5)', () => {
    expect(actionKeyToSlot('ACT10')).toBe(4);
    expect(actionKeyToSlot('ACT11')).toBe(5);
  });

  it('returns null for agent keys and the encoder click', () => {
    expect(actionKeyToSlot('AG00')).toBeNull();
    expect(actionKeyToSlot('AG05')).toBeNull();
    expect(actionKeyToSlot('ENC_CLK')).toBeNull();
  });
});

describe('per-model default mappings', () => {
  it('CM2 assigns creation actions then agent-cycling actions (stop-agent unassigned)', () => {
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2']).toEqual([
      'new-workspace',
      'new-agent',
      'see-spec',
      'switch-window-layouts',
      'cycle-in-progress-agents',
      'cycle-attention-agents',
      'cycle-unread-agents',
    ]);
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2']).toHaveLength(ACTION_KEY_COUNT);
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2']).not.toContain('stop-agent');
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2']).not.toContain('toggle-sidebar-tabs');
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2']).not.toContain('cycle-workspace-agents');
  });

  it('CM2 row 4 (ACT10–ACT12) defaults to in-progress / attention / unread cycling', () => {
    expect(ACTION_KEY_IDS.slice(4)).toEqual(['ACT10', 'ACT11', 'ACT12']);
    expect(DEFAULT_ACTION_MAPPINGS['creator-micro-2'].slice(4)).toEqual([
      'cycle-in-progress-agents',
      'cycle-attention-agents',
      'cycle-unread-agents',
    ]);
  });

  it('DEFAULT_ACTION_MAPPING remains the CM2 defaults (legacy seam)', () => {
    expect(DEFAULT_ACTION_MAPPING).toBe(DEFAULT_ACTION_MAPPINGS['creator-micro-2']);
    expect(getDefaultActionMapping('creator-micro-2')).toBe(DEFAULT_ACTION_MAPPING);
  });

  it('Codex Micro maps printed caps by slot with the Mic action on ACT10 only', () => {
    expect(DEFAULT_ACTION_MAPPINGS['codex-micro']).toEqual([
      'cycle-in-progress-agents', // ACT06 lightning
      'cycle-attention-agents', // ACT07 checkmark
      'stop-agent', // ACT08 x-mark
      'new-workspace', // ACT09 branching
      'cycle-unread-agents', // ACT10 = first switch of the linked Mic pair
      'none', // ACT11 = second linked switch, unset by default
      'new-agent', // ACT12 logo
    ]);
    expect(DEFAULT_ACTION_MAPPINGS['codex-micro']).toHaveLength(ACTION_KEY_COUNT);
  });

  it('the Codex linked-pair slot is ACT11 and defaults to none', () => {
    expect(ACTION_KEY_IDS[CODEX_MIC_LINKED_SLOT]).toBe('ACT11');
    expect(DEFAULT_ACTION_MAPPINGS['codex-micro'][CODEX_MIC_LINKED_SLOT]).toBe('none');
  });
});

describe('normalizeActionMapping', () => {
  it('returns the CM2 defaults for undefined input', () => {
    expect(normalizeActionMapping(undefined)).toEqual([...DEFAULT_ACTION_MAPPING]);
  });

  it('returns the model defaults for undefined input on the Codex Micro', () => {
    expect(normalizeActionMapping(undefined, 'codex-micro')).toEqual([
      ...DEFAULT_ACTION_MAPPINGS['codex-micro'],
    ]);
  });

  it('keeps a persisted assignment on the Codex linked-pair slot (separable)', () => {
    const mapping = normalizeActionMapping(
      new Array(ACTION_KEY_COUNT).fill('new-agent'),
      'codex-micro',
    );
    expect(mapping[CODEX_MIC_LINKED_SLOT]).toBe('new-agent');
    expect(mapping[4]).toBe('new-agent');
  });

  it('keeps valid entries and repairs invalid ones with the slot default', () => {
    const mapping = normalizeActionMapping([
      'none',
      'bogus',
      'toggle-sidebar-tabs',
      42,
      null,
      'new-workspace',
    ]);
    expect(mapping).toEqual([
      'none',
      'new-agent',
      'toggle-sidebar-tabs',
      'switch-window-layouts',
      'cycle-in-progress-agents',
      'new-workspace',
      'cycle-unread-agents',
    ]);
  });

  it('accepts the new global cycle actions as valid entries', () => {
    const mapping = normalizeActionMapping([
      'cycle-attention-agents',
      'cycle-idle-agents',
      'cycle-unread-agents',
      'cycle-failed-agents',
      'stop-agent',
      'none',
      'none',
    ]);
    expect(mapping).toEqual([
      'cycle-attention-agents',
      'cycle-idle-agents',
      'cycle-unread-agents',
      'cycle-failed-agents',
      'stop-agent',
      'none',
      'none',
    ]);
  });

  it('truncates over-long input to 7 slots', () => {
    const mapping = normalizeActionMapping(new Array(10).fill('none'));
    expect(mapping).toHaveLength(ACTION_KEY_COUNT);
    expect(mapping.every((id) => id === 'none')).toBe(true);
  });
});

describe('normalizeActionMappingsByModel', () => {
  it('returns per-model defaults for undefined input', () => {
    expect(normalizeActionMappingsByModel(undefined)).toEqual({
      'creator-micro-2': [...DEFAULT_ACTION_MAPPINGS['creator-micro-2']],
      'codex-micro': [...DEFAULT_ACTION_MAPPINGS['codex-micro']],
    });
  });

  it('keeps each model isolated: a customized CM2 entry never affects the Codex', () => {
    const result = normalizeActionMappingsByModel({
      'creator-micro-2': new Array(ACTION_KEY_COUNT).fill('stop-agent'),
    });
    expect(result['creator-micro-2'].every((id) => id === 'stop-agent')).toBe(true);
    expect(result['codex-micro']).toEqual([...DEFAULT_ACTION_MAPPINGS['codex-micro']]);
  });

  it('reads a legacy flat array as the CM2 entry when the record has none', () => {
    const legacy = new Array(ACTION_KEY_COUNT).fill('see-spec');
    const result = normalizeActionMappingsByModel(undefined, legacy);
    expect(result['creator-micro-2'].every((id) => id === 'see-spec')).toBe(true);
    expect(result['codex-micro']).toEqual([...DEFAULT_ACTION_MAPPINGS['codex-micro']]);
  });

  it('prefers a per-model CM2 entry over the legacy array', () => {
    const result = normalizeActionMappingsByModel(
      { 'creator-micro-2': new Array(ACTION_KEY_COUNT).fill('none') },
      new Array(ACTION_KEY_COUNT).fill('see-spec'),
    );
    expect(result['creator-micro-2'].every((id) => id === 'none')).toBe(true);
  });

  it('preserves a persisted assignment on the Codex linked-pair slot', () => {
    const result = normalizeActionMappingsByModel({
      'codex-micro': new Array(ACTION_KEY_COUNT).fill('new-agent'),
    });
    expect(result['codex-micro'][CODEX_MIC_LINKED_SLOT]).toBe('new-agent');
  });

  it('repairs garbage records to full defaults', () => {
    expect(normalizeActionMappingsByModel('bogus')).toEqual(normalizeActionMappingsByModel(undefined));
    expect(normalizeActionMappingsByModel([1, 2, 3])).toEqual(
      normalizeActionMappingsByModel(undefined),
    );
  });
});

describe('migrateLegacyCm2DefaultActionMapping', () => {
  it('upgrades a CM2 mapping still equal to the oldest (pre-attention) defaults', () => {
    const mappings = normalizeActionMappingsByModel({
      'creator-micro-2': [...LEGACY_CM2_DEFAULT_ACTION_MAPPING],
    });
    expect(migrateLegacyCm2DefaultActionMapping(mappings)).toBe(true);
    expect(mappings['creator-micro-2']).toEqual([
      ...DEFAULT_ACTION_MAPPINGS['creator-micro-2'],
    ]);
  });

  it('upgrades a CM2 mapping still equal to the previous (cycle-workspace) defaults', () => {
    const mappings = normalizeActionMappingsByModel({
      'creator-micro-2': [...PREVIOUS_CM2_DEFAULT_ACTION_MAPPING],
    });
    expect(migrateLegacyCm2DefaultActionMapping(mappings)).toBe(true);
    expect(mappings['creator-micro-2']).toEqual([
      ...DEFAULT_ACTION_MAPPINGS['creator-micro-2'],
    ]);
  });

  it('leaves a customized CM2 mapping untouched', () => {
    for (const priorDefaults of [
      LEGACY_CM2_DEFAULT_ACTION_MAPPING,
      PREVIOUS_CM2_DEFAULT_ACTION_MAPPING,
    ]) {
      const customized = [...priorDefaults];
      customized[0] = 'stop-agent';
      const mappings = normalizeActionMappingsByModel({ 'creator-micro-2': customized });
      expect(migrateLegacyCm2DefaultActionMapping(mappings)).toBe(false);
      expect(mappings['creator-micro-2']).toEqual(customized);
    }
  });

  it('is a no-op on the current defaults and never touches the Codex entry', () => {
    const mappings = normalizeActionMappingsByModel(undefined);
    expect(migrateLegacyCm2DefaultActionMapping(mappings)).toBe(false);
    expect(mappings).toEqual(normalizeActionMappingsByModel(undefined));
  });
});

describe('isActionKeyActionId', () => {
  it('accepts catalog ids and rejects everything else', () => {
    expect(isActionKeyActionId('stop-agent')).toBe(true);
    expect(isActionKeyActionId('none')).toBe(true);
    expect(isActionKeyActionId('bogus')).toBe(false);
    expect(isActionKeyActionId(3)).toBe(false);
  });
});
