import { describe, expect, it } from 'vitest';
import { canArchiveScript, historyNeedsAttention, searchScripts } from './script-history';
import { makeScriptHistoryFixture } from '../components/script-history-fixture';

describe('script history policy', () => {
  it('selects only the 984 inactive commands in the 1,003-entry fixture', () => {
    const scripts = makeScriptHistoryFixture();
    expect(scripts).toHaveLength(1003);
    expect(scripts.filter(canArchiveScript)).toHaveLength(984);
    for (const status of ['running', 'starting', 'restarting', 'future-state']) {
      expect(
        canArchiveScript({ ...scripts[0], runtime: { status: status as never, restartCount: 0 } }),
      ).toBe(false);
    }
    expect(canArchiveScript({ ...scripts[0], archivedAt: '2026-09-30T00:00:00Z' })).toBe(false);
  });
  it('searches diagnostic text and signals all non-success outcomes without output', () => {
    const script = makeScriptHistoryFixture()[0];
    expect(historyNeedsAttention(script)).toBe(false);
    for (const outcome of ['failed', 'interrupted', 'cancelled'] as const) {
      const archived = {
        ...script,
        archivedAt: '2026-09-30T00:00:00Z',
        lastRun: { outcome, stoppedAt: '2026-09-30T00:00:00Z', error: 'Lost during restart' },
      };
      expect(historyNeedsAttention(archived)).toBe(true);
      expect(searchScripts([archived], 'LOST restart')).toEqual([archived]);
    }
  });
});
