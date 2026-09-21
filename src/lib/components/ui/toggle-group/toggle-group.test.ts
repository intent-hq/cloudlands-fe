// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import ToggleGroupHarness from './toggle-group.test-harness.svelte';
import { toggleGroupMetadata } from './toggle-group.meta';

afterEach(() => cleanup());

describe('ToggleGroup', () => {
  it('supports a bindable single selection with radio semantics', async () => {
    const { getByRole, getByTestId } = render(ToggleGroupHarness);
    const list = getByRole('radio', { name: 'List view' });
    const tree = getByRole('radio', { name: 'Tree view' });
    const group = list.parentElement;
    expect(group?.className).toContain('border-0');
    expect(group?.className.split(/\s+/)).not.toContain('p-0.5');
    expect(list.className).toContain('border-0');
    expect(list.className).toContain('rounded-(--radius-medium)');
    expect(list.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(tree);
    expect(tree.getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('group-value').textContent).toBe('tree');
  });

  it('supports a distinct multiple-selection API with aria-pressed semantics', async () => {
    const { getByRole, getByTestId } = render(ToggleGroupHarness, {
      props: { multiple: true },
    });
    const tree = getByRole('button', { name: 'Tree view' });
    expect(tree.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(tree);
    expect(tree.getAttribute('aria-pressed')).toBe('true');
    expect(getByTestId('group-value').textContent).toBe('list,tree');
  });

  it('uses arrow keys for roving keyboard focus', async () => {
    const { getByRole } = render(ToggleGroupHarness);
    const list = getByRole('radio', { name: 'List view' });
    const tree = getByRole('radio', { name: 'Tree view' });
    list.focus();
    await fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tree);
  });

  it('publishes valid metadata and complete fixture states', () => {
    expect(() => parseUiComponentMetadata(toggleGroupMetadata)).not.toThrow();
    expect(toggleGroupMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining([
        'single',
        'multiple',
        'selected',
        'deselected',
        'disabled',
        'keyboard-focus',
        'dark',
        'compact',
        'reduced-motion',
      ]),
    );
  });
});
