/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Badge from './badge.svelte';
import { badgeFixtures } from './badge.fixtures';
import { badgeMetadata } from './badge.meta';
import BadgeHarness from './BadgeHarness.svelte';

describe('Badge', () => {
  it.each([
    ['default', 'solid', 'gray'],
    ['secondary', 'solid', 'gray'],
    ['outline', 'dot', 'gray'],
    ['destructive', 'solid', 'red'],
    ['success', 'solid', 'green'],
    ['info', 'solid', 'blue'],
  ] as const)('maps the legacy %s variant', (variant, expectedVariant, expectedColor) => {
    const { container } = render(Badge, { props: { variant } });
    const badge = container.querySelector('[data-slot="badge"]')!;
    expect(badge.getAttribute('data-variant')).toBe(expectedVariant);
    expect(badge.getAttribute('data-color')).toBe(expectedColor);
    expect(Boolean(badge.querySelector('[data-slot="badge-dot"]'))).toBe(expectedVariant === 'dot');
  });

  it('lets explicit color override a legacy semantic color', () => {
    const { container } = render(Badge, {
      props: { variant: 'success', color: 'violet', size: 'sm' },
    });
    const badge = container.querySelector('[data-slot="badge"]')!;
    expect(badge.getAttribute('data-color')).toBe('violet');
    expect(badge.getAttribute('data-size')).toBe('compact');
  });

  it('renders optional leading affordances and removes after its exit', async () => {
    const { getByLabelText, getByTestId } = render(BadgeHarness);
    const badge = getByTestId('removable-badge');
    expect(badge.querySelector('[data-slot="badge-dot"]')).not.toBeNull();
    expect(getByLabelText('Shield icon')).toBeTruthy();
    const remove = getByLabelText('Remove status');
    expect(remove.className).toContain('size-4');
    expect(remove.className).toContain('rounded-full');
    expect(remove.className).toContain('border-0');

    await fireEvent.click(remove);
    await waitFor(() => expect(screen.getByLabelText('Badge removed').textContent).toBe('true'));
    expect(screen.queryByTestId('removable-badge')).toBeNull();
  });

  it('preserves span and anchor behavior', () => {
    const { unmount } = render(Badge, { props: { 'aria-label': 'Stable' } });
    expect(screen.getByLabelText('Stable').tagName).toBe('SPAN');
    unmount();

    render(Badge, { props: { 'aria-label': 'Release', href: '/release' } });
    expect(screen.getByRole('link', { name: 'Release' }).getAttribute('href')).toBe('/release');
  });

  it('publishes catalog metadata', () => {
    expect(badgeMetadata.characterizationTest).toBe('src/lib/components/ui/badge/badge.test.ts');
    expect(badgeFixtures.flatMap((fixture) => fixture.states)).toContain('long-label');
    expect(badgeFixtures.flatMap((fixture) => fixture.states)).toEqual(
      expect.arrayContaining([
        'outline',
        'destructive',
        'success-ring-dot',
        'info-ring-dot',
        'leading-icon',
        'removable',
        'dark',
      ]),
    );
  });
});
