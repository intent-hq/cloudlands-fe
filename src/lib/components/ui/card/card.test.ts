// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import CardHarness from './CardHarness.svelte';
import { cardFixtures } from './card.fixtures';
import { cardMetadata } from './card.meta';

describe('Card', () => {
  it('renders structured editorial slots with a quiet canonical surface', () => {
    const { container, getByRole, getByText } = render(CardHarness);
    const card = getByRole('generic', { name: 'Editorial card' });
    expect(card.className).toContain('rounded-(--radius-medium)');
    expect(card.className).toContain('border-border');
    expect(card.className).toContain('bg-card');
    expect(card.className).toContain('shadow-(--elevation-raised)');
    expect(container.querySelector('[data-slot="card-header"]')?.className).toContain('border-b');
    expect(container.querySelector('[data-slot="card-title"]')?.className).toContain('type-body');
    expect(container.querySelector('[data-slot="card-content"]')?.className).toContain('type-body');
    expect(container.querySelector('[data-slot="card-footer"]')?.className).toContain(
      'type-caption',
    );
    expect(getByText('Manage').closest('[data-slot="card-action"]')).toBeTruthy();
  });

  it('uses the shared hatch only for an explicitly inert surface', () => {
    const { getByRole } = render(CardHarness);
    const card = getByRole('generic', { name: 'Editorial card' });
    const inert = getByRole('generic', { name: 'Inert card' });
    expect(card.getAttribute('style')).toBeNull();
    expect(inert.getAttribute('style')).toContain('var(--surface-hatch)');
    expect(inert.getAttribute('inert')).not.toBeNull();
  });

  it('publishes complete host-independent metadata and responsive fixtures', () => {
    expect(() => parseUiComponentMetadata(cardMetadata)).not.toThrow();
    expect(cardFixtures.flatMap(({ states }) => states)).toEqual(
      expect.arrayContaining(['long-content', 'compact', 'zoom-200', 'inert-hatch']),
    );
  });
});
