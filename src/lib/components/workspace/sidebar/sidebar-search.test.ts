import { describe, expect, it } from 'vitest';
import type { ContextItem } from '$features/context/types';
import type { Note } from '$shared/types';
import {
  filterContextItems,
  filterContextNotes,
  normalizeSidebarSearchText,
} from './sidebar-search';

function note(id: string, title: string, content: string, parentId?: string): Note {
  return { id, title, content, parentId } as Note;
}

describe('sidebar context search', () => {
  it('normalizes case and diacritics', () => {
    expect(normalizeSidebarSearchText('Crème BRÛLÉE')).toBe('creme brulee');
  });

  it('matches note title and body while preserving canonical order and ancestors', () => {
    const notes = [
      note('root', 'Planning', 'Overview'),
      note('child', 'Résumé', 'Accessibility details', 'root'),
      note('later', 'Later', 'Unrelated'),
    ];

    expect(filterContextNotes(notes, 'resume').map(({ id }) => id)).toEqual(['root', 'child']);
    expect(filterContextNotes(notes, 'ACCESSIBILITY').map(({ id }) => id)).toEqual([
      'root',
      'child',
    ]);
  });

  it('matches context display title and searchable subtitle text without reordering', () => {
    const items = [
      {
        id: 'linear',
        type: 'linear-issue',
        provider: 'linear',
        title: 'Résumé polish',
        identifier: 'ENG-123',
      },
      {
        id: 'browser',
        type: 'browser-url',
        provider: 'browser',
        title: 'Local preview',
        url: 'https://example.test/cafe',
      },
    ] as ContextItem[];

    expect(filterContextItems(items, 'résumé').map(({ id }) => id)).toEqual(['linear']);
    expect(filterContextItems(items, 'eng-123').map(({ id }) => id)).toEqual(['linear']);
    expect(filterContextItems(items, 'CAFE').map(({ id }) => id)).toEqual(['browser']);
    expect(filterContextItems(items, 'missing')).toEqual([]);
  });
});
