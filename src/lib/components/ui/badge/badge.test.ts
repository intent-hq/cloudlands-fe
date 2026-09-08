/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Badge from './badge.svelte';
import { badgeFixtures } from './badge.fixtures';
import { badgeMetadata } from './badge.meta';
import { badgeVariants } from './badge.variants';

describe('Badge', () => {
  it('owns one semantic variant recipe', () => {
    const sources = ['badge.svelte', 'index.ts', 'badge.variants.ts'].map((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    );
    const source = sources.join('\n');
    expect(source.match(/\btv\(/g)).toHaveLength(1);
    expect(source.match(/export type BadgeVariant\b/g)).toHaveLength(1);
    expect(source.match(/export type BadgeProps\b/g)).toHaveLength(1);
    expect(badgeVariants({ variant: 'secondary' })).toContain('bg-muted');
    expect(badgeVariants({ variant: 'destructive' })).toContain('text-danger');
    expect(badgeVariants({ variant: 'destructive' })).not.toContain('text-white');
    expect(badgeVariants({ variant: 'success' })).toContain('before:bg-success');
    expect(badgeVariants({ variant: 'info' })).toContain('before:bg-info');
    expect(badgeVariants({ variant: 'outline' })).toContain('bg-card');
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
        'dark',
      ]),
    );
  });
});
