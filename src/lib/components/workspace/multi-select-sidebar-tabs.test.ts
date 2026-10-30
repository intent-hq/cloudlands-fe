import { describe, expect, it } from 'vitest';
import { getNextSelectedTabs, normalizeSelectedTabs } from './multi-select-sidebar-tabs';

describe('multi-select sidebar tabs', () => {
  it('keeps every valid stacked section and migrates the old overview to agents', () => {
    expect([...normalizeSelectedTabs(['unknown', 'changes', 'files'])]).toEqual([
      'changes',
      'files',
    ]);
    expect([...normalizeSelectedTabs(['browser', 'shell'])]).toEqual(['browser', 'shell']);
    expect([...normalizeSelectedTabs(['overview', 'context'])]).toEqual(['context']);
    expect([...normalizeSelectedTabs(['unknown'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['overview'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs([])]).toEqual(['agents']);
  });

  it('drops persisted browser and shell selections for collaborators (multiplayer w3)', () => {
    expect([...normalizeSelectedTabs(['browser', 'shell'], true)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['shell', 'files'], true)]).toEqual(['files']);
    expect([...normalizeSelectedTabs(['browser', 'shell'], false)]).toEqual(['browser', 'shell']);
  });

  it('allows People for collaborators and drops it when sharing is unavailable', () => {
    expect([...normalizeSelectedTabs(['people'], true, true)]).toEqual(['people']);
    expect([...normalizeSelectedTabs(['people'], false, false)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['people', 'context'], true, false)]).toEqual(['context']);
  });

  describe('getNextSelectedTabs', () => {
    it('selects only the clicked section on a plain click', () => {
      expect(getNextSelectedTabs(['agents', 'context'], 'files', false)).toEqual(['files']);
      expect(getNextSelectedTabs(['agents', 'context'], 'context', false)).toEqual(['context']);
    });

    it('adds a section on a modifier click', () => {
      expect(getNextSelectedTabs(['agents'], 'changes', true)).toEqual(['agents', 'changes']);
    });

    it('removes a stacked section on a modifier click but keeps the last one open', () => {
      expect(getNextSelectedTabs(['agents', 'changes'], 'agents', true)).toEqual(['changes']);
      expect(getNextSelectedTabs(['changes'], 'changes', true)).toEqual(['changes']);
    });
  });
});

it('keeps a Manager saved-script Shell selection while still stripping Browser', () => {
  expect([...normalizeSelectedTabs(['shell'], true, true, true)]).toEqual(['shell']);
  expect([...normalizeSelectedTabs(['browser'], true, true, true)]).toEqual(['agents']);
  expect([...normalizeSelectedTabs(['shell'], true, true, false)]).toEqual(['agents']);
});
