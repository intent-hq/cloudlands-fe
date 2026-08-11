/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ButtonGroup from './button-group.svelte';
import { buttonGroupFixtures } from './button-group.fixtures';
import { buttonGroupMetadata } from './button-group.meta';
import { buttonGroupVariants } from './button-group.variants';

describe('ButtonGroup', () => {
  it('owns one orientation recipe and exposes group semantics', () => {
    const sources = ['button-group.svelte', 'index.ts', 'button-group.variants.ts'].map((file) =>
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    );
    const source = sources.join('\n');
    expect(source.match(/\btv\(/g)).toHaveLength(1);
    expect(source.match(/export type ButtonGroupVariant\b/g)).toHaveLength(1);
    expect(buttonGroupVariants({ orientation: 'vertical' })).toContain('flex-col');
    expect(buttonGroupVariants()).toContain('border-border');
    expect(buttonGroupVariants()).toContain('gap-px');
    expect(source).toContain('[&_[data-slot=button]]:border-border');
    expect(source).not.toContain('[&_[data-slot=button]]:border-input');

    render(ButtonGroup, { props: { 'aria-label': 'Editor actions', orientation: 'vertical' } });
    expect(
      screen.getByRole('group', { name: 'Editor actions' }).getAttribute('data-orientation'),
    ).toBe('vertical');
  });

  it('publishes catalog metadata', () => {
    expect(buttonGroupMetadata.characterizationTest).toBe(
      'src/lib/components/ui/button-group/button-group.test.ts',
    );
    expect(buttonGroupFixtures.flatMap((fixture) => fixture.states)).toContain('vertical');
    expect(buttonGroupFixtures.flatMap((fixture) => fixture.states)).toContain('keyboard-focus');
  });
});
