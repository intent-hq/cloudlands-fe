// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import CardHarness from './CardHarness.svelte';
import { cardFixtures } from './card.fixtures';
import { cardMetadata } from './card.meta';
import * as cardApi from './index';

describe('Card', () => {
  it('renders structured editorial slots with a quiet canonical surface', () => {
    const { container, getByRole } = render(CardHarness);
    const card = getByRole('generic', { name: 'Editorial card' });
    expect(card.getAttribute('data-surface-level')).toBe('2');
    expect(container.querySelector('[data-slot="card-header"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="card-title"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="card-content"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="card-description"]')).toBeNull();
    expect(container.querySelector('[data-slot="card-action"]')).toBeNull();
    expect(container.querySelector('[data-slot="card-footer"]')).toBeNull();
  });

  it('offers an opt-in interactive surface without changing static cards', async () => {
    const { getByRole, getByLabelText } = render(CardHarness);
    const interactive = getByRole('button', { name: 'Interactive card' });
    const editorial = getByRole('generic', { name: 'Editorial card' });
    expect(interactive.getAttribute('data-interactive')).toBe('true');
    expect(editorial.getAttribute('data-interactive')).toBeNull();
    await fireEvent.click(interactive);
    expect(getByLabelText('Card activations').textContent).toBe('1');
  });

  it('keeps an explicitly inert surface non-interactive without adding decoration', () => {
    const { getByRole } = render(CardHarness);
    const card = getByRole('generic', { name: 'Editorial card' });
    const inert = getByRole('generic', { name: 'Inert card' });
    expect(card.getAttribute('style')).toBeNull();
    expect(inert.getAttribute('style')).toBeNull();
    expect(inert.getAttribute('inert')).not.toBeNull();
  });

  it('lets nested content opt out of wrapper padding and apply the canonical inset', () => {
    const { getByRole } = render(CardHarness);
    const card = getByRole('generic', { name: 'Flush content card' });
    const content = card.querySelector('[data-slot="card-content"]');

    expect(content?.getAttribute('data-flush')).toBe('true');
  });

  it('publishes complete host-independent metadata and responsive fixtures', () => {
    expect(() => parseUiComponentMetadata(cardMetadata)).not.toThrow();
    expect(Object.keys(cardApi).sort()).toEqual([...cardMetadata.exports].sort());
    expect(cardFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining([
        'interactive',
        'flush-content',
        'pressed',
        'long-content',
        'compact',
        'zoom-200',
        'inert',
      ]),
    );
    expect(cardFixtures.flatMap(({ states }) => states)).not.toEqual(
      expect.arrayContaining(['metadata', 'action', 'footer']),
    );
  });
});
