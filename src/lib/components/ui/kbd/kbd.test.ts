// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import KbdHarness from './KbdHarness.svelte';
import { kbdFixtures } from './kbd.fixtures';
import { kbdMetadata } from './kbd.meta';
import * as kbdApi from './index';

describe('ShortcutChip', () => {
  it('renders shortcut content as semantic UI-font keyboard hints', () => {
    const { container } = render(KbdHarness);
    const chips = container.querySelectorAll('kbd[data-slot="shortcut-chip"]');

    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe('⌘');
    expect(chips[1].textContent).toBe('Enter');
    expect(chips[0].style.fontFamily).toBe('var(--font-ui)');
    expect(chips[1].classList.contains('custom-chip')).toBe(true);
  });

  it('publishes complete metadata and fixtures', () => {
    expect(Object.keys(kbdApi).sort()).toEqual([...kbdMetadata.exports].sort());
    expect(kbdFixtures.flatMap((fixture) => fixture.states)).toEqual(
      expect.arrayContaining(['single-key', 'modifier', 'key-sequence', 'long-key', 'dark']),
    );
  });
});
