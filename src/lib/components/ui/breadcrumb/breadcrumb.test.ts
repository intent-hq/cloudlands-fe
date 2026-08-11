// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import BreadcrumbHarness from './BreadcrumbHarness.svelte';
import * as breadcrumbApi from './index';

describe('Breadcrumb', () => {
  it('exposes navigation, ordered-path, link, current-page, and decorative ellipsis semantics', () => {
    const { getByRole, getByTestId } = render(BreadcrumbHarness);
    const navigation = getByRole('navigation', { name: 'Project path' });
    expect(navigation.querySelector('ol')).not.toBeNull();
    expect(getByRole('link', { name: 'Projects' }).getAttribute('href')).toBe('/projects');
    const current = navigation.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('Navigation and help component documentation');
    expect(current?.getAttribute('aria-disabled')).toBe('true');
    const ellipsis = getByTestId('breadcrumb-ellipsis');
    expect(ellipsis.getAttribute('aria-hidden')).toBe('true');
    expect(ellipsis.getAttribute('role')).toBe('presentation');
  });

  it('contains long paths without wrapping or shrinking structural separators', () => {
    const { container, getByRole, getByTestId } = render(BreadcrumbHarness);
    const navigation = getByRole('navigation', { name: 'Project path' });
    const list = container.querySelector('ol');
    expect(navigation.className).toContain('w-full');
    expect(navigation.className).toContain('overflow-hidden');
    expect(list?.className).toContain('overflow-hidden');
    expect(list?.className).toContain('whitespace-nowrap');
    expect(list?.className).toContain('type-body');
    expect(container.querySelector('[aria-current="page"]')?.className).toContain('truncate');
    expect(getByTestId('breadcrumb-ellipsis').className).toContain('shrink-0');
    expect(getByTestId('breadcrumb-ellipsis').className).toContain('h-8');
    expect(getByTestId('breadcrumb-boundary').className).toContain('max-w-64');
  });

  it('uses the canonical semantic focus treatment for interactive path segments', () => {
    const { getByRole } = render(BreadcrumbHarness);
    const link = getByRole('link', { name: 'Projects' });
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('focus-visible:ring-ring/40');
    expect(link.className).toContain('motion-reduce:transition-none');
  });

  it('publishes parseable metadata, fixtures, and the complete public barrel', () => {
    expect(() => parseUiComponentMetadata(breadcrumbApi.breadcrumbMetadata)).not.toThrow();
    expect(breadcrumbApi.breadcrumbFixtures[0].states).toEqual(
      expect.arrayContaining([
        'navigation',
        'current-page',
        'ellipsis',
        'long-content',
        'no-overflow',
      ]),
    );
    expect(Object.keys(breadcrumbApi).sort()).toEqual(
      [...breadcrumbApi.breadcrumbMetadata.exports].sort(),
    );
  });
});
