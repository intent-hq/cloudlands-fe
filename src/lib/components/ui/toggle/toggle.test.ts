// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseUiComponentMetadata } from '../component-metadata';
import Toggle from './toggle.svelte';
import { toggleMetadata } from './toggle.meta';

afterEach(() => cleanup());

describe('Toggle', () => {
  it('forwards rest attributes and binds the underlying control ref', async () => {
    const binding = { ref: null as HTMLButtonElement | null };
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(Toggle, {
      target,
      props: {
        'data-testid': 'forwarded-control',
        'aria-label': 'Forwarded control',
        get ref() {
          return binding.ref;
        },
        set ref(value) {
          binding.ref = value;
        },
      },
    });
    try {
      await tick();
      const control = target.querySelector('[data-testid="forwarded-control"]');
      expect(control).not.toBeNull();
      expect(binding.ref).toBe(control);
      expect(control?.getAttribute('aria-label')).toBe('Forwarded control');
      binding.ref?.focus();
      expect(document.activeElement).toBe(control);
    } finally {
      await unmount(component);
      target.remove();
    }
    expect(binding.ref).toBeNull();
  });

  it('uses button aria-pressed semantics and reports pressed changes', async () => {
    const onChange = vi.fn();
    const onPressedChange = vi.fn();
    const { getByRole } = render(Toggle, {
      props: { ariaLabel: 'Pin item', pressed: false, onChange, onPressedChange },
    });
    const toggle = getByRole('button', { name: 'Pin item' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('role')).not.toBe('switch');
    await fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(onPressedChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
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
