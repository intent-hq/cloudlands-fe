// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseUiComponentMetadata } from '../component-metadata';
import Toggle from './toggle.svelte';
import ToggleHarness from './toggle.test-harness.svelte';
import { toggleCompatibilityModes, toggleMetadata } from './toggle.meta';

afterEach(() => cleanup());

describe('Toggle', () => {
  it('uses only button aria-pressed semantics in canonical single mode', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(Toggle, {
      props: { ariaLabel: 'Pin item', pressed: false, onChange },
    });
    const toggle = getByRole('button', { name: 'Pin item' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('role')).not.toBe('switch');
    await fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('supports slotted characterization content and bound and controlled state', async () => {
    const onChange = vi.fn();
    const { getByRole, getByTestId, rerender } = render(ToggleHarness, {
      props: { onChange },
    });
    const toggle = getByRole('button', { name: 'Product updates' });

    expect(toggle.textContent).toBe('Product updates');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(getByTestId('toggle-value').textContent).toBe('true');

    await rerender({ pressed: false, onChange });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(getByTestId('toggle-value').textContent).toBe('false');
  });

  it('retains tested group compatibility behavior', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(Toggle, {
      props: {
        variant: 'group',
        value: 'light',
        options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
        onChange,
      },
    });
    await fireEvent.click(getByRole('button', { name: 'Dark' }));
    expect(onChange).toHaveBeenLastCalledWith('dark');
  });

  it('uses semantic editorial presentation for canonical and group modes', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/components/ui/toggle/toggle.svelte'),
      'utf8',
    );
    expect(source).toContain('type-body');
    expect(source).toContain('border-border');
    expect(source).toContain('bg-card');
    expect(source).toContain('text-muted-foreground');
    expect(source).toContain('hover:border-input');
    expect(source).toContain('rounded-(--radius-medium)');
    expect(source).toContain('shadow-(--elevation-raised)');
    expect(source).toContain('data-[state=on]:border-primary');
    expect(source).toContain('data-[state=on]:bg-primary');
    expect(source).toContain('data-[state=on]:text-primary-foreground');
    expect(source).toContain("xs: 'h-(--control-height-small) px-2'");
    expect(source).toContain('motion-reduce:transition-none');
    expect(source).not.toMatch(/bg-white|border-t-white|border-b-black|rgba\(|gradient/);
  });

  it('publishes a measurable removal gate only for the remaining group mode', () => {
    expect(() => parseUiComponentMetadata(toggleMetadata)).not.toThrow();
    expect(toggleMetadata.fixtures[0].states).toEqual(
      expect.arrayContaining([
        'unpressed',
        'pressed',
        'disabled',
        'keyboard-focus',
        'light',
        'dark',
        'compact',
        'reduced-motion',
      ]),
    );
    expect(toggleCompatibilityModes.group.replacement).toBe('$lib/components/ui/toggle-group');
    expect(Object.keys(toggleCompatibilityModes)).toEqual(['group']);
  });
});
