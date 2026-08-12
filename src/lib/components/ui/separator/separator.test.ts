// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import * as separatorApi from './index';
import Separator from './separator.svelte';
import { separatorFixtures } from './separator.fixtures';
import { separatorMetadata } from './separator.meta';

describe('Separator', () => {
  it('preserves horizontal, vertical, decorative, and semantic Bits semantics', () => {
    const horizontal = render(Separator, { props: { decorative: false } });
    const semantic = horizontal.getByRole('separator');
    expect(semantic.getAttribute('data-orientation')).toBe('horizontal');
    expect(semantic.className).toContain('bg-border');
    expect(semantic.className).toContain('data-[orientation=horizontal]:h-px');
    expect(semantic.className).not.toContain('dark:');

    const vertical = render(Separator, { props: { orientation: 'vertical', decorative: true } });
    const decorative = vertical.container.querySelector('[data-slot="separator"]');
    expect(decorative?.getAttribute('data-orientation')).toBe('vertical');
    expect(decorative?.getAttribute('role')).toBe('none');
    expect(decorative?.className).toContain('data-[orientation=vertical]:w-px');
  });

  it('publishes parseable metadata with exact public exports and responsive fixtures', () => {
    expect(() => parseUiComponentMetadata(separatorMetadata)).not.toThrow();
    expect(new Set(separatorMetadata.exports)).toEqual(new Set(Object.keys(separatorApi)));
    expect(separatorFixtures[0].states).toEqual(
      expect.arrayContaining(['horizontal', 'vertical', 'semantic', 'compact', 'zoom-200']),
    );
  });
});
