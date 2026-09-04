import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { faCheck, faFont, faSettings, faXmark } from '$lib/icons/phosphor-icons';
import FaWrapper from './FaWrapper.svelte';

describe('Phosphor icon compatibility renderer', () => {
  it('renders a Phosphor component with the existing size and animation API', async () => {
    const result = render(FaWrapper, {
      props: { icon: faCheck, size: 20, spin: true, title: 'Complete' },
    });

    const icon = result.container.querySelector('svg');
    expect(icon?.getAttribute('data-icon')).toBe('check');
    expect(icon?.getAttribute('width')).toBe('20px');
    expect(icon?.getAttribute('height')).toBe('20px');
    expect(icon?.getAttribute('class')).toContain('animate-spin');
    expect(icon?.getAttribute('aria-label')).toBe('Complete');
    expect(icon?.getAttribute('data-weight')).toBe('bold');

    await result.rerender({ icon: faXmark, size: 'sm' });
    expect(result.container.querySelector('svg')?.getAttribute('data-icon')).toBe('xmark');
    expect(result.container.querySelector('svg')?.getAttribute('width')).toBe('0.875em');
  });

  it('renders the custom settings export as a gear instead of the fallback', () => {
    const result = render(FaWrapper, { props: { icon: faSettings } });

    expect(result.container.querySelector('svg')?.getAttribute('data-icon')).toBe('gear');
  });

  it('renders the font-style export instead of the fallback', () => {
    const result = render(FaWrapper, { props: { icon: faFont } });

    expect(result.container.querySelector('svg')?.getAttribute('data-icon')).toBe('font');
  });
});
