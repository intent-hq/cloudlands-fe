import { describe, expect, it } from 'vitest';
import {
  addPalettePick,
  getPalettePickWeights,
  MAX_PALETTE_PICKS,
  normalizePalettePickQuery,
  normalizePalettePicks,
  PALETTE_PICK_FADE_MS,
  palettePickFade,
  type PalettePick,
} from './palette-pick-memory';
import { getPaletteMruEntries, getPalettePicks } from './palette-normalization';
import {
  initialState,
  paletteReducer,
  recordPaletteMruItem,
  recordPalettePick,
} from './palette-slice';

const NOW = Date.UTC(2026, 10, 8);
const DAY = 24 * 60 * 60 * 1000;

const pick = (query: string, itemKey: string, timestamp = NOW): PalettePick => ({
  query,
  itemKey,
  timestamp,
});

describe('palette pick memory', () => {
  it('normalizes queries so case and spacing do not split memory', () => {
    expect(normalizePalettePickQuery('  New   Work ')).toBe('new work');
  });

  it('keeps only the latest item picked for one query', () => {
    let picks = addPalettePick([], pick('ag', 'agent:a', NOW - 10));
    picks = addPalettePick(picks, pick('AG', 'agent:b', NOW));
    expect(picks).toEqual([pick('ag', 'agent:b', NOW)]);
  });

  it('ignores picks for an empty query', () => {
    expect(addPalettePick([], pick('   ', 'agent:a'))).toEqual([]);
  });

  it('trims to the newest pairs at the cap', () => {
    let picks: PalettePick[] = [];
    for (let index = 0; index < MAX_PALETTE_PICKS + 5; index += 1) {
      picks = addPalettePick(picks, pick(`q${index}`, `note:${index}`, NOW + index));
    }
    expect(picks).toHaveLength(MAX_PALETTE_PICKS);
    expect(picks[0].query).toBe(`q${MAX_PALETTE_PICKS + 4}`);
    expect(picks.some((entry) => entry.query === 'q0')).toBe(false);
  });

  it('fades linearly to zero over the fade window', () => {
    expect(palettePickFade(NOW, NOW)).toBe(1);
    expect(palettePickFade(NOW - PALETTE_PICK_FADE_MS / 2, NOW)).toBeCloseTo(0.5);
    expect(palettePickFade(NOW - PALETTE_PICK_FADE_MS, NOW)).toBe(0);
    expect(palettePickFade(NOW + DAY, NOW)).toBe(1);
  });

  it('splits weights into the exact query and related prefix queries', () => {
    const picks = [
      pick('ag', 'agent:exact', NOW - 15 * DAY),
      pick('agent av', 'agent:longer', NOW),
      pick('a', 'agent:shorter', NOW - DAY),
      pick('agx', 'agent:extends', NOW),
      pick('zz', 'note:unrelated', NOW),
      pick('agent', 'agent:longer', NOW - 20 * DAY),
      pick('old', 'agent:expired', NOW - 31 * DAY),
    ];
    const weights = getPalettePickWeights(picks, ' AG', NOW);
    expect([...weights.exact.keys()]).toEqual(['agent:exact']);
    expect(weights.exact.get('agent:exact')).toBeCloseTo(0.5);
    expect(weights.related.get('agent:longer')).toBe(1);
    expect(weights.related.has('agent:shorter')).toBe(true);
    expect(weights.related.has('agent:extends')).toBe(true);
    expect(weights.related.has('note:unrelated')).toBe(false);
    expect(weights.related.has('agent:exact')).toBe(false);
    expect(getPalettePickWeights(picks, 'old', NOW).exact.size).toBe(0);
    expect(getPalettePickWeights(picks, '  ', NOW)).toEqual({
      exact: new Map(),
      related: new Map(),
    });
  });

  it('drops invalid and expired stored entries', () => {
    expect(
      normalizePalettePicks(
        [
          pick('ok', 'note:a', NOW),
          { query: '', itemKey: 'note:b', timestamp: NOW },
          { query: 'x', itemKey: '', timestamp: NOW },
          { query: 'x', itemKey: 'note:c', timestamp: Number.NaN },
          pick('old', 'note:d', NOW - PALETTE_PICK_FADE_MS),
        ],
        NOW,
      ),
    ).toEqual([pick('ok', 'note:a', NOW)]);
  });
});

describe('palette memory reducer', () => {
  it('records a pick with its item key', () => {
    const state = paletteReducer(initialState, recordPalettePick('Cloudl', 'repo:r1', NOW));
    expect(getPalettePicks(state)).toEqual([pick('cloudl', 'repo:r1', NOW)]);
  });

  it('keeps commands and workspaces in recent items without pushing out agents and notes', () => {
    let state = paletteReducer(initialState, recordPaletteMruItem('agent', 'a1', NOW - 1));
    state = paletteReducer(state, recordPaletteMruItem('note', 'n1', NOW - 2));
    for (let index = 0; index < 60; index += 1) {
      state = paletteReducer(state, recordPaletteMruItem('command', `c${index}`, NOW + index));
      state = paletteReducer(state, recordPaletteMruItem('workspace', `w${index}`, NOW + index));
    }
    const keys = getPaletteMruEntries(state).map((entry) => `${entry.type}:${entry.id}`);
    expect(keys).toContain('agent:a1');
    expect(keys).toContain('note:n1');
  });
});
