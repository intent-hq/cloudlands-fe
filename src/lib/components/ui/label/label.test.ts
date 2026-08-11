// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import LabelHarness from './label.test-harness.svelte';
import { labelFixtures } from './label.fixtures';
import { labelMetadata } from './label.meta';

afterEach(cleanup);

describe('Label', () => {
  it('associates compact editorial label text with its control', () => {
    const { getByRole, getByText } = render(LabelHarness);
    expect(getByRole('textbox', { name: 'Team name' })).toBeTruthy();
    const classes = getByText('Team name').className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(['type-body', 'text-foreground', 'font-medium']),
    );
    expect(classes).not.toContain('text-xs');
  });

  it('publishes disabled, compact, long-content, and theme fixtures', () => {
    expect(() => parseUiComponentMetadata(labelMetadata)).not.toThrow();
    expect(labelFixtures[0].states).toEqual(
      expect.arrayContaining(['disabled', 'compact', 'long-content', 'dark']),
    );
  });
});
