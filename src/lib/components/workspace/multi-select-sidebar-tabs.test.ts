import { describe, expect, it } from 'vitest';
import { normalizeSelectedTabs } from './multi-select-sidebar-tabs';

describe('multi-select sidebar tabs', () => {
  it('keeps the first valid selection and migrates the old overview to agents', () => {
    expect([...normalizeSelectedTabs(['unknown', 'changes', 'files'])]).toEqual(['changes']);
    expect([...normalizeSelectedTabs(['browser', 'shell'])]).toEqual(['browser']);
    expect([...normalizeSelectedTabs(['unknown'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['overview'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs([])]).toEqual(['agents']);
  });

  it('drops persisted browser and shell selections for collaborators (multiplayer w3)', () => {
    expect([...normalizeSelectedTabs(['browser', 'shell'], true)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['shell', 'files'], true)]).toEqual(['files']);
    expect([...normalizeSelectedTabs(['browser', 'shell'], false)]).toEqual(['browser']);
  });

  it('allows People for collaborators and drops it when sharing is unavailable', () => {
    expect([...normalizeSelectedTabs(['people'], true, true)]).toEqual(['people']);
    expect([...normalizeSelectedTabs(['people'], false, false)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['people', 'context'], true, false)]).toEqual(['context']);
  });
});

it('keeps a Manager saved-script Shell selection while still stripping Browser', () => {
  expect([...normalizeSelectedTabs(['shell'], true, true, true)]).toEqual(['shell']);
  expect([...normalizeSelectedTabs(['browser'], true, true, true)]).toEqual(['agents']);
  expect([...normalizeSelectedTabs(['shell'], true, true, false)]).toEqual(['agents']);
});
