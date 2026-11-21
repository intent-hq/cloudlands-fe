/**
 * @vitest-environment jsdom
 *
 * Gating flows of the Autocomplete settings rows (approved mock-up): keyless
 * Kilo asks for confirmation, keyless OpenRouter opens the key field.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$shared/paraglide/messages.js';
import AutocompleteSettingsView from './AutocompleteSettingsView.svelte';
import type { AutocompleteService } from '../autocomplete-settings-constants';

function setup(
  overrides: Partial<{
    enabled: boolean;
    service: AutocompleteService;
    keyConfigured: Record<AutocompleteService, boolean>;
  }> = {},
) {
  const callbacks = {
    onEnabledChange: vi.fn(),
    onServiceChange: vi.fn(),
    onModelChange: vi.fn(),
    onSaveKey: vi.fn(),
    onClearKey: vi.fn(),
  };
  const result = render(AutocompleteSettingsView, {
    props: {
      enabled: false,
      service: 'kilo' as AutocompleteService,
      model: 'nvidia/nemotron-3.5-lightning' as const,
      keyConfigured: { kilo: false, openrouter: false },
      ...overrides,
      ...callbacks,
    },
  });
  return { ...callbacks, ...result };
}

const enabledSwitch = () =>
  screen.getByRole('switch', { name: m.settings_autocomplete_enabled_label() });
const keyInput = () => document.querySelector('[data-testid="autocomplete-key-input"] input');

describe('AutocompleteSettingsView gating', () => {
  it('keyless Kilo opens the confirmation and enables only on confirm', async () => {
    const { onEnabledChange } = setup();
    await fireEvent.click(enabledSwitch());
    await tick();
    expect(onEnabledChange).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', {
      name: m.settings_autocomplete_kiloConfirm_confirm(),
    });
    await fireEvent.click(confirm);
    expect(onEnabledChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('cancelling the Kilo confirmation keeps it off', async () => {
    const { onEnabledChange } = setup();
    await fireEvent.click(enabledSwitch());
    const dialog = await screen.findByTestId('autocomplete-kilo-confirm');
    const cancel = [...document.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.trim() === m.settings_autocomplete_cancel() &&
        !dialog.contains(button),
    );
    await fireEvent.click(cancel!);
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it('Kilo with a key enables directly', async () => {
    const { onEnabledChange } = setup({ keyConfigured: { kilo: true, openrouter: false } });
    await fireEvent.click(enabledSwitch());
    expect(onEnabledChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByTestId('autocomplete-kilo-confirm')).toBeNull();
  });

  it('keyless OpenRouter opens the key field and enables after the key is saved', async () => {
    const { onEnabledChange, onSaveKey } = setup({ service: 'openrouter' });
    await fireEvent.click(enabledSwitch());
    await tick();
    expect(onEnabledChange).not.toHaveBeenCalled();
    expect(enabledSwitch().getAttribute('aria-checked')).toBe('true');
    const input = keyInput() as HTMLInputElement;
    expect(input).not.toBeNull();
    await fireEvent.input(input, { target: { value: ' sk-or-1 ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSaveKey).toHaveBeenCalledExactlyOnceWith('openrouter', 'sk-or-1', true);
  });

  it('cancelling the OpenRouter key field turns the switch off again', async () => {
    const { onEnabledChange } = setup({ service: 'openrouter' });
    await fireEvent.click(enabledSwitch());
    await tick();
    const input = keyInput() as HTMLInputElement;
    await fireEvent.keyDown(input, { key: 'Escape' });
    await tick();
    expect(keyInput()).toBeNull();
    expect(enabledSwitch().getAttribute('aria-checked')).toBe('false');
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it('removing the OpenRouter key while on also turns it off', async () => {
    const { onClearKey } = setup({
      enabled: true,
      service: 'openrouter',
      keyConfigured: { kilo: false, openrouter: true },
    });
    await fireEvent.click(screen.getByRole('button', { name: m.settings_autocomplete_removeKey() }));
    expect(onClearKey).toHaveBeenCalledExactlyOnceWith('openrouter', true);
  });
});
