// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import Toggle from './toggle.svelte';
import { toggleMetadata } from './toggle.meta';

afterEach(() => cleanup());

describe('Toggle', () => {
  it('uses button aria-pressed semantics and reports pressed changes', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(Toggle, {
      props: { ariaLabel: 'Pin item', pressed: false, onChange },
    });
    const toggle = getByRole('button', { name: 'Pin item' });
    expect(toggle.className).toContain('border-0');
    expect(toggle.className).toContain('font-normal');
    expect(toggle.className).toContain('data-[state=on]:[--text-caption-weight:500]');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('role')).not.toBe('switch');
    await fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('does not change while disabled', async () => {
    const onChange = vi.fn();
    const { getByRole } = render(Toggle, {
      props: { ariaLabel: 'Pinned', disabled: true, onChange },
    });
    const toggle = getByRole('button', { name: 'Pinned' });
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('publishes only the canonical toggle fixture', () => {
    expect(() => parseUiComponentMetadata(toggleMetadata)).not.toThrow();
    expect(toggleMetadata.fixtures.map((fixture) => fixture.id)).toEqual(['toggle-state-matrix']);
  });
});
