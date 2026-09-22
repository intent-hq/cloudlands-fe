import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Combobox from './combobox.svelte';

const options = [
  { value: 'main', label: 'Main branch', data: { cached: true } },
  { value: 'feature', label: 'Feature branch' },
  { value: 'disabled', label: 'Unavailable branch', disabled: true },
];

async function open() {
  const input = screen.getByRole('combobox', { name: 'Branches' });
  await fireEvent.focus(input);
  return input;
}

describe('Combobox accepted-selection callback', () => {
  beforeAll(() => {
    // Static content invokes this native API, which jsdom does not provide.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it.each(['pointer', 'keyboard'] as const)(
    'commits a same-value %s reselect once without emitting a change',
    async (activation) => {
      const onchange = vi.fn();
      const oncommit = vi.fn();
      render(Combobox, { ariaLabel: 'Branches', value: 'main', options, onchange, oncommit });
      const input = await open();
      if (activation === 'pointer') {
        await fireEvent.pointerUp(screen.getByRole('option', { name: 'Main branch' }), {
          pointerType: 'mouse',
          button: 0,
        });
      } else {
        await waitFor(() => expect(input.getAttribute('aria-activedescendant')).toBeTruthy());
        await fireEvent.keyDown(input, { key: 'Enter' });
      }
      expect(oncommit).toHaveBeenCalledExactlyOnceWith('main', options[0]);
      expect(onchange).not.toHaveBeenCalled();
      expect(input.getAttribute('aria-expanded')).toBe('false');
    },
  );

  it.each(['pointer', 'keyboard'] as const)(
    'commits a changed %s value once alongside the existing change callback',
    async (activation) => {
      const onchange = vi.fn();
      const oncommit = vi.fn();
      render(Combobox, { ariaLabel: 'Branches', value: 'main', options, onchange, oncommit });
      const input = await open();
      if (activation === 'pointer') {
        await fireEvent.pointerUp(screen.getByRole('option', { name: 'Feature branch' }), {
          pointerType: 'mouse',
          button: 0,
        });
      } else {
        await fireEvent.input(input, { target: { value: 'Feature' } });
        expect(input.getAttribute('aria-activedescendant')).toBe(
          screen.getByRole('option', { name: 'Feature branch' }).id,
        );
        await fireEvent.keyDown(input, { key: 'Enter' });
      }
      expect(oncommit).toHaveBeenCalledExactlyOnceWith('feature', options[1]);
      expect(onchange).toHaveBeenCalledExactlyOnceWith('feature', options[1]);
    },
  );

  it('commits a custom value immediately after typing without extra navigation', async () => {
    const oncommit = vi.fn();
    render(Combobox, {
      ariaLabel: 'Branches',
      value: 'main',
      options,
      allowCustom: true,
      staticPosition: true,
      oncommit,
    });
    const input = await open();
    await fireEvent.input(input, { target: { value: 'feature/task-29' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('feature/task-29', {
      value: 'feature/task-29',
      label: 'feature/task-29',
    });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('highlights a remote result for immediate Enter after search settles', async () => {
    const oncommit = vi.fn();
    const remote = { value: 'remote', label: 'Remote branch' };
    render(Combobox, {
      ariaLabel: 'Branches',
      value: 'main',
      options,
      onsearch: async () => [remote],
      oncommit,
    });
    const input = await open();
    await fireEvent.input(input, { target: { value: 'Remote' } });
    await screen.findByRole('option', { name: 'Remote branch' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('remote', remote);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('waits for native touch click acceptance before committing a reselect', async () => {
    const oncommit = vi.fn();
    render(Combobox, { ariaLabel: 'Branches', value: 'main', options, oncommit });
    const input = await open();
    const option = screen.getByRole('option', { name: 'Main branch' });
    await fireEvent.pointerUp(option, { pointerType: 'touch', button: 0 });
    expect(oncommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(option);
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('main', options[0]);
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('retains an uncommitted query when every matching option is disabled', async () => {
    const oncommit = vi.fn();
    const onchange = vi.fn();
    render(Combobox, { ariaLabel: 'Branches', value: 'main', options, onchange, oncommit });
    const input = await open();
    await fireEvent.input(input, { target: { value: 'Unavailable' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).not.toHaveBeenCalled();
    expect(onchange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Unavailable');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.input(input, { target: { value: 'Feature' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('feature', options[1]);
  });

  it('does not accept or discard a query while options load, then accepts a new Enter', async () => {
    const oncommit = vi.fn();
    const view = render(Combobox, {
      ariaLabel: 'Branches',
      value: 'main',
      options,
      loading: true,
      allowCustom: true,
      oncommit,
    });
    const input = await open();
    await fireEvent.input(input, { target: { value: 'Feature branch' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('Feature branch');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-busy')).toBe('true');
    await view.rerender({ loading: false });
    await waitFor(() =>
      expect(input.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Feature branch' }).id,
      ),
    );
    expect(oncommit).not.toHaveBeenCalled();
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('feature', options[1]);
  });

  it.each(['Escape', 'Tab', 'controlled'] as const)(
    'does not treat %s dismissal as acceptance',
    async (dismissal) => {
      const oncommit = vi.fn();
      const view = render(Combobox, { ariaLabel: 'Branches', value: 'main', options, oncommit });
      const input = await open();
      if (dismissal === 'controlled') await view.rerender({ open: false });
      else await fireEvent.keyDown(input, { key: dismissal });
      expect(oncommit).not.toHaveBeenCalled();
      expect(input.getAttribute('aria-expanded')).toBe('false');
    },
  );

  it('does not commit disabled options, composing Enter, or parent value updates', async () => {
    const oncommit = vi.fn();
    const view = render(Combobox, {
      ariaLabel: 'Branches',
      value: 'main',
      options,
      oncommit,
    });
    const input = await open();
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Unavailable branch' }), {
      pointerType: 'mouse',
      button: 0,
    });
    await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await view.rerender({ value: 'feature' });
    expect(oncommit).not.toHaveBeenCalled();
  });

  it.each(['main', 'feature'] as const)(
    'does not commit canceled Enter for %s',
    async (highlightedValue) => {
      const oncommit = vi.fn();
      const onchange = vi.fn();
      render(Combobox, { ariaLabel: 'Branches', value: 'main', options, onchange, oncommit });
      const input = await open();
      await fireEvent.keyDown(input, { key: highlightedValue === 'main' ? 'Home' : 'End' });
      await waitFor(() =>
        expect(input.getAttribute('aria-activedescendant')).toBe(
          screen.getByRole('option', {
            name: highlightedValue === 'main' ? 'Main branch' : 'Feature branch',
          }).id,
        ),
      );
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      event.preventDefault();
      await fireEvent(input, event);
      expect(oncommit).not.toHaveBeenCalled();
      expect(onchange).not.toHaveBeenCalled();
      expect(input.getAttribute('aria-expanded')).toBe('true');
    },
  );

  it('does not commit on focus or failed-search retry', async () => {
    const oncommit = vi.fn();
    const onsearch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(options);
    render(Combobox, { ariaLabel: 'Branches', value: 'main', options, onsearch, oncommit });
    const input = await open();
    expect(oncommit).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: 'Main' } });
    await screen.findByRole('button', { name: 'Retry' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('option', { name: 'Main branch' });
    expect(onsearch).toHaveBeenCalledTimes(2);
    expect(oncommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('reports the activated option once for multi-select selection and deselection', async () => {
    const oncommit = vi.fn();
    render(Combobox, { ariaLabel: 'Branches', multiple: true, value: [], options, oncommit });
    const input = await open();
    const option = screen.getByRole('option', { name: 'Main branch' });
    await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    expect(oncommit).toHaveBeenNthCalledWith(1, ['main'], options[0]);
    await fireEvent.pointerUp(option, { pointerType: 'mouse', button: 0 });
    expect(oncommit).toHaveBeenNthCalledWith(2, [], options[0]);
    expect(oncommit).toHaveBeenCalledTimes(2);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });
});
