import { describe, it, expect } from 'vitest';
import { contextNoteIds } from './context-note-ids';
import type { PanelContextItem } from './multi-panel-context-slice';

function panel(overrides: Partial<PanelContextItem>): PanelContextItem {
  return {
    id: overrides.id ?? 'tab-1',
    panelId: 'main',
    tabId: overrides.id ?? 'tab-1',
    type: 'note',
    label: 'Walkthrough',
    checked: false,
    ...overrides,
  };
}

describe('contextNoteIds', () => {
  it('returns the id of a checked note', () => {
    expect(contextNoteIds([panel({ noteId: 'note-a', checked: true })])).toEqual(['note-a']);
  });

  it('returns undefined when the open note is unchecked', () => {
    expect(contextNoteIds([panel({ noteId: 'note-a', checked: false })])).toBeUndefined();
  });

  it('returns spec when the spec is checked', () => {
    expect(contextNoteIds([panel({ type: 'spec', noteId: 'spec', checked: true })])).toEqual([
      'spec',
    ]);
  });

  it('ignores non-note panels and notes without an id', () => {
    expect(
      contextNoteIds([
        panel({ id: 'f', type: 'file', filePath: 'a.ts', checked: true }),
        panel({ id: 'b', type: 'browser', browserUrl: 'https://x.dev', checked: true }),
        panel({ id: 'n', type: 'note', checked: true }),
      ]),
    ).toBeUndefined();
  });

  it('keeps checked notes in order and drops duplicates', () => {
    expect(
      contextNoteIds([
        panel({ id: 't1', noteId: 'note-a', checked: true }),
        panel({ id: 't2', noteId: 'note-b', checked: false }),
        panel({ id: 't3', noteId: 'note-c', checked: true }),
        panel({ id: 'search-a', panelId: 'search', noteId: 'note-a', checked: true }),
      ]),
    ).toEqual(['note-a', 'note-c']);
  });
});
