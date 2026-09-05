// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import InputMessageHarness from './InputMessageHarness.svelte';
import { inputMessageFixtures } from './input-message.fixtures';
import { inputMessageMetadata } from './input-message.meta';

afterEach(cleanup);

describe('InputMessage', () => {
  it('uses polite helper semantics and assertive error semantics', () => {
    const { getByRole, getByText } = render(InputMessageHarness);
    const helper = getByText('Helpful context');
    expect(helper.getAttribute('role')).toBeNull();
    expect(helper.getAttribute('aria-live')).toBe('polite');
    expect(getByRole('alert').textContent).toBe('Needs attention');
  });

  it('publishes helper, error, and reduced-motion fixtures', () => {
    expect(() => parseUiComponentMetadata(inputMessageMetadata)).not.toThrow();
    expect(inputMessageFixtures[0].states).toEqual(
      expect.arrayContaining(['helper', 'error', 'reduced-motion']),
    );
  });
});
