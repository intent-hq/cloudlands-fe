/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { store } from '$store/renderer/store';
import { principalContextChanged } from '$store/renderer/slices/principal/principal-slice';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import QueueHost from './SimpleRichInputQueueHost.svelte';
import MentionsHost from './__tests__/MemberMentionsHost.svelte';

// Keep the actual composer, admission selectors, store, and fixture transport.
// These controls exercise submission gating; browser mention serialization stays in CT.
vi.mock('./TipTapEditor.svelte', async () => ({
  default: (await import('../__tests__/mocks/TipTapEditor.svelte')).default,
}));
vi.mock('./ModelPicker.svelte', async () => ({
  default: (await import('../__tests__/mocks/ModelPicker.svelte')).default,
}));
vi.mock('./ContextPickerButton.svelte', async () => ({
  default: (await import('../__tests__/mocks/SlotOnly.svelte')).default,
}));

let disposeBootstrap: () => void;
let previousBridge: Window['electronAPI'];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  disposeBootstrap = store.init();
  previousBridge = window.electronAPI;
});
afterEach(() => {
  cleanup();
  window.electronAPI = previousBridge;
  disposeBootstrap();
  vi.unstubAllGlobals();
});

it.each([
  ['queue', QueueHost],
  ['mentions', MentionsHost],
] as const)(
  '%s fixture admits its caller before sending through the actual composer',
  async (_name, Host) => {
    const { container } = render(Host);
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'A new message' } });
    const send = screen.getByTestId('composer-submit-button');
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(send);
    if (_name === 'queue') expect(container.querySelector('output')?.textContent).toBe('sent');
    else expect(screen.getByTestId('stored-text').textContent).toBe('A new message');
  },
);

it.each([
  ['queue', QueueHost],
  ['mentions', MentionsHost],
] as const)('%s fixture preserves revocation after mounting', async (_name, Host) => {
  render(Host);
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'A new message' } });
  const send = screen.getByTestId('composer-submit-button');
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  store.dispatch(principalContextChanged(null));
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(true));
});

it('does not grant a guest workspace creation through the queue fixture', async () => {
  render(QueueHost);
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'A new message' } });
  const send = screen.getByTestId('composer-submit-button');
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
  admitLegacyPrincipal('guest');
  await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(true));
});
