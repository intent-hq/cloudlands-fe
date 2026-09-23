import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Combobox from './combobox.svelte';
import type { ComboboxOption } from './types';

const options = [
  { value: 'ada', label: 'Ada Lovelace' },
  { value: 'grace', label: 'Grace Hopper' },
];

function deferred() {
  let resolve!: (options: ComboboxOption[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ComboboxOption[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function search(query: string) {
  const input = screen.getByRole('combobox', { name: 'People' });
  await fireEvent.focus(input);
  await fireEvent.input(input, { target: { value: query } });
  return input as HTMLInputElement;
}

describe('Combobox search and controlled selection', () => {
  afterEach(cleanup);

  for (const pointerType of ['mouse', 'touch'] as const) {
    it.each([
      { selection: 'changed single', value: 'grace', multiple: false, expectedValue: 'ada' },
      { selection: 'same single', value: 'ada', multiple: false, expectedValue: 'ada' },
      {
        selection: 'multiple selection',
        value: ['grace'],
        multiple: true,
        expectedValue: ['grace', 'ada'],
      },
      {
        selection: 'multiple deselection',
        value: ['grace', 'ada'],
        multiple: true,
        expectedValue: ['grace'],
      },
    ])(
      `blocks pending ${pointerType} $selection until a new activation after search settles`,
      async ({ selection, value, multiple, expectedValue }) => {
        const pending = deferred();
        const onchange = vi.fn();
        const oncommit = vi.fn();
        const onquerychange = vi.fn();
        const result = { value: 'ada', label: 'Ada result', data: { source: 'remote' } };
        render(Combobox, {
          ariaLabel: 'People',
          options,
          value,
          multiple,
          onchange,
          oncommit,
          onquerychange,
          onsearch: () => pending.promise,
        });
        const input = await search('Ada');
        const stale = screen.getByRole('option', { name: 'Ada Lovelace' });
        expect(stale.getAttribute('aria-disabled')).toBe('true');
        await fireEvent.keyDown(input, { key: 'Enter' });
        await fireEvent.pointerUp(stale, { button: 0, pointerType });
        await fireEvent.click(stale);
        expect(onchange).not.toHaveBeenCalled();
        expect(oncommit).not.toHaveBeenCalled();
        expect(onquerychange.mock.calls).toEqual([['Ada']]);
        expect(input.value).toBe('Ada');
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.getAttribute('aria-busy')).toBe('true');

        pending.resolve([result]);
        const settled = await screen.findByRole('option', { name: 'Ada result' });
        expect(input.getAttribute('aria-busy')).toBe('false');
        expect(input.getAttribute('aria-expanded')).toBe('true');
        expect(input.value).toBe('Ada');
        expect(onchange).not.toHaveBeenCalled();
        expect(oncommit).not.toHaveBeenCalled();
        await fireEvent.pointerUp(settled, { button: 0, pointerType });
        await fireEvent.click(settled);
        expect(oncommit).toHaveBeenCalledExactlyOnceWith(expectedValue, result);
        if (selection === 'same single') expect(onchange).not.toHaveBeenCalled();
        else if (multiple) expect(onchange).toHaveBeenCalledExactlyOnceWith(expectedValue);
        else expect(onchange).toHaveBeenCalledExactlyOnceWith(expectedValue, result);
        expect(input.getAttribute('aria-expanded')).toBe(String(multiple));
        expect(input.value).toBe(multiple ? '' : 'Ada Lovelace');
      },
    );
  }

  it('does not arm a pending touch release for a click after results settle', async () => {
    const pending = deferred();
    const onchange = vi.fn();
    const oncommit = vi.fn();
    render(Combobox, {
      ariaLabel: 'People',
      value: 'ada',
      options,
      onchange,
      oncommit,
      // Retain the row identity so a wrongly armed native click listener survives settlement.
      onsearch: () => pending.promise.then((options) => [{ key: 'options', label: '', options }]),
    });
    const input = await search('Ada');
    const option = screen.getByRole('option', { name: 'Ada Lovelace' });
    await fireEvent.pointerUp(option, { button: 0, pointerType: 'touch' });
    pending.resolve([options[0]]);
    await waitFor(() => expect(input.getAttribute('aria-busy')).toBe('false'));
    await fireEvent.click(option);
    expect(onchange).not.toHaveBeenCalled();
    expect(oncommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.value).toBe('Ada');
    await fireEvent.pointerUp(option, { button: 0, pointerType: 'touch' });
    await fireEvent.click(option);
    expect(oncommit).toHaveBeenCalledExactlyOnceWith('ada', options[0]);
    expect(onchange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['throw', 'reject'] as const)(
    'settles a search %s and retries the same query',
    async (failure) => {
      const error = new Error('offline');
      const onsearcherror = vi.fn();
      const onsearch = vi
        .fn()
        .mockImplementationOnce(() => {
          if (failure === 'throw') throw error;
          return Promise.reject(error);
        })
        .mockResolvedValueOnce([{ value: 'remote-id', label: 'Remote person' }]);
      render(Combobox, { ariaLabel: 'People', options, onsearch, onsearcherror });
      const input = await search('Remote');
      await waitFor(() => expect(input.getAttribute('aria-busy')).toBe('false'));
      expect(onsearcherror).toHaveBeenCalledExactlyOnceWith(error, 'Remote');
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.queryAllByRole('option')).toHaveLength(0);
      await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByRole('option', { name: 'Remote person' })).toBeTruthy();
      expect(onsearch.mock.calls).toEqual([['Remote'], ['Remote']]);
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(input.value).toBe('Remote');
    },
  );

  it('ignores a stale rejection without clearing a newer search busy state', async () => {
    const older = deferred();
    const newer = deferred();
    const onsearcherror = vi.fn();
    render(Combobox, {
      ariaLabel: 'People',
      onsearcherror,
      onsearch: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise),
    });
    const input = await search('old');
    await fireEvent.input(input, { target: { value: 'new' } });
    older.reject(new Error('old failure'));
    await tick();
    expect(input.getAttribute('aria-busy')).toBe('true');
    expect(onsearcherror).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    newer.resolve([{ value: 'new-id', label: 'New person' }]);
    await screen.findByRole('option', { name: 'New person' });
    expect(input.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps retry reachable by keyboard and returns focus to the input', async () => {
    const onsearch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    render(Combobox, { ariaLabel: 'People', onsearch });
    const input = await search('remote');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    await fireEvent.keyDown(input, { key: 'Tab' });
    expect(document.activeElement).toBe(retry);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.keyDown(retry, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onsearch).toHaveBeenCalledTimes(2));
    expect(onsearch).toHaveBeenLastCalledWith('remote');
    expect(document.activeElement).toBe(input);
  });

  it('keeps the latest results when an older successful query resolves last', async () => {
    const older = deferred();
    const newer = deferred();
    render(Combobox, {
      ariaLabel: 'People',
      onsearch: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise),
    });
    const input = await search('old');
    await fireEvent.input(input, { target: { value: 'new' } });
    newer.resolve([{ value: 'new-id', label: 'New person' }]);
    await screen.findByRole('option', { name: 'New person' });
    older.resolve([{ value: 'stale', label: 'New stale result' }]);
    await tick();
    expect(screen.queryByRole('option', { name: 'New stale result' })).toBeNull();
    expect(screen.getByRole('option', { name: 'New person' })).toBeTruthy();
  });

  it.each(['resolve', 'reject'] as const)(
    'clearing a pending query ignores its late %s',
    async (settlement) => {
      const pending = deferred();
      const onsearcherror = vi.fn();
      render(Combobox, {
        ariaLabel: 'People',
        options,
        onsearcherror,
        onsearch: () => pending.promise,
      });
      const input = await search('remote');
      await fireEvent.input(input, { target: { value: '' } });
      if (settlement === 'resolve') pending.resolve([{ value: 'remote', label: 'Remote person' }]);
      else pending.reject(new Error('stale failure'));
      await tick();
      expect(input.getAttribute('aria-busy')).toBe('false');
      expect(screen.getByRole('option', { name: 'Ada Lovelace' })).toBeTruthy();
      expect(screen.queryByRole('option', { name: 'Remote person' })).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
      expect(onsearcherror).not.toHaveBeenCalled();
    },
  );

  it.each(['escape', 'controlled'] as const)(
    'resets %s close and reopens without pending results',
    async (close) => {
      const pending = deferred();
      const onquerychange = vi.fn();
      const view = render(Combobox, {
        ariaLabel: 'People',
        options,
        value: 'ada',
        onquerychange,
        onsearch: () => pending.promise,
      });
      const input = await search('remote');
      if (close === 'escape') await fireEvent.keyDown(input, { key: 'Escape' });
      else await view.rerender({ open: false });
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(input.value).toBe('Ada Lovelace');
      expect(onquerychange).toHaveBeenLastCalledWith('');
      await fireEvent.focus(input);
      pending.resolve([{ value: 'remote', label: 'Remote person' }]);
      await tick();
      expect(input.value).toBe('');
      expect(
        screen.getByRole('option', { name: 'Ada Lovelace' }).getAttribute('aria-selected'),
      ).toBe('true');
      expect(screen.queryByRole('option', { name: 'Remote person' })).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  it('ignores a rejection after unmount rather than reporting a dead search', async () => {
    const pending = deferred();
    const onsearcherror = vi.fn();
    const view = render(Combobox, {
      ariaLabel: 'People',
      onsearcherror,
      onsearch: () => pending.promise,
    });
    await search('remote');
    view.unmount();
    pending.reject(new Error('late failure'));
    await tick();
    expect(onsearcherror).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders one non-option empty status when every group filters empty', async () => {
    render(Combobox, {
      ariaLabel: 'People',
      groups: [
        { key: 'people', label: 'People group', options },
        { key: 'empty', label: 'Empty group', options: [] },
      ],
    });
    const input = await search('not found');
    await waitFor(() => expect(screen.queryAllByRole('option')).toHaveLength(0));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('preserves a remote selected label and does not duplicate a matching custom choice', async () => {
    const onchange = vi.fn();
    const result = { value: 'remote-id', label: 'Remote person' };
    render(Combobox, {
      ariaLabel: 'People',
      allowCustom: true,
      onchange,
      onsearch: async () => [result],
    });
    const input = await search('Remote person');
    const option = await screen.findByRole('option', { name: 'Remote person', exact: true });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    expect(onchange).toHaveBeenCalledExactlyOnceWith('remote-id', result);
    await waitFor(() => expect(input.value).toBe('Remote person'));
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps controlled values through missing/disabled options and clears them explicitly', async () => {
    const onchange = vi.fn();
    const view = render(Combobox, { ariaLabel: 'People', options, value: 'ada', onchange });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await view.rerender({ options: [] });
    expect(input.value).toBe('Ada Lovelace');
    await view.rerender({ options: [{ ...options[0], disabled: true }] });
    await fireEvent.focus(input);
    const option = screen.getByRole('option', { name: 'Ada Lovelace' });
    await fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(onchange).not.toHaveBeenCalled();
    await view.rerender({ value: '' });
    await waitFor(() => expect(option.getAttribute('aria-selected')).not.toBe('true'));
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });

  it('preserves hidden multi-selections while toggling one result and clears controlled selections', async () => {
    const onchange = vi.fn();
    const view = render(Combobox, {
      ariaLabel: 'People',
      options,
      value: ['ada'],
      multiple: true,
      onchange,
    });
    const input = await search('Grace');
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Grace Hopper' }), {
      button: 0,
      pointerType: 'mouse',
    });
    expect(onchange).toHaveBeenLastCalledWith(['ada', 'grace']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('option', { name: 'Ada Lovelace' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await fireEvent.pointerUp(screen.getByRole('option', { name: 'Ada Lovelace' }), {
      button: 0,
      pointerType: 'mouse',
    });
    expect(onchange).toHaveBeenLastCalledWith(['grace']);
    await view.rerender({ value: [] });
    await waitFor(() =>
      expect(
        screen.getByRole('option', { name: 'Grace Hopper' }).getAttribute('aria-selected'),
      ).not.toBe('true'),
    );
  });
});
