// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import InputGroupHarness from './InputGroupHarness.svelte';
import TextEntrySizeHarness from './TextEntrySizeHarness.svelte';
import { inputGroupFixtures } from './input-group.fixtures';
import { inputGroupMetadata } from './input-group.meta';

afterEach(cleanup);

describe('InputGroup', () => {
  it('shares one field boundary across its control and addon slots', () => {
    const { container, getByRole } = render(InputGroupHarness);
    const group = container.querySelector('[data-slot="input-group"]');
    const addons = container.querySelectorAll('[data-slot="input-group-addon"]');

    expect(addons).toHaveLength(2);
    expect(group?.querySelectorAll('[data-slot="input"]')).toHaveLength(1);
    expect(getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(getByRole('alert').textContent).toContain('valid handle');
    expect(group?.getAttribute('data-invalid')).toBe('true');
  });

  it('inherits compact density across every text-entry family', () => {
    const { container } = render(TextEntrySizeHarness);
    const selectors = [
      '[data-slot="label"]',
      '[data-slot="input"]',
      '[data-slot="textarea"]',
      '[data-slot="file-input-surface"]',
      '[data-slot="input-group"]',
    ];
    for (const selector of selectors) {
      for (const element of container.querySelectorAll(selector)) {
        expect(element.getAttribute('data-size'), selector).toBe('compact');
      }
    }
  });

  it('publishes interaction, error, addon, size, and reduced-motion states', () => {
    expect(() => parseUiComponentMetadata(inputGroupMetadata)).not.toThrow();
    expect(inputGroupFixtures[0].states).toEqual(
      expect.arrayContaining(['rest', 'hover', 'focus', 'error', 'disabled', 'reduced-motion']),
    );
  });
});
