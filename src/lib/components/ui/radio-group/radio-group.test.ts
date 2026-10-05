// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import RadioGroupHarness from './RadioGroupHarness.svelte';
import { radioGroupMetadata } from './radio-group.meta';

afterEach(cleanup);

describe('RadioGroup', () => {
  it('binds selection and submits the selected value', async () => {
    const { getByRole, getByTestId } = render(RadioGroupHarness);
    const second = getByRole('radio', { name: 'Two Second choice' });
    await fireEvent.click(second);
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('value').textContent).toBe('two');
    expect(new FormData(getByTestId('form') as HTMLFormElement).get('priority')).toBe('two');
  });

  it('uses roving arrow-key focus and the same active highlight', async () => {
    const { getByRole } = render(RadioGroupHarness);
    const first = getByRole('radio', { name: 'One First choice' });
    const second = getByRole('radio', { name: 'Two Second choice' });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
    expect(second.closest('[role="radiogroup"]')?.querySelector('.bg-hover')).not.toBeNull();
  });

  it('publishes catalog metadata and interaction fixtures', () => {
    expect(() => parseUiComponentMetadata(radioGroupMetadata)).not.toThrow();
    expect(radioGroupMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining([
        'inline',
        'stacked',
        'multi-line-label',
        'proximity-hover',
        'keyboard-roving',
      ]),
    );
    expect(radioGroupMetadata.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'radio-group-one-line-row',
          states: expect.arrayContaining(['one-line', '36px-row', 'selected']),
        }),
      ]),
    );
  });
});
