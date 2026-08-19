import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NoteContentSurface, { type NoteContentState } from '../NoteContentSurface.svelte';

const states: NoteContentState[] = [
  'editor',
  'loading',
  'empty',
  'missing',
  'read-only',
  'recent-note',
];

describe('NoteContentSurface', () => {
  afterEach(cleanup);

  it.each(states)('owns the canonical note background for %s', (state) => {
    const { container } = render(NoteContentSurface, { props: { state } });
    const surface = container.querySelector('[data-note-content-surface]');

    expect(surface?.getAttribute('data-note-content-state')).toBe(state);
    for (const className of [
      'h-full',
      'min-h-0',
      'w-full',
      'min-w-0',
      'bg-background',
      'text-foreground',
    ]) {
      expect(surface?.classList.contains(className)).toBe(true);
    }
  });
});
