// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import AccordionHarness from './AccordionHarness.svelte';
import { accordionMetadata } from './accordion.meta';

afterEach(cleanup);

describe('Accordion', () => {
  it('supports single disclosure with one expanded item', async () => {
    const { getByRole } = render(AccordionHarness);
    const first = getByRole('button', { name: 'First section' });
    const second = getByRole('button', { name: 'Second section' });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('supports multiple independently expanded items', async () => {
    const { getByRole } = render(AccordionHarness, { props: { multiple: true } });
    const first = getByRole('button', { name: 'First section' });
    const second = getByRole('button', { name: 'Second section' });
    await fireEvent.click(first);
    await fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps content mounted and delegates panel height to animatedHeight', () => {
    const { getByText } = render(AccordionHarness);
    const firstPanel = getByText('First panel').closest('[data-accordion-content]') as HTMLElement;
    const secondPanel = getByText('Second panel').closest(
      '[data-accordion-content]',
    ) as HTMLElement;
    expect(firstPanel?.style.overflow).toBe('clip');
    expect(secondPanel?.style.height).toBe('0px');
  });

  it('publishes catalog metadata for both selection modes and reduced motion', () => {
    expect(() => parseUiComponentMetadata(accordionMetadata)).not.toThrow();
    expect(accordionMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining(['single', 'multiple', 'reduced-motion']),
    );
  });
});
