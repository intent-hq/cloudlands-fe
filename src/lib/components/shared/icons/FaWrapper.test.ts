import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
import GithubLogoIcon from 'phosphor-svelte/lib/GithubLogoIcon';
import AppleLogoIcon from 'phosphor-svelte/lib/AppleLogoIcon';
import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
import * as compatibilityIcons from '$lib/icons/phosphor-icons';
import {
  faApple,
  faCheck,
  faCopy,
  faFont,
  faGithub,
  faSettings,
  faXmark,
} from '$lib/icons/phosphor-icons';
import FaWrapper from './FaWrapper.svelte';

afterEach(cleanup);

describe('Phosphor icon compatibility renderer', () => {
  it('defaults every exported non-brand compatibility mapping to regular', () => {
    const definitions = Object.entries(compatibilityIcons).filter(
      ([name, value]) => name.startsWith('fa') && typeof value === 'object',
    );
    expect(definitions.length).toBeGreaterThan(100);
    for (const [, value] of definitions) {
      if (typeof value !== 'object' || !('iconName' in value))
        throw new Error('Invalid icon definition');
      const expected = ['apple', 'github'].includes(value.iconName) ? 'bold' : 'regular';
      expect(compatibilityIcons.getPhosphorIconWeight(value), value.iconName).toBe(expected);
    }
  });

  it('renders a Phosphor component with the existing size and pulse API', async () => {
    const result = render(FaWrapper, {
      props: { icon: faCheck, size: 20, pulse: true, title: 'Complete' },
    });

    const icon = result.container.querySelector('svg');
    expect(icon?.getAttribute('data-icon')).toBe('check');
    expect(icon?.getAttribute('width')).toBe('20px');
    expect(icon?.getAttribute('height')).toBe('20px');
    expect(icon?.getAttribute('class')).toContain('animate-pulse');
    expect(icon?.getAttribute('aria-label')).toBe('Complete');
    expect(icon?.getAttribute('data-weight')).toBe('regular');

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

describe('Fa optional icon weight', () => {
  it('matches native regular glyphs and restores the default after removing an override', async () => {
    const { container, rerender } = render(FaWrapper, { props: { icon: faCopy, title: 'Copy' } });
    const native = render(CopyIcon, { props: { weight: 'regular' } });
    const svg = () => container.querySelector('svg')!;
    const paths = () => [...svg().querySelectorAll('path')].map((path) => path.getAttribute('d'));
    const regularPaths = [...native.container.querySelectorAll('path')].map((path) =>
      path.getAttribute('d'),
    );
    expect(svg().getAttribute('data-weight')).toBe('regular');
    expect(paths()).toEqual(regularPaths);

    await rerender({ weight: 'fill' });
    expect(svg().getAttribute('data-weight')).toBe('fill');
    expect(paths()).not.toEqual(regularPaths);
    expect(svg().getAttribute('aria-label')).toBe('Copy');

    await rerender({ weight: undefined });
    expect(svg().getAttribute('data-weight')).toBe('regular');
    expect(paths()).toEqual(regularPaths);
  });

  it.each([
    { icon: faGithub, nativeIcon: GithubLogoIcon },
    { icon: faApple, nativeIcon: AppleLogoIcon },
  ])('preserves the $icon.iconName brand silhouette', async ({ icon, nativeIcon }) => {
    const { container, rerender } = render(FaWrapper, { props: { icon } });
    const native = render(nativeIcon, { props: { weight: 'bold' } });
    expect(container.querySelector('svg')?.innerHTML).toBe(
      native.container.querySelector('svg')?.innerHTML,
    );
    await rerender({ icon: faCopy });
    expect(container.querySelector('svg')?.getAttribute('data-weight')).toBe('regular');
  });

  it('renders unknown compatibility names with the regular fallback', () => {
    const { container } = render(FaWrapper, { props: { icon: { iconName: 'unknown-icon' } } });
    const native = render(QuestionIcon, { props: { weight: 'regular' } });
    expect(container.querySelector('svg')?.innerHTML).toBe(
      native.container.querySelector('svg')?.innerHTML,
    );
  });

  it('retains legacy duotone selection unless weight is explicitly provided', async () => {
    const { container, rerender } = render(FaWrapper, {
      props: { icon: faCopy, secondaryOpacity: 0.5 },
    });
    const svg = () => container.querySelector('svg')!;
    expect(svg().getAttribute('data-weight')).toBe('duotone');

    await rerender({ weight: 'regular' });
    expect(svg().getAttribute('data-weight')).toBe('regular');
    await rerender({ weight: undefined });
    expect(svg().getAttribute('data-weight')).toBe('duotone');
    await rerender({ secondaryOpacity: undefined });
    expect(svg().getAttribute('data-weight')).toBe('regular');
  });
});
