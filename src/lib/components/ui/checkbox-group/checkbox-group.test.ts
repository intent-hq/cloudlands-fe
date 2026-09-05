// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import CheckboxGroupHarness from './CheckboxGroupHarness.svelte';
import { checkboxGroupMetadata } from './checkbox-group.meta';

afterEach(cleanup);

describe('CheckboxGroup', () => {
  it('binds multiple selections and submits selected values', async () => {
    const { getByRole, getByTestId } = render(CheckboxGroupHarness);
    await fireEvent.click(getByRole('checkbox', { name: 'Two Second choice' }));
    expect(getByTestId('value').textContent).toBe('one,two');
    expect(new FormData(getByTestId('form') as HTMLFormElement).getAll('features')).toEqual([
      'one',
      'two',
    ]);
  });

  it('provides roving focus without changing selection', async () => {
    const { getByRole, getByTestId } = render(CheckboxGroupHarness);
    const first = getByRole('checkbox', { name: 'One First choice' });
    const second = getByRole('checkbox', { name: 'Two Second choice' });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    expect(getByTestId('value').textContent).toBe('one');
    expect(second.closest('[role="group"]')?.querySelector('.bg-hover')).not.toBeNull();
  });

  it('publishes merged-selection and proximity fixtures', () => {
    expect(() => parseUiComponentMetadata(checkboxGroupMetadata)).not.toThrow();
    expect(checkboxGroupMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining(['contiguous-selected', 'split-selected', 'proximity-hover']),
    );
  });
});
