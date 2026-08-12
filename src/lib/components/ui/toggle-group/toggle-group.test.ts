// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseUiComponentMetadata } from '../component-metadata';
import ToggleGroupHarness from './toggle-group.test-harness.svelte';
import { toggleGroupMetadata } from './toggle-group.meta';

afterEach(() => cleanup());

describe('ToggleGroup', () => {
  it('supports a bindable single selection with radio semantics', async () => {
    const { getByRole, getByTestId } = render(ToggleGroupHarness);
    const list = getByRole('radio', { name: 'List view' });
    const tree = getByRole('radio', { name: 'Tree view' });
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

  it('offers a flat presentation without decorative or selected-state borders', () => {
    const { getByRole } = render(ToggleGroupHarness, { props: { variant: 'flat' } });
    const selected = getByRole('radio', { name: 'List view' });
    const root = selected.parentElement;

    expect(root?.className).toContain('border-transparent');
    expect(root?.className).toContain('bg-muted/40');
    expect(root?.className).toContain('shadow-none');
    expect(selected.className).toContain('hover:border-transparent');
    expect(selected.className).toContain('data-[state=on]:border-transparent');
    expect(selected.className).toContain('data-[state=on]:shadow-none');
    expect(selected.className).toContain('focus-visible:ring-2');
  });

  it('uses sage selected states, input boundaries, and reduced-motion parity', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/ui/toggle-group/toggle-group-item.svelte'),
      'utf8',
    );
    expect(source).toContain('type-body');
    expect(source).toContain('border-transparent');
    expect(source).toContain('hover:border-input');
    expect(source).toContain('rounded-(--radius-small)');
    expect(source).toContain('shadow-(--elevation-raised)');
    expect(source).toContain('data-[state=on]:bg-accent');
    expect(source).toContain('motion-reduce:transition-none');

    const { getByRole } = render(ToggleGroupHarness);
    const list = getByRole('radio', { name: 'List view' });
    expect(list.className).toContain('h-(--control-height-medium)');
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
