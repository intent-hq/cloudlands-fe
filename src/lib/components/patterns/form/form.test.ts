// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import axe from 'axe-core';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AutoSaveFieldHarness from './AutoSaveFieldHarness.svelte';
import FormHarness from './FormHarness.svelte';
import { createForm } from './create-form.svelte';
import { formFixtures } from './form.fixtures';
import { formMetadata } from './form.meta';
import * as formApi from './index';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('form pattern', () => {
  it('associates labels and wires descriptions and announced errors to controls', () => {
    render(FormHarness);
    const name = screen.getByLabelText('Name');
    const description = screen.getByText('Shown to collaborators.');
    const error = screen.getByRole('alert');

    expect(name.id).not.toBe('');
    expect(name.getAttribute('aria-describedby')?.split(' ')).toEqual([description.id, error.id]);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect((name as HTMLInputElement).required).toBe(true);
    expect(screen.getByLabelText('Notes').getAttribute('aria-describedby')).toBe(
      screen.getByText('Optional details.').id,
    );
  });

  it('keeps destructive, secondary, and primary actions in a fixed DOM order', () => {
    const { container } = render(FormHarness, { error: undefined });
    const actions = [...container.querySelectorAll<HTMLButtonElement>('[data-action]')];

    expect(actions.map((button) => button.dataset.action)).toEqual([
      'destructive',
      'secondary',
      'primary',
    ]);
    expect(container.querySelector('[data-slot="form-actions"]')?.getAttribute('data-size')).toBe(
      'compact',
    );
  });

  it('submits single-line Enter and modified textarea Enter, but preserves textarea Enter', async () => {
    const onSubmit = vi.fn();
    render(FormHarness, { onSubmit });
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Intent' } });

    await fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('announces and disables the form while submit work is pending', async () => {
    let finish = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { container } = render(FormHarness, { onSubmit });

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Intent' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    expect((container.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    finish();
    await waitFor(() =>
      expect(container.querySelector('form')?.hasAttribute('aria-busy')).toBe(false),
    );
  });

  it('validates, submits, tracks edits, and resets createForm state', async () => {
    const store = createForm({
      initial: { name: '' },
      validate: ({ name }) => (name ? {} : { name: 'Required' }),
    });
    const onValid = vi.fn();

    expect(await store.submit(onValid)).toBe(false);
    expect(store.errors).toEqual({ name: 'Required' });
    store.values.name = 'Intent';
    flushSync();
    expect(store.dirty).toBe(true);
    expect(await store.submit(onValid)).toBe(true);
    expect(onValid).toHaveBeenCalledWith({ name: 'Intent' });
    store.reset();
    flushSync();
    expect(store.values).toEqual({ name: '' });
    expect(store.dirty).toBe(false);
  });

  it('publishes the required catalog fixture states', () => {
    expect(formFixtures.flatMap((fixture) => fixture.states)).toEqual(
      expect.arrayContaining(['rest', 'validating', 'error', 'submitting', 'disabled']),
    );
  });

  it('publishes complete pattern metadata and its public API', () => {
    expect(Object.keys(formApi).sort()).toEqual([...formMetadata.exports].sort());
    expect(formMetadata.useWhen).not.toHaveLength(0);
    expect(formMetadata.dontUseWhen).not.toHaveLength(0);
    expect(formMetadata.replaces).not.toHaveLength(0);
  });

  it('has no axe-core violations in rest, error, or disabled states', async () => {
    for (const props of [{ error: '' }, {}, { error: '', busy: true }]) {
      const { container, unmount } = render(FormHarness, props);
      const result = await axe.run(container, {
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map(({ id }) => id)).toEqual([]);
      unmount();
    }
  });
});

describe('AutoSaveField', () => {
  it('debounces saves and flashes the saved indicator', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AutoSaveFieldHarness, { onSave });

    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Changed' } });
    expect(
      container.querySelector('[data-slot="unsaved-indicator"]')?.getAttribute('data-state'),
    ).toBe('unsaved');
    await vi.advanceTimersByTimeAsync(20);
    expect(onSave).toHaveBeenCalledWith('Changed');
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="unsaved-indicator"]')?.getAttribute('data-state'),
      ).toBe('saved'),
    );
  });
});
