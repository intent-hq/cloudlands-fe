// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProviderAccessTokenField from './ProviderAccessTokenField.svelte';

afterEach(cleanup);
function setup(props: Record<string, unknown> = {}) {
  const onSave = vi.fn();
  const onRemove = vi.fn();
  const onRetry = vi.fn();
  const view = render(ProviderAccessTokenField, {
    providerId: 'claude-code',
    status: 'ready',
    onSave,
    onRemove,
    onRetry,
    ...props,
  });
  return { ...view, onSave, onRemove, onRetry };
}
describe('optional provider access-token form', () => {
  it('masks a draft, saves only on explicit action, and clears the input immediately', async () => {
    const view = setup();
    const input = view.getByLabelText('Optional access token') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('new-password');
    expect(view.getByRole('button', { name: 'Save token' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.input(input, { target: { value: 'synthetic-setup-token' } });
    expect(view.onSave).not.toHaveBeenCalled();
    await fireEvent.click(view.getByRole('button', { name: 'Save token' }));
    expect(view.onSave).toHaveBeenCalledWith('synthetic-setup-token');
    expect(input.value).toBe('');
    expect(view.getByText(/each target machine/)).toBeTruthy();
    expect(view.getByText(/claude setup-token/)).toBeTruthy();
  });
  it('keeps saved state distinct from verified authentication and replaces/removes', async () => {
    const view = setup({ configured: true, providerId: 'codex' });
    const input = view.getByLabelText('Optional access token') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(view.getByText('Token saved · not verified')).toBeTruthy();
    expect(view.getByText(/Business or Enterprise/)).toBeTruthy();
    await fireEvent.input(input, { target: { value: 'replacement-fixture' } });
    await fireEvent.click(view.getByRole('button', { name: 'Replace token' }));
    expect(view.onSave).toHaveBeenCalledWith('replacement-fixture');
    await fireEvent.input(input, { target: { value: 'discarded-draft' } });
    await fireEvent.click(view.getByRole('button', { name: 'Remove token' }));
    expect(view.onRemove).toHaveBeenCalledOnce();
    expect(input.value).toBe('');
  });
  it('disables every mutation while pending and shows a safe failed-save message', () => {
    const view = setup({ configured: true, busy: true, failed: true });
    expect(view.getByLabelText('Optional access token').hasAttribute('disabled')).toBe(true);
    expect(view.getByRole('button', { name: 'Remove token' }).hasAttribute('disabled')).toBe(true);
    expect(view.getByRole('alert').textContent).toContain('Could not update the token.');
  });
  it.each(['loading', 'unavailable', 'error'] as const)(
    'does not allow token entry while %s',
    async (status) => {
      const view = setup({ status });
      expect(view.container.querySelector('input')).toBeNull();
      expect(view.queryByRole('button', { name: 'Save token' })).toBeNull();
      if (status === 'error') {
        await fireEvent.click(view.getByRole('button', { name: 'Try Again' }));
        expect(view.onRetry).toHaveBeenCalledOnce();
      }
    },
  );
  it('forgets an unsaved draft when the form is closed', async () => {
    const view = setup();
    await fireEvent.input(view.getByLabelText('Optional access token'), {
      target: { value: 'forgotten' },
    });
    view.unmount();
    expect((setup().getByLabelText('Optional access token') as HTMLInputElement).value).toBe('');
  });
});
