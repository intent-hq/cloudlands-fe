/**
 * Note chips in the composer show the note's live title while `data-label`
 * keeps the saved title (the composer's renderText, which serializes the sent
 * token from attrs, is unchanged by this behaviour).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock('$lib/utils/store-note-title-lookup', () => ({
  storeNoteTitleLookup: (ws: string, id: string) =>
    ws === 'ws-1' && id === 'n1' ? 'Renamed meeting' : undefined,
}));

import TipTapEditor from '../TipTapEditor.svelte';

async function mountEditor(props: Record<string, unknown>) {
  const result = render(TipTapEditor, { props });
  for (let i = 0; i < 50; i++) {
    if (result.container.querySelector('.tiptap-editor [data-type="note"]')) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await tick();
  return result;
}

describe('TipTapEditor note chip labels', () => {
  afterEach(() => cleanup());

  it('shows the live title on a restored note chip', async () => {
    const { container } = await mountEditor({
      value: 'see @note[n1:Old meeting] now',
      workspace: { id: 'ws-1' },
    });
    const chip = container.querySelector('.tiptap-editor [data-type="note"]');
    expect(chip?.textContent).toBe('Renamed meeting');
    expect(chip?.getAttribute('data-label')).toBe('Old meeting');
  });
});
